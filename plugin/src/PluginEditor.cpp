#include "PluginEditor.h"

namespace
{
    constexpr int kMargin = 16;
}

DawBridgeAudioProcessorEditor::DawBridgeAudioProcessorEditor (DawBridgeAudioProcessor& p)
    : AudioProcessorEditor (&p), owner (p)
{
    titleLabel.setText ("RTC Audio Bridge", juce::dontSendNotification);
    titleLabel.setJustificationType (juce::Justification::centred);
    titleLabel.setFont (juce::Font (juce::FontOptions (20.0f, juce::Font::bold)));
    addAndMakeVisible (titleLabel);

    roomCodeEditor.setTextToShowWhenEmpty ("room code", juce::Colours::grey);
    roomCodeEditor.setText (owner.getRoomCode(), juce::dontSendNotification);
    roomCodeEditor.onTextChange = [this]
    {
        owner.setRoomCode (roomCodeEditor.getText());
        updateJoinButton();
    };
    addAndMakeVisible (roomCodeEditor);

    joinButton.onClick = [this]
    {
        auto& room = owner.getRoom();

        if (room.state() == RoomClient::State::Idle || room.state() == RoomClient::State::Failed)
            room.join (roomCodeEditor.getText().trim());
        else
            room.leave();

        updateJoinButton();
    };
    addAndMakeVisible (joinButton);

    statusLabel.setJustificationType (juce::Justification::centred);
    addAndMakeVisible (statusLabel);

    peersLabel.setJustificationType (juce::Justification::centred);
    addAndMakeVisible (peersLabel);

    meterCaptionLabel.setText ("level", juce::dontSendNotification);
    meterCaptionLabel.setJustificationType (juce::Justification::centredLeft);
    meterCaptionLabel.setFont (juce::Font (juce::FontOptions (12.0f)));
    addAndMakeVisible (meterCaptionLabel);

    updateJoinButton();

    // 28 title + 8 + 28 roomcode + 8 + 28 button + 12 + 22 status + 22 peers + 12 + 16 caption + 22 meter = 206
    setSize (420, 206 + 2 * kMargin);
    setResizable (false, false);

    startTimerHz (30);
}

DawBridgeAudioProcessorEditor::~DawBridgeAudioProcessorEditor()
{
    stopTimer();
}

void DawBridgeAudioProcessorEditor::updateJoinButton()
{
    auto& room = owner.getRoom();
    const bool joined = ! (room.state() == RoomClient::State::Idle || room.state() == RoomClient::State::Failed);

    joinButton.setButtonText (joined ? "Leave" : "Join");

    const bool codeEmpty = roomCodeEditor.getText().trim().isEmpty();
    joinButton.setEnabled (joined || ! codeEmpty);
}

void DawBridgeAudioProcessorEditor::timerCallback()
{
    updateJoinButton();

    auto& room = owner.getRoom();
    statusLabel.setText (room.statusText(), juce::dontSendNotification);

    const auto peers = room.connectedPeers();
    juce::String peersText = peers == 0 ? "no listeners"
                            : peers == 1 ? "1 listener"
                                         : juce::String (peers) + " listeners";
    peersLabel.setText (peersText, juce::dontSendNotification);

    const auto newLevel = juce::jlimit (0.0f, 1.0f, room.outputLevel());

    // Peak-hold with decay: jump up instantly, fall off at 0.85^tick (~natural decay at 30 Hz).
    if (newLevel > displayLevel)
        displayLevel = newLevel;
    else
        displayLevel *= 0.85f;

    repaint (meterBounds);
}

void DawBridgeAudioProcessorEditor::resized()
{
    auto area = getLocalBounds().reduced (kMargin);

    titleLabel.setBounds (area.removeFromTop (28));
    area.removeFromTop (8);

    roomCodeEditor.setBounds (area.removeFromTop (28));
    area.removeFromTop (8);

    joinButton.setBounds (area.removeFromTop (28).withSizeKeepingCentre (120, 28));
    area.removeFromTop (12);

    statusLabel.setBounds (area.removeFromTop (22));
    peersLabel.setBounds (area.removeFromTop (22));
    area.removeFromTop (12);

    meterCaptionLabel.setBounds (area.removeFromTop (16));
    meterBounds = area.removeFromTop (22);
}

void DawBridgeAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (getLookAndFeel().findColour (juce::ResizableWindow::backgroundColourId));

    const auto bounds = meterBounds.toFloat();
    g.setColour (juce::Colours::black.withAlpha (0.6f));
    g.fillRoundedRectangle (bounds, 4.0f);
    g.setColour (juce::Colours::grey);
    g.drawRoundedRectangle (bounds, 4.0f, 1.0f);

    // Map -60..0 dB onto 0..1 so normal programme material isn't stuck near the left edge.
    const auto db = juce::Decibels::gainToDecibels (displayLevel, -60.0f);
    const auto normalised = juce::jlimit (0.0f, 1.0f, (db + 60.0f) / 60.0f);
    const auto safeNormalised = std::isnan (normalised) ? 0.0f : normalised;

    auto filled = bounds;
    filled.setWidth (filled.getWidth() * safeNormalised);

    const auto colour = safeNormalised > 0.9f ? juce::Colours::red
                                               : juce::Colour::fromRGB (60, 200, 90);
    g.setColour (colour);
    g.fillRoundedRectangle (filled, 4.0f);
}
