import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { colors } from '../util/colors.ts';
import { Modal } from './Popup.tsx';
import { Button } from './Button.tsx';
import { refs } from '../rtc/refs.ts';
import { switchInputDevice } from '../audio/audioInput.ts';
import { leaveRoom } from '../rtc/room.ts';
import { saveAudioCodec, type AudioCodec } from '../codec/audioCodec.ts';
import {
  reconcileTransmission,
  whenTransmissionSettled,
} from '../codec/losslessSender.ts';
import { flacReady } from '../codec/flacLoader.ts';

export type Stats = {
  bitrateKbps: number;
  outgoingKbps: number[];
  totalInKbps: number;
  totalOutKbps: number;
  packetLossPercent: number;
  jitterMs: number;
};

// Native <select> for the audio input: its dropdown is a browser-native popup,
// so it's never clipped by the dialog bounds (unlike the gear menu was).
function InputSelect() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(refs.inputDeviceId);

  useEffect(() => {
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) =>
          setDevices(list.filter((d) => d.kind === 'audioinput' && d.deviceId))
        )
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () =>
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  const pick = async (id: string) => {
    const previous = selected;
    setSelected(id);
    try {
      await switchInputDevice(id);
    } catch {
      setSelected(previous); // device couldn't be opened — revert
    }
  };

  return (
    <Field>
      <Label>Audio input</Label>
      <Select value={selected} onChange={(e) => pick(e.target.value)}>
        <option value="">Default</option>
        {devices.map((device, i) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </Select>
    </Field>
  );
}

// Outbound audio codec. 'opus' = unchanged RTP path; 'flac' = lossless over a
// data channel (higher bandwidth). FLAC is disabled if its module can't load.
function CodecSelect() {
  const [codec, setCodec] = useState<AudioCodec>(refs.audioCodec);
  const [flacAvailable, setFlacAvailable] = useState(true);

  useEffect(() => {
    flacReady()
      .then(() => setFlacAvailable(true))
      .catch(() => setFlacAvailable(false));
  }, []);

  const pick = async (next: AudioCodec) => {
    setCodec(next); // optimistic
    refs.audioCodec = next;
    saveAudioCodec(next);
    reconcileTransmission();
    // Wait for the pipeline to settle, then reflect the codec actually in
    // effect — FLAC may have fallen back to Opus if it couldn't start.
    await whenTransmissionSettled();
    setCodec(refs.audioCodec);
    saveAudioCodec(refs.audioCodec);
  };

  return (
    <Field>
      <Label>Audio codec</Label>
      <Select
        value={codec}
        onChange={(e) => pick(e.target.value as AudioCodec)}
      >
        <option value="opus">Opus (near lossless - variable bitrate)</option>
        <option value="flac" disabled={!flacAvailable}>
          FLAC (lossless - may stutter on low bandwidth){flacAvailable ? '' : ' — unavailable'}
        </option>
      </Select>
    </Field>
  );
}

export function SettingsPopup({
  onClose,
  stats,
}: {
  onClose: () => void;
  stats: Stats;
}) {
  const {
    bitrateKbps,
    outgoingKbps,
    totalInKbps,
    totalOutKbps,
    packetLossPercent,
    jitterMs,
  } = stats;
  return (
    <Modal onClose={onClose} title="Settings">
      <InputSelect />
      <CodecSelect />
      <Field>
        <Label>Connection</Label>
        <Stat>
          Audio ↓ {bitrateKbps} ↑ {outgoingKbps.reduce((s, k) => s + k, 0)}{' '}
          kb/s
          <br />
          Total ↓ {totalInKbps} ↑ {totalOutKbps} kb/s
          <br />
          Packet loss: {packetLossPercent}% | Jitter: {jitterMs} ms
        </Stat>
      </Field>
      <LeaveButton onClick={leaveRoom}>Leave session</LeaveButton>
    </Modal>
  );
}

const Field = styled('div')`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled('div')`
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
`;

const Select = styled('select')`
  background: #1a1a1a;
  color: ${colors.accent2};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 1em;
  cursor: pointer;
  width: 100%;
`;

const Stat = styled('div')`
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
`;

const LeaveButton = styled(Button)`
  align-self: stretch;
  margin-top: 4px;
  background-color: #e05656;
  color: #fff;

  &:hover {
    background-color: #ef6b6b;
  }
`;
