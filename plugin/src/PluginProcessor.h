#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "RoomClient.h"

class DawBridgeAudioProcessor : public juce::AudioProcessor
{
public:
    DawBridgeAudioProcessor();
    ~DawBridgeAudioProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;

    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "RTC Audio Bridge"; }

    bool acceptsMidi() const override  { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override                        { return 1; }
    int getCurrentProgram() override                      { return 0; }
    void setCurrentProgram (int) override                 {}
    const juce::String getProgramName (int) override      { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    RoomClient& getRoom() { return room; }
    juce::String getRoomCode() const { return roomCode; }
    void setRoomCode (const juce::String& newCode) { roomCode = newCode; }

private:
    RoomClient room;
    juce::String roomCode;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DawBridgeAudioProcessor)
};
