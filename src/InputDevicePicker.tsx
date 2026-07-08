import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { Icon, Gear } from './Icon.tsx';
import { refs } from './refs.ts';
import { switchInputDevice } from './audioInput.ts';

// A gear beside the mic slider that opens a small menu to pick the audio
// input — e.g. an interface's loopback channel, so a DAW on exclusive/ASIO
// output can still be captured (routed back as an input).
export function InputDevicePicker() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(refs.inputDeviceId);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) =>
          // Real inputs have a non-empty deviceId; the explicit "Default"
          // option below covers the system default.
          setDevices(
            list.filter((d) => d.kind === 'audioinput' && d.deviceId)
          )
        )
        .catch(() => {});
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () =>
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = async (id: string) => {
    setOpen(false);
    const previous = selected;
    setSelected(id);
    try {
      await switchInputDevice(id);
    } catch {
      setSelected(previous); // device couldn't be opened — revert
    }
  };

  return (
    <Wrap ref={wrapRef}>
      <IconButton onClick={() => setOpen((o) => !o)} title="Choose input">
        <Icon path={Gear} size={18} color={colors.accent2} />
      </IconButton>
      {open && (
        <Menu>
          <MenuItem $active={selected === ''} onClick={() => pick('')}>
            Default
          </MenuItem>
          {devices.map((device, i) => (
            <MenuItem
              key={device.deviceId}
              $active={selected === device.deviceId}
              onClick={() => pick(device.deviceId)}
            >
              {device.label || `Microphone ${i + 1}`}
            </MenuItem>
          ))}
        </Menu>
      )}
    </Wrap>
  );
}

const Wrap = styled('div')`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
`;

const IconButton = styled('button')`
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
`;

const Menu = styled('div')`
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: ${colors.bg};
  border: 1px solid ${colors.accent};
  border-radius: 8px;
  padding: 4px;
  min-width: 180px;
  max-width: 260px;
  z-index: 15;
`;

const MenuItem = styled('div')<{ $active?: boolean }>`
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${(p) => (p.$active ? colors.accent : colors.accent2)};
  &:hover {
    background: rgba(170, 170, 255, 0.15);
  }
`;
