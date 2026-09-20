#include "FlacEncoder.h"

#include <FLAC/stream_decoder.h>

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <vector>

namespace
{
    constexpr double kPi = 3.14159265358979323846;

    struct DecoderContext
    {
        const uint8_t* data;
        size_t size;
        size_t pos = 0;

        std::vector<int32_t> left;
        std::vector<int32_t> right;
        unsigned channels = 0;
        unsigned sampleRate = 0;
    };

    FLAC__StreamDecoderReadStatus readCallback (const FLAC__StreamDecoder*, FLAC__byte buffer[], size_t* bytes, void* clientData)
    {
        auto* ctx = static_cast<DecoderContext*> (clientData);

        size_t remaining = ctx->size - ctx->pos;
        size_t toCopy = *bytes < remaining ? *bytes : remaining;

        if (toCopy == 0)
        {
            *bytes = 0;
            return FLAC__STREAM_DECODER_READ_STATUS_END_OF_STREAM;
        }

        std::memcpy (buffer, ctx->data + ctx->pos, toCopy);
        ctx->pos += toCopy;
        *bytes = toCopy;
        return FLAC__STREAM_DECODER_READ_STATUS_CONTINUE;
    }

    FLAC__StreamDecoderWriteStatus writeCallback (const FLAC__StreamDecoder*, const FLAC__Frame* frame, const FLAC__int32* const buffer[], void* clientData)
    {
        auto* ctx = static_cast<DecoderContext*> (clientData);
        ctx->channels = frame->header.channels;
        ctx->sampleRate = frame->header.sample_rate;

        for (unsigned i = 0; i < frame->header.blocksize; ++i)
        {
            ctx->left.push_back (buffer[0][i]);
            ctx->right.push_back (buffer[1][i]);
        }

        return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
    }

    void metadataCallback (const FLAC__StreamDecoder*, const FLAC__StreamMetadata*, void*) {}

    void errorCallback (const FLAC__StreamDecoder*, FLAC__StreamDecoderErrorStatus status, void*)
    {
        std::fprintf (stderr, "decoder error: %s\n", FLAC__StreamDecoderErrorStatusString[status]);
        assert (false && "FLAC decoder reported an error");
    }
}

int main()
{
    const unsigned sampleRate = 48000;
    const unsigned channels = 2;
    const size_t framesPerBlock = 4096;
    const size_t numBlocks = 10;
    const size_t totalFrames = framesPerBlock * numBlocks;

    FlacEncoder encoder (sampleRate, channels);

    std::vector<uint8_t> encoded;
    std::vector<float> original;
    original.reserve (totalFrames * channels);

    std::vector<float> block (framesPerBlock * channels);

    uint64_t t = 0;
    for (size_t b = 0; b < numBlocks; ++b)
    {
        for (size_t i = 0; i < framesPerBlock; ++i)
        {
            float left = static_cast<float> (std::sin (2.0 * kPi * 440.0 * static_cast<double> (t) / sampleRate) * 0.5);
            float right = static_cast<float> (std::sin (2.0 * kPi * 660.0 * static_cast<double> (t) / sampleRate) * 0.5);

            block[i * channels + 0] = left;
            block[i * channels + 1] = right;

            original.push_back (left);
            original.push_back (right);

            ++t;
        }

        std::vector<uint8_t> out = encoder.encode (block.data(), framesPerBlock);
        encoded.insert (encoded.end(), out.begin(), out.end());
    }

    std::vector<uint8_t> tail = encoder.finish();
    encoded.insert (encoded.end(), tail.begin(), tail.end());

    assert (! encoded.empty());
    assert (encoded.size() >= 4);
    assert (encoded[0] == 'f' && encoded[1] == 'L' && encoded[2] == 'a' && encoded[3] == 'C');

    DecoderContext ctx;
    ctx.data = encoded.data();
    ctx.size = encoded.size();

    FLAC__StreamDecoder* decoder = FLAC__stream_decoder_new();
    assert (decoder != nullptr);

    FLAC__StreamDecoderInitStatus initStatus = FLAC__stream_decoder_init_stream (
        decoder,
        readCallback,
        nullptr, // seek
        nullptr, // tell
        nullptr, // length
        nullptr, // eof
        writeCallback,
        metadataCallback,
        errorCallback,
        &ctx);

    assert (initStatus == FLAC__STREAM_DECODER_INIT_STATUS_OK);

    bool ok = FLAC__stream_decoder_process_until_end_of_stream (decoder);
    assert (ok);

    FLAC__stream_decoder_finish (decoder);
    FLAC__stream_decoder_delete (decoder);

    assert (ctx.left.size() == totalFrames);
    assert (ctx.right.size() == totalFrames);
    assert (ctx.channels == channels);
    assert (ctx.sampleRate == sampleRate);

    for (size_t i = 0; i < totalFrames; ++i)
    {
        double decodedLeft = ctx.left[i] / 32767.0;
        double decodedRight = ctx.right[i] / 32767.0;

        assert (std::fabs (decodedLeft - original[i * channels + 0]) < 1e-4);
        assert (std::fabs (decodedRight - original[i * channels + 1]) < 1e-4);
    }

    std::printf ("flac_selfcheck: OK (%zu bytes, %zu frames)\n", encoded.size(), totalFrames);
    return 0;
}
