#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

class DawBridgeAudioProcessorEditor : public juce::AudioProcessorEditor,
                                       private juce::Timer
{
public:
    explicit DawBridgeAudioProcessorEditor (DawBridgeAudioProcessor&);
    ~DawBridgeAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void updateJoinButton();

    // Named to avoid shadowing juce::AudioProcessorEditor::processor.
    DawBridgeAudioProcessor& owner;

    juce::Label titleLabel;
    juce::TextEditor roomCodeEditor;
    juce::TextButton joinButton;
    juce::Label statusLabel;
    juce::Label peersLabel;
    juce::Label meterCaptionLabel;

    juce::Rectangle<int> meterBounds;
    float displayLevel = 0.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DawBridgeAudioProcessorEditor)
};
