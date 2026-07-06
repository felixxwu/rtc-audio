import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Icon, MusicNote } from './Icon.tsx';
import { colors } from './colors.ts';
import { refs } from './refs.ts';
import { Button } from './Button.tsx';
import { ICON_SIZE, STEP } from './VolumeControls.tsx';
import {
  NoAudioTrackError,
  startShareAudio,
  stopShareAudio,
} from './shareAudio.ts';
import { updateTransmission } from './transmission.ts';

export function ShareAudioControls() {
  const [sharing, setSharing] = useState(
    refs.shareStream !== null || refs.shareVideoTrack !== null
  );
  const [shareVolume, setShareVolume] = useState(refs.shareVolume);
  const [hint, setHint] = useState('');

  useEffect(() => {
    refs.shareVolume = shareVolume;
    if (refs.shareGainNode) {
      refs.shareGainNode.gain.value = shareVolume;
    }
    updateTransmission();
  }, [shareVolume]);

  const handleShare = async () => {
    setHint('');
    try {
      await startShareAudio(() => setSharing(false));
      setSharing(true);
    } catch (e) {
      if (e instanceof NoAudioTrackError) {
        setHint(
          'Nothing to share from the selected source. For audio, pick a ' +
            'tab or window and tick "Also share audio" in the dialog.'
        );
      } else if ((e as Error).name !== 'NotAllowedError') {
        // NotAllowedError is the user cancelling the picker — not an error.
        console.error(e);
        setHint((e as Error).message);
      }
    }
  };

  const handleStop = () => {
    stopShareAudio();
    setSharing(false);
  };

  if (!sharing) {
    return (
      <>
        <p>
          <Button onClick={handleShare}>Share tab/window</Button>
        </p>
        {hint && <Hint>{hint}</Hint>}
      </>
    );
  }

  return (
    <>
      {refs.shareStream !== null && (
        <Row>
          <Icon path={MusicNote} size={ICON_SIZE} color={colors.accent2} />
          <RangeInput
            type="range"
            value={shareVolume}
            min={0}
            max={1}
            step={STEP}
            onChange={(e) => setShareVolume(Number(e.target.value))}
          />
        </Row>
      )}
      <p>
        <Button onClick={handleStop}>Stop sharing</Button>
      </p>
    </>
  );
}

const Row = styled('div')`
  display: flex;
  align-items: center;
  gap: 15px;
`;

const RangeInput = styled('input')`
  width: 200px;
  accent-color: ${colors.accent2};
`;

const Hint = styled('p')`
  color: ${colors.accent2};
  max-width: 400px;
`;
