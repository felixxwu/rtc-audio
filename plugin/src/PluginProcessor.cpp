#include "PluginProcessor.h"
#include "PluginEditor.h"

DawBridgeAudioProcessor::DawBridgeAudioProcessor()
    : AudioProcessor (BusesProperties()
                           .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                           .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

bool DawBridgeAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();

    if (layouts.getMainInputChannelSet() != out)
        return false;

    return out == juce::AudioChannelSet::mono() || out == juce::AudioChannelSet::stereo();
}

void DawBridgeAudioProcessor::prepareToPlay (double sampleRate, int /*samplesPerBlock*/)
{
    room.prepare (sampleRate, getTotalNumInputChannels());
}

void DawBridgeAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    // Clear any output channel with no corresponding input, per the standard
    // JUCE contract. Every channel that DOES have input is left untouched -
    // this plugin must be a transparent passthrough on the master bus.
    for (auto ch = getTotalNumInputChannels(); ch < getTotalNumOutputChannels(); ++ch)
        buffer.clear (ch, 0, buffer.getNumSamples());

    // isNonRealtime() means the host is bouncing/freezing offline; don't stream that.
    if (! isNonRealtime())
        room.pushAudio (buffer.getArrayOfReadPointers(), buffer.getNumChannels(), buffer.getNumSamples());
}

juce::AudioProcessorEditor* DawBridgeAudioProcessor::createEditor()
{
    return new DawBridgeAudioProcessorEditor (*this);
}

void DawBridgeAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::XmlElement xml ("DawBridgeState");
    xml.setAttribute ("roomCode", roomCode);
    copyXmlToBinary (xml, destData);
}

void DawBridgeAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml (getXmlFromBinary (data, sizeInBytes));

    if (xml != nullptr && xml->hasTagName ("DawBridgeState"))
        roomCode = xml->getStringAttribute ("roomCode", roomCode);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new DawBridgeAudioProcessor();
}
