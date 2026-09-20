# RTC Audio Bridge (companion plugin) — v0

Streams a DAW's audio into an [rtc-audio](../README.md) room **without going
through the OS audio stack**, so it still works when the DAW has taken
exclusive control of the interface (Ableton + ASIO, CoreAudio hog mode) and
neither microphone capture nor browser screen-share can see the audio.

The plugin is a real WebRTC peer. It joins the room itself and shows up as its
own participant — the browser tab is not involved in carrying the audio.

## What v0 does and does not do

| | |
|---|---|
| Send audio to the room | ✅ |
| Receive / play room audio | ❌ send-only, no decoder |
| Create offers | ❌ answer-only (see below) |
| Chat, cursors, files, video, stats | ❌ |
| Sample rates other than 48 kHz | ✅ resampled to 48 kHz |
| AU / VST3 | ❌ standalone app only in v0 |

## Design notes

**Wire format.** FLAC over the pre-negotiated `audio` data channel (id 2),
48 kHz / 2 ch / 16-bit / compression level 8 — byte-for-byte the settings in
`src/codec/flacCodec.ts`, because the browser decodes it with libflacjs, which
wraps the same libFLAC. `tests/flac_selfcheck.cpp` pins that parity.

**Answer-only.** The web app's glare rule is "whoever was already in the room
offers to the newcomer". The plugin publishes a `joinedAt` one year in the
future, so every browser peer considers itself the earlier joiner and offers
first. That removes the entire offerer code path from v0. The visible cost:
the plugin always sorts last in the participant list.

**Sample rate.** The wire format is fixed at 48 kHz, but the host can run at
anything: `StereoResampler` converts to 48 kHz on the audio thread, carrying
the interpolator's unconsumed tail between blocks so the stream does not drift
(`tests/resampler_check.cpp` measures both drift and pitch). A host already at
48 kHz bypasses the converter entirely and is bit-exact.

**Signalling** is Firestore's REST API, polled once a second. There is no
auth — the project's rules are open, same as the web app.

**Threading.** `processBlock` only copies interleaved floats into a lock-free
FIFO and returns; audio passes through untouched. A separate thread drains the
FIFO, encodes FLAC and sends. A third thread polls Firestore. Nothing
allocates or locks on the audio thread.

## Build

Needs CMake ≥ 3.22 and Homebrew `flac`. JUCE and libdatachannel are fetched
automatically on first configure (~600 MB, a few minutes).

```sh
brew install cmake ninja flac
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build
./build/flac_selfcheck                                   # wire-format parity
./build/resampler_check                                  # no drift, pitch preserved
open "build/DawBridge_artefacts/RelWithDebInfo/Standalone/RTC Audio Bridge.app"
```

To add the real plugin builds, change one line in `CMakeLists.txt`:
`FORMATS Standalone` → `FORMATS Standalone AU VST3`. The processor code does
not change.

## Use

1. Open the web app, create or join a session, note the room code.
2. Launch the standalone app, type the room code, hit **Join**.
3. Pick your DAW's output as the standalone app's input, or (once built as a
   plugin) drop it on the master chain. Any sample rate works.

`tests/room_smoke.cpp` is the headless version of all this:
`./build/room_smoke <room-code> <seconds> [host-rate]` joins a real room and
streams a test tone, which is how the 44.1 kHz path was verified end to end.

The app streams only while at least one browser peer is connected.
