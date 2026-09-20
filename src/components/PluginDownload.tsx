import { useState } from 'react';
import styled from 'styled-components';
import { colors } from '../util/colors.ts';
import { Download, Icon } from './Icon.tsx';
import { Modal } from './Popup.tsx';
import { Button } from './Button.tsx';

export function PluginDownloadButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Trigger onClick={() => setOpen(true)}>
        <Icon path={Download} color={colors.accent2} size={18} />
        Plugin
      </Trigger>

      {open && (
        <Modal onClose={() => setOpen(false)} title="Companion plugin">
          <p>
            When your DAW takes exclusive control of the audio interface, the
            browser can&apos;t capture its sound. This plugin sends it straight
            from the DAW instead.
          </p>
          <ButtonRow>
            <Button
              as="a"
              href="https://github.com/felixxwu/rtc-audio/releases/latest/download/rtc-audio-bridge-macos.zip"
              download
              target="_blank"
              rel="noreferrer"
            >
              macOS
            </Button>
            <Button
              as="a"
              href="https://github.com/felixxwu/rtc-audio/releases/latest/download/rtc-audio-bridge-windows.zip"
              download
              target="_blank"
              rel="noreferrer"
            >
              Windows
            </Button>
          </ButtonRow>
          <Note>
            Add it to your master chain, then enter this session&apos;s code.
            Unsigned, so macOS will ask you to allow it.
          </Note>
        </Modal>
      )}
    </>
  );
}

const Trigger = styled('button')`
  background: none;
  border: none;
  color: ${colors.accent2};
  cursor: pointer;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ButtonRow = styled('div')`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const Note = styled('div')`
  font-size: 0.85em;
  color: ${colors.border};
`;
