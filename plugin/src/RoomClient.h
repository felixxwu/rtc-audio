#pragma once

#include <juce_core/juce_core.h>
#include <memory>

// Streams the host's audio into an rtc-audio room as a real WebRTC peer:
// Firestore REST for signalling, ICE/DTLS/SCTP via libdatachannel, and FLAC
// frames on the pre-negotiated "audio" data channel (id 2) that the web app
// already speaks.
//
// v0 is deliberately narrow:
//   * send-only  - no decoder, no playback, no audio output. One-way source.
//   * answer-only - we never construct an offer (see the joinedAt note in
//                   RoomClient.cpp); browser peers always offer to us.
//   * no chat, cursors, files, video, or stats channels.
class RoomClient
{
public:
    // Must match STREAM_PARAMS in src/codec/losslessSender.ts, and the
    // encoder settings in src/codec/flacCodec.ts (16-bit, level 8).
    static constexpr int   kSampleRate = 48000;
    static constexpr int   kChannels   = 2;
    static constexpr int   kBlockSize  = 4096;

    enum class State { Idle, Joining, Waiting, Streaming, Failed };

    RoomClient();
    ~RoomClient();

    RoomClient (const RoomClient&) = delete;
    RoomClient& operator= (const RoomClient&) = delete;

    // Join (or rejoin) a room. Returns immediately; progress shows up in
    // state()/statusText(). Safe to call while already joined - it leaves first.
    void join (const juce::String& roomId);
    void leave();

    // Tell the client what the host is actually running at. Anything other
    // than kSampleRate is resampled up/down to it, so a 44.1 kHz session works
    // without the user touching their DAW. Absurd rates are refused outright
    // and say so in statusText().
    void prepare (double hostSampleRate, int hostChannels);

    // AUDIO THREAD ONLY. Copies into a lock-free FIFO; the encode and the
    // network send happen on our own thread. Never allocates, locks or blocks.
    // Extra channels are ignored; a mono host is duplicated to stereo.
    void pushAudio (const float* const* channelData, int numChannels, int numSamples);

    State        state()          const;
    juce::String statusText()     const;
    int          connectedPeers() const;
    // Peak level of the most recent audio pushed, for the UI meter. 0 if idle.
    float        outputLevel()    const;
    // This peer's id, as it appears in the room.
    juce::String peerId()         const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
