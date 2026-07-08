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
import { saveVolume } from './volumeStorage.ts';

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
    saveVolume('share', shareVolume);
    updateTransmission();
  }, [shareVolume]);

  const handleShare = async () => {
    setHint('');
    try {
      const { hasAudio, hasVideo } = await startShareAudio(() =>
        setSharing(false)
      );
      setSharing(true);
      if (hasVideo && !hasAudio) {
        setHint(
          'Sharing screen only — no audio was captured. If you meant to ' +
            'share sound, stop and re-share with "Also share audio" enabled.'
        );
      }
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
    setHint('');
  };

  const content = !sharing ? (
    <p>
      <Button onClick={handleShare}>Share tab/window</Button>
    </p>
  ) : (
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
          {/* Match the mic row's gear width so this slider aligns too. */}
          <Spacer />
        </Row>
      )}
      <p>
        <Button onClick={handleStop}>Stop sharing</Button>
      </p>
    </>
  );

  return (
    <>
      {content}
      {hint && (
        <Backdrop onClick={() => setHint('')}>
          <Dialog onClick={(e) => e.stopPropagation()}>
            <p>{hint}</p>
            <Button onClick={() => setHint('')}>Got it</Button>
          </Dialog>
        </Backdrop>
      )}
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

const Spacer = styled('div')`
  width: 24px;
`;

const Backdrop = styled('div')`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 25;
`;

const Dialog = styled('div')`
  background: ${colors.bg};
  border: 1px solid ${colors.accent};
  border-radius: 12px;
  padding: 20px 24px;
  width: min(90vw, 400px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  line-height: 1.5;
  color: ${colors.accent2};
`;
