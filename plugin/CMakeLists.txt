cmake_minimum_required(VERSION 3.22)
project(DawBridge VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET 11.0 CACHE STRING "")

# libdatachannel vendors plog, which still declares cmake_minimum_required()
# below 3.5 - CMake 4 refuses that outright. Allow the older policy level for
# the fetched dependency tree.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)

option(COPY_PLUGINS "Install the built plug-ins into the user's plug-in folders" ON)

include(FetchContent)

# --- JUCE: audio plugin scaffolding, HTTP + JSON, and the GUI ---------------
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG        8.0.4
  GIT_SHALLOW    TRUE)

# --- libdatachannel: ICE + DTLS + SCTP. ------------------------------------
# Media support stays ON even though we never send RTP: the browser's offer
# contains audio and video m-lines, and libdatachannel needs to understand
# them well enough to reject them in the answer.
set(NO_EXAMPLES  ON  CACHE BOOL "" FORCE)
set(NO_TESTS     ON  CACHE BOOL "" FORCE)
set(NO_WEBSOCKET ON  CACHE BOOL "" FORCE)  # signalling is Firestore REST, not WS
# libdatachannel needs OpenSSL. Homebrew's is not on the default search path,
# so point at it on macOS only - other platforms use whatever CMake finds
# (on Windows CI that is the runner's own OpenSSL).
if(APPLE AND EXISTS /opt/homebrew/opt/openssl@3)
  set(OPENSSL_ROOT_DIR /opt/homebrew/opt/openssl@3 CACHE PATH "" FORCE)
endif()
FetchContent_Declare(libdatachannel
  GIT_REPOSITORY https://github.com/paullouisageneau/libdatachannel.git
  GIT_TAG        v0.22.4
  GIT_SHALLOW    TRUE)

FetchContent_MakeAvailable(JUCE libdatachannel)

# --- libFLAC: the same library libflacjs wraps in the browser, so the encoded
# bytes are byte-for-byte compatible with the web app's decoder. Fetched
# rather than taken from the system so Windows and CI need no package
# manager, and every platform gets the identical encoder. -------------------
set(BUILD_CXXLIBS    OFF CACHE BOOL "" FORCE)
set(BUILD_PROGRAMS   OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES   OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING    OFF CACHE BOOL "" FORCE)
set(BUILD_DOCS       OFF CACHE BOOL "" FORCE)
set(INSTALL_MANPAGES OFF CACHE BOOL "" FORCE)
set(WITH_OGG         OFF CACHE BOOL "" FORCE)
FetchContent_Declare(flac
  GIT_REPOSITORY https://github.com/xiph/flac.git
  GIT_TAG        1.4.3
  GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(flac)

juce_add_plugin(DawBridge
  PLUGIN_MANUFACTURER_CODE  Rtca
  PLUGIN_CODE               Dwbr
  COMPANY_NAME              "rtc-audio"
  PRODUCT_NAME              "RTC Audio Bridge"
  IS_SYNTH                  FALSE
  NEEDS_MIDI_INPUT          FALSE
  NEEDS_MIDI_OUTPUT         FALSE
  IS_MIDI_EFFECT            FALSE
  # Without NSMicrophoneUsageDescription in the bundle, macOS refuses audio
  # input outright - the app captures silence and never even shows up in
  # System Settings > Privacy > Microphone. The standalone build needs this to
  # hear anything at all.
  MICROPHONE_PERMISSION_ENABLED TRUE
  MICROPHONE_PERMISSION_TEXT "RTC Audio Bridge needs audio input to stream your audio to the web app."
  # Off on CI: installing into the user's plug-in folders is wrong there.
  COPY_PLUGIN_AFTER_BUILD   ${COPY_PLUGINS}
  FORMATS                   Standalone AU VST3)

target_sources(DawBridge PRIVATE
  src/PluginProcessor.cpp
  src/PluginEditor.cpp
  src/RoomClient.cpp)

target_compile_definitions(DawBridge PUBLIC
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_VST3_CAN_REPLACE_VST2=0
  JUCE_DISPLAY_SPLASH_SCREEN=0)

target_include_directories(DawBridge PRIVATE src)

target_link_libraries(DawBridge PRIVATE
  juce::juce_audio_utils
  LibDataChannel::LibDataChannel
  FLAC::FLAC
  PUBLIC
  juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags)

# --- self-check: FLAC wire-format parity with the browser encoder ----------
add_executable(flac_selfcheck tests/flac_selfcheck.cpp)
target_include_directories(flac_selfcheck PRIVATE src)
target_link_libraries(flac_selfcheck PRIVATE FLAC::FLAC)

# Headless end-to-end harness: joins a real room and streams a test tone, so
# the networking can be exercised without a DAW or any GUI interaction.
add_executable(room_smoke tests/room_smoke.cpp src/RoomClient.cpp)
target_include_directories(room_smoke PRIVATE src)
target_link_libraries(room_smoke PRIVATE
  juce::juce_audio_utils
  LibDataChannel::LibDataChannel
  FLAC::FLAC)
target_compile_definitions(room_smoke PRIVATE
  JUCE_STANDALONE_APPLICATION=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)

# Probe the live Firestore REST calls (see tests/firestore_probe.cpp).
add_executable(firestore_probe tests/firestore_probe.cpp)
target_include_directories(firestore_probe PRIVATE src)
target_link_libraries(firestore_probe PRIVATE juce::juce_audio_utils)
target_compile_definitions(firestore_probe PRIVATE
  JUCE_STANDALONE_APPLICATION=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)

# Resampler drift + pitch check (see tests/resampler_check.cpp).
add_executable(resampler_check tests/resampler_check.cpp)
target_include_directories(resampler_check PRIVATE src)
target_link_libraries(resampler_check PRIVATE juce::juce_audio_utils)
target_compile_definitions(resampler_check PRIVATE
  JUCE_STANDALONE_APPLICATION=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
