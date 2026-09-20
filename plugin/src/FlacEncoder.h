#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include <FLAC/stream_encoder.h>

// Header-only C++17 wrapper around libFLAC's stream encoder, matching the
// byte output of libflacjs's create_libflac_encoder(sampleRate, channels,
// 16, 8, 0, false) exactly.
class FlacEncoder
{
public:
    FlacEncoder (unsigned sampleRate, unsigned channels)
        : encoder (FLAC__stream_encoder_new())
    {
        if (encoder == nullptr)
            throw std::runtime_error ("FLAC__stream_encoder_new failed");

        bool ok = true;
        ok = ok && FLAC__stream_encoder_set_channels (encoder, channels);
        ok = ok && FLAC__stream_encoder_set_bits_per_sample (encoder, 16);
        ok = ok && FLAC__stream_encoder_set_sample_rate (encoder, sampleRate);
        ok = ok && FLAC__stream_encoder_set_compression_level (encoder, 8);
        ok = ok && FLAC__stream_encoder_set_total_samples_estimate (encoder, 0);
        ok = ok && FLAC__stream_encoder_set_verify (encoder, false);

        if (! ok)
        {
            FLAC__stream_encoder_delete (encoder);
            throw std::runtime_error ("failed to configure FLAC stream encoder");
        }

        numChannels = channels;

        FLAC__StreamEncoderInitStatus status =
            FLAC__stream_encoder_init_stream (encoder, writeCallback, nullptr, nullptr, nullptr, this);

        if (status != FLAC__STREAM_ENCODER_INIT_STATUS_OK)
        {
            FLAC__stream_encoder_delete (encoder);
            throw std::runtime_error ("FLAC__stream_encoder_init_stream failed");
        }
    }

    ~FlacEncoder()
    {
        if (! finished)
        {
            FLAC__stream_encoder_finish (encoder);
            finished = true;
        }

        FLAC__stream_encoder_delete (encoder);
    }

    FlacEncoder (const FlacEncoder&) = delete;
    FlacEncoder& operator= (const FlacEncoder&) = delete;

    std::vector<uint8_t> encode (const float* interleaved, size_t numFrames)
    {
        size_t numSamples = numFrames * numChannels;

        if (converted.size() < numSamples)
            converted.resize (numSamples);

        for (size_t i = 0; i < numSamples; ++i)
        {
            float x = interleaved[i];
            x = x < -1.0f ? -1.0f : (x > 1.0f ? 1.0f : x);
            converted[i] = static_cast<FLAC__int32> (std::lrintf (x * 32767.0f));
        }

        bool ok = FLAC__stream_encoder_process_interleaved (encoder, converted.data(), static_cast<unsigned> (numFrames));

        if (! ok)
            throw std::runtime_error ("FLAC__stream_encoder_process_interleaved failed");

        std::vector<uint8_t> result;
        result.swap (pending);
        return result;
    }

    std::vector<uint8_t> finish()
    {
        if (! finished)
        {
            FLAC__stream_encoder_finish (encoder);
            finished = true;
        }

        std::vector<uint8_t> result;
        result.swap (pending);
        return result;
    }

private:
    static FLAC__StreamEncoderWriteStatus writeCallback (const FLAC__StreamEncoder*,
                                                           const FLAC__byte buffer[],
                                                           size_t bytes,
                                                           unsigned,
                                                           unsigned,
                                                           void* clientData)
    {
        auto* self = static_cast<FlacEncoder*> (clientData);
        self->pending.insert (self->pending.end(), buffer, buffer + bytes);
        return FLAC__STREAM_ENCODER_WRITE_STATUS_OK;
    }

    FLAC__StreamEncoder* encoder = nullptr;
    unsigned numChannels = 0;
    bool finished = false;
    std::vector<FLAC__int32> converted;
    std::vector<uint8_t> pending;
};
