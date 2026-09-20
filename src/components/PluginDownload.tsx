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
          </Note>

          {/* Collapsed by default: the paths matter only once, and the modal
              is meant to stay glanceable. */}
          <Details>
            <summary>Installation</summary>

            <Platform>macOS</Platform>
            <List>
              <li>
                AU &rarr; <Path>~/Library/Audio/Plug-Ins/Components</Path>
              </li>
              <li>
                VST3 &rarr; <Path>~/Library/Audio/Plug-Ins/VST3</Path>
              </li>
              <li>
                Unsigned, so the first launch is blocked: right-click it and
                choose Open, or allow it under System Settings &rarr; Privacy
                &amp; Security.
              </li>
            </List>

            <Platform>Windows</Platform>
            <List>
              <li>
                VST3 &rarr; <Path>C:\Program Files\Common Files\VST3</Path>
              </li>
              <li>
                Unsigned, so SmartScreen warns on first run: choose More info
                &rarr; Run anyway.
              </li>
            </List>

            <Platform>Then</Platform>
            <List>
              <li>Restart your DAW so it rescans for plugins.</li>
              <li>
                Put it on your master chain, paste this session&apos;s code in,
                and hit Join.
              </li>
              <li>
                No DAW? The download also includes a standalone app that takes
                any audio input.
              </li>
            </List>
          </Details>
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
  justify-content: center;
  gap: 10px;
`;

const Details = styled('details')`
  font-size: 0.85em;
  color: ${colors.border};
  text-align: left;

  summary {
    cursor: pointer;
    text-align: center;
    padding: 4px;
  }
`;

const Platform = styled('div')`
  color: ${colors.accent2};
  margin-top: 8px;
`;

const List = styled('ul')`
  margin: 4px 0;
  padding-left: 20px;
`;

// Paths wrap rather than stretching the dialog on a narrow screen.
const Path = styled('code')`
  word-break: break-all;
`;

const Note = styled('div')`
  font-size: 0.85em;
  color: ${colors.border};
`;
