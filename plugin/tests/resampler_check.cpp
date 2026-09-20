// Assert-based sanity checks for StereoResampler. No test framework.
//
// Build (see tests/README or the task that generated this file for the exact
// clang++ invocation): compiles standalone against JUCE headers/sources.

#include "StereoResampler.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#define CHECK(cond)                                                                    \
    do                                                                                  \
    {                                                                                   \
        if (! (cond))                                                                   \
        {                                                                               \
            std::fprintf (stderr, "CHECK FAILED at %s:%d: %s\n", __FILE__, __LINE__, #cond); \
            std::exit (1);                                                              \
        }                                                                               \
    } while (false)

namespace
{
    constexpr int kBlock = 512;

    void testNoDrift()
    {
        StereoResampler r;
        r.setRatio (44100.0 / 48000.0);

        const int64_t inputFrames = 60 * 44100;
        const int numBlocks = (int) (inputFrames / kBlock); // whole blocks only, exact accounting

        std::vector<float> inL (kBlock, 0.0f), inR (kBlock, 0.0f);
        std::vector<float> outL (StereoResampler::kBufferSize), outR (StereoResampler::kBufferSize);

        // Simple non-zero content so this isn't degenerate all-zero input.
        for (int i = 0; i < kBlock; ++i)
            inL[i] = inR[i] = std::sin ((float) i * 0.1f) * 0.3f;

        const double ratio = r.getRatio();
        int64_t totalOut = 0;
        double naiveFloorSum = 0.0;

        for (int b = 0; b < numBlocks; ++b)
        {
            totalOut += r.process (inL.data(), inR.data(), kBlock, outL.data(), outR.data());
            naiveFloorSum += std::floor ((double) kBlock / ratio);
        }

        const int64_t consumedFrames = (int64_t) numBlocks * kBlock;
        const double expected = (double) consumedFrames * 48000.0 / 44100.0;
        const double tolerance = expected * 0.0001; // 0.01%

        std::printf ("testNoDrift: totalOut=%lld expected=%.3f naiveFloorSum=%.3f tolerance=%.3f\n",
                      (long long) totalOut, expected, naiveFloorSum, tolerance);

        CHECK (std::abs ((double) totalOut - expected) <= tolerance);
        CHECK ((double) totalOut > naiveFloorSum); // carry must actually add frames back
    }

    void testPitchPreserved()
    {
        StereoResampler r;
        r.setRatio (44100.0 / 48000.0);

        const double inRate = 44100.0;
        const double freq = 1000.0;
        const int totalInFrames = (int) (2.0 * inRate); // 2 seconds

        std::vector<float> inL (kBlock), inR (kBlock);
        std::vector<float> outL (StereoResampler::kBufferSize), outR (StereoResampler::kBufferSize);
        std::vector<float> allOut;
        allOut.reserve ((size_t) (totalInFrames * 48000.0 / 44100.0) + 1024);

        int phaseSample = 0;
        int framesLeft = totalInFrames;
        while (framesLeft > 0)
        {
            const int n = std::min (kBlock, framesLeft);
            for (int i = 0; i < n; ++i)
            {
                const double t = (double) (phaseSample + i) / inRate;
                const float s = (float) (0.5 * std::sin (2.0 * juce::MathConstants<double>::pi * freq * t));
                inL[(size_t) i] = s;
                inR[(size_t) i] = s;
            }
            const int numOut = r.process (inL.data(), inR.data(), n, outL.data(), outR.data());
            for (int i = 0; i < numOut; ++i)
                allOut.push_back (outL[(size_t) i]);

            phaseSample += n;
            framesLeft -= n;
        }

        const int skip = 2000;
        CHECK ((int) allOut.size() > skip + 1000);

        int crossings = 0;
        float peak = 0.0f;
        for (size_t i = 0; i < allOut.size(); ++i)
        {
            const float s = allOut[i];
            CHECK (std::isfinite (s));
            peak = std::max (peak, std::abs (s));
        }
        for (size_t i = (size_t) skip + 1; i < allOut.size(); ++i)
            if (allOut[i - 1] <= 0.0f && allOut[i] > 0.0f)
                ++crossings;

        const int analysedFrames = (int) allOut.size() - skip;
        const double measuredFreq = (double) crossings / ((double) analysedFrames / 48000.0);

        std::printf ("testPitchPreserved: measuredFreq=%.4f Hz peak=%.4f outFrames=%zu\n",
                      measuredFreq, peak, allOut.size());

        CHECK (std::abs (measuredFreq - freq) <= 1.0);
        CHECK (peak > 0.4f && peak < 0.6f);
    }

    void testRatioOneAndUpsample()
    {
        // Ratio 1.0 is an explicit bypass in StereoResampler::process, so it
        // must be exact pass-through. (It was not, before that bypass existed:
        // the interpolator perturbed nearly every sample by up to ~0.04.)
        {
            StereoResampler r;
            r.setRatio (1.0);

            std::vector<float> inL (kBlock), inR (kBlock);
            for (int i = 0; i < kBlock; ++i)
                inL[i] = inR[i] = std::sin ((float) i * 0.05f) * 0.4f;

            std::vector<float> outL (StereoResampler::kBufferSize), outR (StereoResampler::kBufferSize);
            const int numOut = r.process (inL.data(), inR.data(), kBlock, outL.data(), outR.data());

            CHECK (numOut == kBlock);

            float maxDiff = 0.0f;
            int numDiffOverTol = 0;
            const float tol = 1e-5f;
            for (int i = 0; i < kBlock; ++i)
            {
                const float d = std::abs (outL[(size_t) i] - inL[(size_t) i]);
                maxDiff = std::max (maxDiff, d);
                if (d > tol)
                    ++numDiffOverTol;
            }
            std::printf ("testRatioOne: maxDiff=%.8f (expect exactly 0)\n", maxDiff);
            CHECK (maxDiff == 0.0f);
            CHECK (numDiffOverTol == 0);
        }

        // Downsampling 96000 -> 48000, ratio 2.0.
        {
            StereoResampler r;
            r.setRatio (96000.0 / 48000.0);

            const int totalInFrames = 48000;
            std::vector<float> inL (kBlock), inR (kBlock);
            std::vector<float> outL (StereoResampler::kBufferSize), outR (StereoResampler::kBufferSize);

            for (int i = 0; i < kBlock; ++i)
                inL[i] = inR[i] = std::sin ((float) i * 0.05f) * 0.4f;

            int64_t totalOut = 0;
            int framesLeft = totalInFrames;
            while (framesLeft > 0)
            {
                const int n = std::min (kBlock, framesLeft);
                totalOut += r.process (inL.data(), inR.data(), n, outL.data(), outR.data());
                framesLeft -= n;
            }

            const double expected = 24000.0;
            const double tolerance = expected * 0.0001;
            std::printf ("testUpsample: totalOut=%lld expected=%.3f tolerance=%.3f\n",
                          (long long) totalOut, expected, tolerance);
            CHECK (std::abs ((double) totalOut - expected) <= tolerance);
        }
    }
}

int main()
{
    testNoDrift();
    testPitchPreserved();
    testRatioOneAndUpsample();

    std::printf ("resampler_check: OK\n");
    return 0;
}
