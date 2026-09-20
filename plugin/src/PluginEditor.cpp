#include "PluginEditor.h"

namespace
{
    constexpr int kMargin = 20;

    // Mirrors src/util/colors.ts and the web app's boxes.
    const auto kBg      = juce::Colour (0xff222222);
    const auto kCard    = juce::Colour (0xff1a1a1a);
    const auto kBorder  = juce::Colour (0xff808080);
    const auto kText    = juce::Colours::white;
    const auto kMuted   = juce::Colour (0xff949494);
    const auto kAccent  = juce::Colour (0xffaaaaff);
    const auto kGood    = juce::Colour (0xff6fcf97);
    const auto kWarn    = juce::Colour (0xffe0c060);
    const auto kBad     = juce::Colour (0xffe07070);
}

DawBridgeAudioProcessorEditor::DawBridgeAudioProcessorEditor (DawBridgeAudioProcessor& p)
    : AudioProcessorEditor (&p), owner (p)
{
    setLookAndFeel (&lnf);

    titleLabel.setText ("RTC Audio Bridge", juce::dontSendNotification);
    titleLabel.setJustificationType (juce::Justification::centredLeft);
    titleLabel.setFont (juce::Font (juce::FontOptions (20.0f, juce::Font::bold)));
    titleLabel.setColour (juce::Label::textColourId, kText);
    addAndMakeVisible (titleLabel);

    roomCodeEditor.setFont (juce::Font (juce::FontOptions (18.0f, juce::Font::bold)));
    roomCodeEditor.setJustification (juce::Justification::centredLeft);
    roomCodeEditor.setIndents (12, 0);
    roomCodeEditor.setColour (juce::TextEditor::backgroundColourId, kBg.darker (0.4f));
    roomCodeEditor.setColour (juce::TextEditor::textColourId, kText);
    roomCodeEditor.setColour (juce::TextEditor::outlineColourId, kBorder);
    roomCodeEditor.setColour (juce::TextEditor::focusedOutlineColourId, kAccent);
    roomCodeEditor.setColour (juce::CaretComponent::caretColourId, kAccent);
    roomCodeEditor.setTextToShowWhenEmpty ("Room code", kMuted);
    roomCodeEditor.setText (owner.getRoomCode(), juce::dontSendNotification);
    roomCodeEditor.onTextChange = [this]
    {
        owner.setRoomCode (roomCodeEditor.getText());
        updateJoinButton();
    };
    addAndMakeVisible (roomCodeEditor);

    joinButton.setColour (juce::TextButton::buttonColourId, kBorder);
    joinButton.setColour (juce::TextButton::textColourOffId, juce::Colours::white);
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

    statusLabel.setJustificationType (juce::Justification::centredLeft);
    statusLabel.setColour (juce::Label::textColourId, kText);
    addAndMakeVisible (statusLabel);

    peersLabel.setJustificationType (juce::Justification::centredRight);
    peersLabel.setColour (juce::Label::textColourId, kMuted);
    addAndMakeVisible (peersLabel);

    meterCaptionLabel.setText ("OUTPUT LEVEL", juce::dontSendNotification);
    meterCaptionLabel.setJustificationType (juce::Justification::centredLeft);
    meterCaptionLabel.setFont (juce::Font (juce::FontOptions (11.0f, juce::Font::bold)));
    meterCaptionLabel.setColour (juce::Label::textColourId, kMuted);
    addAndMakeVisible (meterCaptionLabel);

    updateJoinButton();

    setSize (420, 300);
    setResizable (false, false);

    startTimerHz (30);
}

DawBridgeAudioProcessorEditor::~DawBridgeAudioProcessorEditor()
{
    stopTimer();
    setLookAndFeel (nullptr);
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

    repaint();
}

void DawBridgeAudioProcessorEditor::resized()
{
    auto area = getLocalBounds().reduced (kMargin);

    titleLabel.setBounds (area.removeFromTop (32).withTrimmedLeft (18)); // room for the status dot
    area.removeFromTop (14);

    // Card: room code + join, then status row.
    cardBounds = area.removeFromTop (120);
    auto card = cardBounds.reduced (16);
    auto row = card.removeFromTop (40);
    joinButton.setBounds (row.removeFromRight (88));
    row.removeFromRight (10);
    roomCodeEditor.setBounds (row);
    card.removeFromTop (14);
    auto info = card.removeFromTop (22);
    peersLabel.setBounds (info.removeFromRight (110));
    statusLabel.setBounds (info.withTrimmedLeft (16)); // room for the dot
    dotBounds = juce::Rectangle<float> (0, 0, 8, 8).withCentre ({ (float) info.getX() + 4.0f, (float) info.getCentreY() });

    area.removeFromTop (16);
    meterCaptionLabel.setBounds (area.removeFromTop (16));
    area.removeFromTop (4);
    meterBounds = area.removeFromTop (14);
}

void DawBridgeAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (kBg);

    g.setColour (kCard);
    g.fillRoundedRectangle (cardBounds.toFloat(), 12.0f);
    g.setColour (kBorder.withAlpha (0.5f));
    g.drawRoundedRectangle (cardBounds.toFloat().reduced (0.5f), 12.0f, 1.0f);

    // Header accent dot next to the title.
    g.setColour (kAccent);
    g.fillEllipse (juce::Rectangle<float> (10, 10).withCentre ({ (float) kMargin + 5.0f, (float) kMargin + 16.0f }));

    // Status dot colour follows connection state.
    const auto state = owner.getRoom().state();
    const bool live = state == RoomClient::State::Streaming;
    const bool failed = state == RoomClient::State::Failed;
    const bool idle = state == RoomClient::State::Idle;
    g.setColour (live ? kGood : failed ? kBad : idle ? kMuted : kWarn);
    g.fillEllipse (dotBounds);

    // Meter: pill track with gradient fill.
    const auto bounds = meterBounds.toFloat();
    const auto r = bounds.getHeight() / 2.0f;
    g.setColour (kBg);
    g.fillRoundedRectangle (bounds, r);
    g.setColour (kBorder);
    g.drawRoundedRectangle (bounds.reduced (0.5f), r, 1.0f);

    // Map -60..0 dB onto 0..1 so normal programme material isn't stuck near the left edge.
    const auto db = juce::Decibels::gainToDecibels (displayLevel, -60.0f);
    const auto normalised = juce::jlimit (0.0f, 1.0f, (db + 60.0f) / 60.0f);
    const auto safeNormalised = std::isnan (normalised) ? 0.0f : normalised;

    auto filled = bounds.reduced (2.0f);
    filled.setWidth (juce::jmax (filled.getHeight(), filled.getWidth() * safeNormalised));
    if (safeNormalised > 0.0f)
    {
        g.setColour (safeNormalised > 0.9f ? kBad : kAccent);
        g.fillRoundedRectangle (filled, filled.getHeight() / 2.0f);
    }
}
