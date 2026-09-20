// Headless end-to-end harness: joins a real room and streams a test tone, so
// the signalling + WebRTC + FLAC path can be exercised without a DAW or a GUI.
//
//   ./room_smoke <room-code> [seconds] [host-sample-rate]
//
// Open the web app, create a session, pass its code here, and you should hear
// a 440/660 Hz tone from the plugin's participant tile.
#include "RoomClient.h"
#include <juce_events/juce_events.h>
#include <cmath>
#include <cstdio>
#include <vector>

int main (int argc, char** argv)
{
    if (argc < 2)
    {
        std::puts ("usage: room_smoke <room-code> [seconds] [host-sample-rate]");
        return 1;
    }

    const juce::String room (argv[1]);
    const int seconds  = argc > 2 ? std::atoi (argv[2]) : 45;
    // Pretend to be a host at this rate, so the resampling path can be
    // exercised end to end (e.g. 44100).
    const double hostRate = argc > 3 ? std::atof (argv[3]) : (double) RoomClient::kSampleRate;

    juce::ScopedJuceInitialiser_GUI juceInit;

    RoomClient client;
    client.prepare (hostRate, RoomClient::kChannels);
    std::printf ("host rate %.0f Hz -> %d Hz\n", hostRate, RoomClient::kSampleRate);
    client.join (room);

    constexpr int blk = 512;
    std::vector<float> left ((size_t) blk), right ((size_t) blk);
    const float* channels[2] = { left.data(), right.data() };

    const double step = 1.0 / hostRate;
    double t = 0.0;

    const auto startMs   = juce::Time::getMillisecondCounterHiRes();
    const double blockMs = 1000.0 * blk / hostRate;
    long long blocksSent = 0;
    int lastReport = -1;

    while (true)
    {
        const double elapsed = juce::Time::getMillisecondCounterHiRes() - startMs;
        if (elapsed > seconds * 1000.0)
            break;

        // Pace the feed to real time, the way a host's audio callback would.
        if (blocksSent * blockMs > elapsed)
        {
            juce::Thread::sleep (1);
            continue;
        }

        for (int i = 0; i < blk; ++i, t += step)
        {
            left[(size_t) i]  = 0.25f * (float) std::sin (2.0 * juce::MathConstants<double>::pi * 440.0 * t);
            right[(size_t) i] = 0.25f * (float) std::sin (2.0 * juce::MathConstants<double>::pi * 660.0 * t);
        }

        client.pushAudio (channels, 2, blk);
        ++blocksSent;

        const int sec = (int) (elapsed / 1000.0);
        if (sec != lastReport)
        {
            lastReport = sec;
            std::printf ("[%2ds] peers=%d  %s\n", sec, client.connectedPeers(),
                         client.statusText().toRawUTF8());
            std::fflush (stdout);
        }
    }

    std::printf ("leaving after %lld blocks\n", blocksSent);
    client.leave();
    return 0;
}
