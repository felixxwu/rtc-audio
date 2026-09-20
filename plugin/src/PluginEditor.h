#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

// Flat, rounded buttons to match the dark theme.
struct FlatLookAndFeel : juce::LookAndFeel_V4
{
    void drawButtonBackground (juce::Graphics& g, juce::Button& b, const juce::Colour& bg,
                               bool hover, bool down) override
    {
        auto c = bg.withAlpha (b.isEnabled() ? 1.0f : 0.35f);
        if (down) c = c.darker (0.2f);
        else if (hover) c = c.brighter (0.15f);
        g.setColour (c);
        g.fillRoundedRectangle (b.getLocalBounds().toFloat(), b.getHeight() / 2.0f) /* pill, like the web buttons */;
    }
};

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

    FlatLookAndFeel lnf; // declared first so it outlives the components using it

    // Named to avoid shadowing juce::AudioProcessorEditor::processor.
    DawBridgeAudioProcessor& owner;

    juce::Label titleLabel;
    juce::TextEditor roomCodeEditor;
    juce::TextButton joinButton;
    juce::Label statusLabel;
    juce::Label peersLabel;
    juce::Label meterCaptionLabel;

    juce::Rectangle<int> meterBounds, cardBounds;
    juce::Rectangle<float> dotBounds;
    float displayLevel = 0.0f;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (DawBridgeAudioProcessorEditor)
};
