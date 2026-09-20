#include "RoomClient.h"
#include "Firestore.h"
#include "FlacEncoder.h"
#include "StereoResampler.h"

#include <juce_audio_basics/juce_audio_basics.h>

#include <rtc/rtc.hpp>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <map>
#include <mutex>
#include <set>
#include <thread>
#include <vector>

namespace
{
    // The web app's data-channel contract (src/codec/audioProtocol.ts and the
    // createDataChannel call in src/rtc/room.ts). The channel is pre-negotiated
    // on both sides, so the id must match exactly or the streams never meet.
    constexpr const char* kAudioLabel     = "audio";
    constexpr uint16_t    kAudioChannelId = 2;

    constexpr int kPollSliceMs  = 100;
    constexpr int kPollEveryMs  = 1000;    // while a handshake may be in flight
    constexpr int kIdlePollMs   = 10000;   // once a listener is connected (Firestore bills per doc read)
    constexpr int kHeartbeatMs  = 15000;   // room.ts HEARTBEAT_MS
    constexpr juce::int64 kTtlMs = 24LL * 60 * 60 * 1000;   // room.ts TTL_MS

    // ponytail: we publish a joinedAt a year in the future purely so the web
    // app's glare rule ("the peer already in the room offers to the newcomer")
    // always makes US the answerer. That lets v0 skip the entire offerer code
    // path. The visible cost is that the plugin always sorts last in the
    // participant list. Remove this and implement offerTo() if the plugin ever
    // needs to connect to a peer that joins after it in a way ordering matters.
    constexpr juce::int64 kAnswererSkewMs = 365LL * 24 * 60 * 60 * 1000;

    juce::String controlStart()
    {
        return juce::String ("{\"lossless\":\"start\",\"params\":{\"sampleRate\":")
             + juce::String (RoomClient::kSampleRate) + ",\"channels\":"
             + juce::String (RoomClient::kChannels)   + ",\"blockSize\":"
             + juce::String (RoomClient::kBlockSize)  + "}}";
    }

    juce::var expireAtField()
    {
        return firestore::timestamp (juce::Time::currentTimeMillis() + kTtlMs);
    }
}

//==============================================================================
// One browser peer we answer and stream to.
struct PeerLink
{
    std::shared_ptr<rtc::PeerConnection> pc;
    std::shared_ptr<rtc::DataChannel>    audio;
    juce::String connPath;        // calls/{room}/connections/{offerer}_{me}
    juce::String answeredSdp;     // dedupes re-answers after an ICE restart
    std::set<juce::String> seenCandidates;
    bool announced = false;       // told this peer to expect FLAC yet?
};

//==============================================================================
struct RoomClient::Impl
{
    Impl()
    {
        ring.resize ((size_t) fifo.getTotalSize());
        scratch.resize ((size_t) kBlockSize * kChannels);

        // Preallocated so the resampler never allocates on the audio thread.
        for (auto& b : convOut)
            b.resize (StereoResampler::kBufferSize);
    }

    ~Impl() { stop(); }

    // --- audio thread -> encoder thread -------------------------------------
    // 2 seconds of stereo. If the network stalls for longer than that we drop
    // the oldest audio rather than block the audio thread.
    juce::AbstractFifo fifo { kSampleRate * 2 * kChannels };
    std::vector<float> ring, scratch;

    std::atomic<bool>  tapLive { false };
    std::atomic<float> level   { 0.0f };
    std::atomic<bool>  rateOk  { true };
    std::atomic<double> hostRate { 0.0 };

    // Host-rate -> 48k conversion (see StereoResampler.h). `resampling` is the
    // audio thread's cheap check; the converter itself is touched only there.
    std::atomic<bool> resampling { false };
    StereoResampler converter;
    std::array<std::vector<float>, (size_t) kChannels> convOut;

    // --- room ---------------------------------------------------------------
    juce::String room;
    juce::String myId { juce::Uuid().toDashedString() };

    std::mutex peersMutex;
    std::map<juce::String, std::shared_ptr<PeerLink>> peers;
    std::atomic<int> peerCount { 0 };

    std::atomic<State> st { State::Idle };
    mutable std::mutex statusMutex;
    juce::String status { "Not connected" };

    // Encoder thread only (no lock needed): the FLAC stream and its header.
    std::unique_ptr<FlacEncoder> encoder;
    std::vector<uint8_t> header;

    std::thread signalThread, encodeThread;
    // `running` is the threads' own stop flag and either thread may clear it
    // to bail out on a fatal error. `started` tracks whether the threads exist
    // and must be joined, so a stop() after a self-terminating thread still
    // joins instead of leaking it.
    std::atomic<bool> running { false };
    std::atomic<bool> started { false };

    //==========================================================================
    void setStatus (State s, juce::String text)
    {
        st.store (s);
        std::lock_guard<std::mutex> lk (statusMutex);
        status = std::move (text);
    }

    juce::String getStatus() const
    {
        std::lock_guard<std::mutex> lk (statusMutex);
        return status;
    }

    //==========================================================================
    void start (const juce::String& roomId)
    {
        stop();
        room = roomId;
        running = true;
        started = true;
        setStatus (State::Joining, "Joining " + roomId + "...");

        encodeThread = std::thread ([this] { encodeLoop(); });
        signalThread = std::thread ([this] { signalLoop(); });
    }

    void stop()
    {
        if (! started.exchange (false))
            return;

        running = false;
        tapLive = false;
        if (encodeThread.joinable()) encodeThread.join();
        if (signalThread.joinable()) signalThread.join();

        {
            std::lock_guard<std::mutex> lk (peersMutex);
            peers.clear();
        }
        peerCount = 0;
        encoder.reset();
        header.clear();
        fifo.reset();
        level = 0.0f;
        setStatus (State::Idle, "Not connected");
    }

    //==========================================================================
    // Interleave one stereo pair into the FIFO. Audio thread.
    void writeInterleaved (const float* left, const float* right, int n)
    {
        int start1, size1, start2, size2;
        fifo.prepareToWrite (n * kChannels, start1, size1, start2, size2);

        int done = 0;
        auto fill = [&] (int start, int size)
        {
            for (int k = 0; k < size; ++k)
            {
                const int idx = done + k;                  // float index within this push
                ring[(size_t) (start + k)] = (idx % kChannels == 0 ? left : right)[idx / kChannels];
            }
            done += size;
        };
        fill (start1, size1);
        fill (start2, size2);
        fifo.finishedWrite (size1 + size2);
    }

    // AUDIO THREAD. Lock-free, allocation-free.
    void push (const float* const* ch, int numCh, int n)
    {
        if (numCh <= 0 || n <= 0)
            return;

        const float* left  = ch[0];
        const float* right = numCh > 1 ? ch[1] : ch[0];   // mono host -> both sides

        // Meter ALWAYS, even when we are not streaming. The meter's main job is
        // letting you confirm audio is arriving BEFORE you join a room, so
        // gating it on having a listener made it useless exactly when needed.
        float peak = 0.0f;
        for (int i = 0; i < n; ++i)
            peak = juce::jmax (peak, std::fabs (left[i]), std::fabs (right[i]));
        level.store (peak, std::memory_order_relaxed);

        // Past this point we are only feeding the encoder, which is pointless
        // with nobody listening.
        if (! tapLive.load (std::memory_order_relaxed))
            return;

        if (! resampling.load (std::memory_order_relaxed))
        {
            writeInterleaved (left, right, n);
            return;
        }

        const int numOut = converter.process (left, right, n,
                                              convOut[0].data(), convOut[1].data());
        if (numOut > 0)
            writeInterleaved (convOut[0].data(), convOut[1].data(), numOut);
    }

    // Called from the host's prepareToPlay, i.e. while audio is stopped, so
    // resetting the converter state here cannot race the audio thread.
    void setHostRate (double r)
    {
        hostRate.store (r);

        const bool usable = r >= 8000.0 && r <= 384000.0;
        rateOk.store (usable);

        const bool needsConversion = usable && std::abs (r - (double) kSampleRate) > 1.0;
        converter.setRatio (needsConversion ? r / (double) kSampleRate : 1.0);
        resampling.store (needsConversion);
    }

    //==========================================================================
    void encodeLoop()
    {
        try
        {
            encoder = std::make_unique<FlacEncoder> ((unsigned) kSampleRate, (unsigned) kChannels);
        }
        catch (const std::exception& e)
        {
            setStatus (State::Failed, juce::String ("FLAC encoder failed: ") + e.what());
            running = false;
            return;
        }

        const int need = kBlockSize * kChannels;

        while (running)
        {
            if (fifo.getNumReady() < need)
            {
                juce::Thread::sleep (2);
                continue;
            }

            int start1, size1, start2, size2;
            fifo.prepareToRead (need, start1, size1, start2, size2);
            std::copy (ring.begin() + start1, ring.begin() + start1 + size1, scratch.begin());
            std::copy (ring.begin() + start2, ring.begin() + start2 + size2, scratch.begin() + size1);
            fifo.finishedRead (size1 + size2);

            std::vector<uint8_t> bytes;
            try
            {
                bytes = encoder->encode (scratch.data(), (size_t) kBlockSize);
            }
            catch (const std::exception& e)
            {
                setStatus (State::Failed, juce::String ("FLAC encode failed: ") + e.what());
                running = false;
                return;
            }

            if (! bytes.empty())
                broadcast (bytes);
        }
    }

    // Mirrors losslessSender.ts: announce first using the header captured from
    // an EARLIER chunk, then cache the header, then send this chunk. A peer
    // whose channel opened before any audio flowed gets the header inside the
    // very first chunk; one that joins mid-stream gets the cached header up
    // front so its decoder can start.
    void broadcast (const std::vector<uint8_t>& bytes)
    {
        const auto* data = reinterpret_cast<const std::byte*> (bytes.data());

        std::lock_guard<std::mutex> lk (peersMutex);
        for (auto& entry : peers)
        {
            auto& link = entry.second;
            if (link->audio == nullptr || ! link->audio->isOpen())
                continue;

            try
            {
                if (! link->announced)
                {
                    link->audio->send (controlStart().toStdString());
                    if (! header.empty())
                        link->audio->send (reinterpret_cast<const std::byte*> (header.data()), header.size());
                    link->announced = true;
                }
                link->audio->send (data, bytes.size());
            }
            catch (const std::exception&)
            {
                // A peer that went away mid-send is reaped by the signal loop.
            }
        }

        if (header.empty())
            header = bytes;
    }

    //==========================================================================
    void signalLoop()
    {
        writePresence (true);

        auto lastBeat = juce::Time::getMillisecondCounter();
        auto lastPoll = lastBeat - kIdlePollMs;

        while (running)
        {
            const auto now = juce::Time::getMillisecondCounter();

            if (now - lastBeat >= (juce::uint32) kHeartbeatMs)
            {
                writePresence (false);
                lastBeat = now;
            }

            if (now - lastPoll >= (juce::uint32) (peerCount > 0 ? kIdlePollMs : kPollEveryMs))
            {
                pollConnections();
                pollCandidates();
                refreshStatus();
                lastPoll = now;
            }

            juce::Thread::sleep (kPollSliceMs);   // keeps leave() responsive
        }

        firestore::deleteDoc ("calls/" + room + "/peers/" + myId);
    }

    // joinedAt is written once, far in the future (see kAnswererSkewMs).
    // lastSeen is stamped by the server so our clock can't drift us out of the
    // room: the web app evicts a peer whose lastSeen trails its own by 35s.
    void writePresence (bool first)
    {
        auto* f = new juce::DynamicObject();
        if (first)
            f->setProperty ("joinedAt", firestore::timestamp (juce::Time::currentTimeMillis() + kAnswererSkewMs));
        f->setProperty ("sharing", false);
        f->setProperty ("expireAt", expireAtField());

        firestore::commitDoc ("calls/" + room + "/peers/" + myId, juce::var (f), { "lastSeen" });
    }

    void pollConnections()
    {
        const auto base = "calls/" + room + "/connections";
        auto docs = firestore::listCollection (base);

        std::set<juce::String> live;

        for (const auto& doc : docs)
        {
            if (doc["answererId"].toString() != myId)
                continue;

            const auto docId = doc["_id"].toString();
            const auto offer = doc["offer"];
            if (! offer.isObject())
                continue;

            const auto sdp = offer["sdp"].toString();
            if (sdp.isEmpty())
                continue;

            live.insert (docId);
            answerOffer (docId, base + "/" + docId, sdp);
        }

        // Reap peers whose connection doc is gone (the browser deletes it on
        // leave), so we stop trying to send into a dead channel.
        std::lock_guard<std::mutex> lk (peersMutex);
        for (auto it = peers.begin(); it != peers.end();)
            it = live.count (it->first) ? std::next (it) : peers.erase (it);
        peerCount = countOpenLocked();
    }

    void answerOffer (const juce::String& docId, const juce::String& connPath, const juce::String& sdp)
    {
        std::shared_ptr<PeerLink> link;
        {
            std::lock_guard<std::mutex> lk (peersMutex);
            auto it = peers.find (docId);
            if (it != peers.end())
            {
                if (it->second->answeredSdp == sdp)
                    return;                       // already answered this SDP
                link = it->second;
            }
        }

        if (link == nullptr)
        {
            link = std::make_shared<PeerLink>();
            link->connPath = connPath;
            createPeer (link, connPath);
            std::lock_guard<std::mutex> lk (peersMutex);
            peers[docId] = link;
        }

        try
        {
            link->pc->setRemoteDescription (rtc::Description (sdp.toStdString(), "offer"));
            link->pc->setLocalDescription (rtc::Description::Type::Answer);
            link->answeredSdp = sdp;
        }
        catch (const std::exception& e)
        {
            setStatus (State::Failed, juce::String ("Answer failed: ") + e.what());
        }
    }

    void createPeer (const std::shared_ptr<PeerLink>& link, const juce::String& connPath)
    {
        rtc::Configuration cfg;
        cfg.iceServers.emplace_back ("stun:stun1.l.google.com:19302");
        cfg.iceServers.emplace_back ("stun:stun2.l.google.com:19302");
        // We answer an existing offer, so libdatachannel must not try to
        // generate one of its own the moment we create the data channel.
        cfg.disableAutoNegotiation = true;

        link->pc = std::make_shared<rtc::PeerConnection> (cfg);

        link->pc->onLocalDescription ([this, connPath] (rtc::Description d)
        {
            auto* answer = new juce::DynamicObject();
            answer->setProperty ("type", juce::String (d.typeString()));
            answer->setProperty ("sdp",  juce::String (std::string (d)));

            auto* fields = new juce::DynamicObject();
            fields->setProperty ("answer", juce::var (answer));
            firestore::patchDoc (connPath, juce::var (fields));
        });

        link->pc->onLocalCandidate ([this, connPath] (rtc::Candidate c)
        {
            auto* f = new juce::DynamicObject();
            f->setProperty ("candidate", juce::String (c.candidate()));
            f->setProperty ("sdpMid",    juce::String (c.mid()));
            f->setProperty ("expireAt",  expireAtField());
            firestore::createDoc (connPath + "/answerCandidates", juce::var (f));
        });

        // Pre-negotiated on both sides: no in-band open handshake, so the id
        // has to match room.ts exactly.
        rtc::DataChannelInit init;
        init.negotiated = true;
        init.id = kAudioChannelId;
        init.reliability.unordered = false;

        link->audio = link->pc->createDataChannel (kAudioLabel, init);
        // Send-only in v0: whatever the browser sends us on this channel
        // (its own FLAC stream, if it is on lossless) is deliberately ignored.
    }

    void pollCandidates()
    {
        std::vector<std::shared_ptr<PeerLink>> snapshot;
        {
            std::lock_guard<std::mutex> lk (peersMutex);
            for (auto& e : peers) snapshot.push_back (e.second);
        }

        for (auto& link : snapshot)
        {
            if (link->pc == nullptr || (link->audio != nullptr && link->audio->isOpen()))
                continue;                         // connected: candidates no longer needed

            for (const auto& c : firestore::listCollection (link->connPath + "/offerCandidates"))
            {
                const auto id = c["_id"].toString();
                if (! link->seenCandidates.insert (id).second)
                    continue;

                const auto cand = c["candidate"].toString();
                if (cand.isEmpty())
                    continue;

                try
                {
                    link->pc->addRemoteCandidate (rtc::Candidate (cand.toStdString(),
                                                                  c["sdpMid"].toString().toStdString()));
                }
                catch (const std::exception&)
                {
                    // A candidate that arrives before the remote description,
                    // or one we simply can't use, is not fatal.
                }
            }
        }
    }

    int countOpenLocked() const
    {
        int n = 0;
        for (const auto& e : peers)
            if (e.second->audio != nullptr && e.second->audio->isOpen())
                ++n;
        return n;
    }

    void refreshStatus()
    {
        int open;
        {
            std::lock_guard<std::mutex> lk (peersMutex);
            open = countOpenLocked();
        }
        peerCount = open;

        if (! rateOk.load())
        {
            tapLive = false;
            setStatus (State::Failed,
                       "Unsupported sample rate: " + juce::String (hostRate.load(), 0) + " Hz");
            return;
        }

        if (open > 0)
        {
            tapLive = true;
            juce::String text ("Streaming to ");
            text << open << (open == 1 ? " listener" : " listeners");

            const auto hostHz = hostRate.load();
            if (std::abs (hostHz - (double) kSampleRate) > 1.0)
                text << " (resampled from " << juce::String (hostHz, 0) << " Hz)";

            setStatus (State::Streaming, text);
        }
        else
        {
            // Keep the tap off until someone is actually listening, so we are
            // not encoding FLAC into the void.
            tapLive = false;
            setStatus (State::Waiting, "In room " + room + " - waiting for the web app");
        }
    }
};

//==============================================================================
RoomClient::RoomClient() : impl (std::make_unique<Impl>())
{
    static std::once_flag once;
    std::call_once (once, [] { rtc::InitLogger (rtc::LogLevel::Warning); });
}

RoomClient::~RoomClient() = default;

void RoomClient::join (const juce::String& roomId)
{
    // Accept a pasted invite link (".../?id=ABC123") as well as a bare code.
    auto code = roomId.trim();
    if (code.containsIgnoreCase ("id="))
        code = code.fromFirstOccurrenceOf ("id=", false, true).upToFirstOccurrenceOf ("&", false, false)
                   .upToFirstOccurrenceOf ("#", false, false).trim();
    if (code.isNotEmpty())
        impl->start (code.toUpperCase());
}

void RoomClient::leave()                       { impl->stop(); }
void RoomClient::pushAudio (const float* const* c, int n, int s) { impl->push (c, n, s); }
RoomClient::State RoomClient::state()    const { return impl->st.load(); }
juce::String RoomClient::statusText()    const { return impl->getStatus(); }
int          RoomClient::connectedPeers() const { return impl->peerCount.load(); }
float        RoomClient::outputLevel()   const { return impl->level.load(); }
juce::String RoomClient::peerId()        const { return impl->myId; }

void RoomClient::prepare (double hostSampleRate, int)
{
    impl->setHostRate (hostSampleRate);
}
