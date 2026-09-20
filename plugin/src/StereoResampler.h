#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <vector>

// Fixed-ratio stereo sample-rate conversion for the audio thread.
//
// The reason this exists as its own type rather than a few lines inside
// RoomClient::push is the tail: juce::LagrangeInterpolator consumes only as
// many input samples as the requested output count needs, and the remainder
// has to be carried into the next block. Dropping it instead loses a fraction
// of a sample per block, which drifts audibly over a session. That carry is
// stateful, so it gets a test (tests/resampler_check.cpp).
class StereoResampler
{
public:
    static constexpr int kChannels   = 2;
    static constexpr int kBufferSize = 32768;

    StereoResampler()
    {
        for (auto& b : pending)   b.resize (kBufferSize);
        for (auto& b : converted) b.resize (kBufferSize);
    }

    // inputSamplesPerOutputSample: hostRate / targetRate (44100 -> 48000 gives
    // 0.91875). 1.0 means no conversion.
    void setRatio (double newRatio)
    {
        ratio = newRatio;
        reset();
    }

    double getRatio() const noexcept { return ratio; }

    void reset()
    {
        for (auto& r : interpolators) r.reset();
        pendingCount = 0;
    }

    // AUDIO THREAD. Converts one block and returns how many output frames are
    // available in outLeft/outRight (may be 0). Never allocates. The caller's
    // output buffers must hold at least kBufferSize frames.
    int process (const float* left, const float* right, int numSamples,
                 float* outLeft, float* outRight) noexcept
    {
        if (numSamples <= 0)
            return 0;

        // Ratio 1.0 must be a true bypass. Running the interpolator anyway
        // filters every sample (measured ~0.04 peak error), so a host already
        // at the target rate would be degraded for no reason.
        if (ratio == 1.0)
        {
            std::copy (left,  left  + numSamples, outLeft);
            std::copy (right, right + numSamples, outRight);
            return numSamples;
        }

        if (pendingCount + numSamples > kBufferSize)
            pendingCount = 0;              // absurd backlog: resync rather than overrun

        std::copy (left,  left  + numSamples, pending[0].begin() + pendingCount);
        std::copy (right, right + numSamples, pending[1].begin() + pendingCount);
        pendingCount += numSamples;

        const int numOut = juce::jmin (kBufferSize, (int) ((double) pendingCount / ratio));
        if (numOut <= 0)
            return 0;

        int used = 0;
        for (size_t c = 0; c < (size_t) kChannels; ++c)
            used = interpolators[c].process (ratio, pending[c].data(), converted[c].data(), numOut);

        std::copy (converted[0].begin(), converted[0].begin() + numOut, outLeft);
        std::copy (converted[1].begin(), converted[1].begin() + numOut, outRight);

        const int remaining = juce::jmax (0, pendingCount - used);
        if (remaining > 0)
            for (size_t c = 0; c < (size_t) kChannels; ++c)
                std::memmove (pending[c].data(), pending[c].data() + used,
                              (size_t) remaining * sizeof (float));

        pendingCount = remaining;
        return numOut;
    }

private:
    double ratio = 1.0;
    int pendingCount = 0;
    std::array<juce::LagrangeInterpolator, (size_t) kChannels> interpolators;
    std::array<std::vector<float>, (size_t) kChannels> pending, converted;
};
