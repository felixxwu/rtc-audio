import { useEffect, useReducer, useRef, useState } from 'react';
import styled from 'styled-components';
import { refs } from './refs.ts';
import { myPeerId } from './room.ts';
import { SELF } from './audioLevels.ts';
import { registerBox, unregisterBox } from './colorLoop.ts';
import { letterFor } from './participants.ts';
import { requestView } from './viewerControl.ts';
import { SettingsPopup, type Stats } from './SettingsPopup.tsx';
import {
  NoAudioTrackError,
  startShareAudio,
  stopShareAudio,
} from './shareAudio.ts';
import { Modal } from './Popup.tsx';
import { Button } from './Button.tsx';
import { reconcileTransmission } from './losslessSender.ts';
import { saveVolume } from './volumeStorage.ts';
import { circleColor } from './participantColor.ts';
import { colors } from './colors.ts';
import {
  CircleIcon,
  MicEmpty,
  MicHalf,
  MicFull,
  MicOff,
  MusicNote,
  MusicNoteOff,
  ScreenShare,
  StopScreenShare,
  Gear,
  Chat,
} from './Icon.tsx';

// One toolbar icon with an optional hover slider floating above it.
function IconSlider({
  path,
  value,
  onChange,
  onToggle,
  disabled,
  title,
  badge,
}: {
  path: string;
  value?: number;
  onChange?: (v: number) => void;
  onToggle?: () => void;
  disabled?: boolean;
  title: string;
  badge?: number;
}) {
  // Icons with an active slider reveal the slider on hover; the rest (the
  // three rightmost, and a disabled icon) get an instant custom tooltip.
  const hasSlider = !!onChange && !disabled;
  return (
    <IconCell $disabled={disabled}>
      {hasSlider ? (
        <SliderFloat data-slider>
          <SliderTitle>{title}</SliderTitle>
          <VerticalRange
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={value}
            onChange={(e) => onChange!(Number(e.target.value))}
          />
        </SliderFloat>
      ) : (
        <Tooltip data-tip>{title}</Tooltip>
      )}
      <IconButton onClick={disabled ? undefined : onToggle} $disabled={disabled}>
        <CircleIcon path={path} size={40} color={circleColor(myPeerId)} />
      </IconButton>
      {badge !== undefined && badge > 0 && <Badge>{badge > 99 ? '99+' : badge}</Badge>}
    </IconCell>
  );
}

export function SelfBox({
  stats,
  onToggleChat,
  chatUnread,
}: {
  stats: Stats;
  onToggleChat: () => void;
  chatUnread: number;
}) {
  const [micVolume, setMicVolume] = useState(refs.micVolume);
  const [shareVolume, setShareVolume] = useState(refs.shareVolume);
  const [sharingVideo, setSharingVideo] = useState(refs.shareVideoTrack !== null);
  const [hasShareAudio, setHasShareAudio] = useState(refs.shareStream !== null);
  const [popup, setPopup] = useState<null | 'settings'>(null);
  const [hint, setHint] = useState('');
  const [, tick] = useReducer((n: number) => n + 1, 0);

  const borderRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Poll share state (started/stopped, possibly by exclusive-share takeover).
  useEffect(() => {
    const interval = setInterval(() => {
      setSharingVideo(refs.shareVideoTrack !== null);
      setHasShareAudio(refs.shareStream !== null);
      tick();
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Colour loop registration: border reacts, hue from our own id, level from
  // the post-mute self meter.
  useEffect(() => {
    if (!borderRef.current) return;
    registerBox(SELF, {
      colorId: myPeerId,
      levelId: SELF,
      border: borderRef.current,
    });
    return () => unregisterBox(SELF);
  }, []);

  // Feed our own screen capture into the thumbnail.
  useEffect(() => {
    const v = videoRef.current;
    if (v && sharingVideo && refs.shareVideoTrack) {
      const track = refs.shareVideoTrack;
      const current =
        v.srcObject instanceof MediaStream
          ? v.srcObject.getVideoTracks()[0] ?? null
          : null;
      if (track !== current) {
        v.srcObject = new MediaStream([track]);
        v.play().catch(() => {});
      }
    }
  }, [sharingVideo]);

  useEffect(() => {
    refs.micVolume = micVolume;
    if (refs.micGainNode) refs.micGainNode.gain.value = micVolume;
    saveVolume('mic', micVolume);
    reconcileTransmission();
  }, [micVolume]);

  useEffect(() => {
    refs.shareVolume = shareVolume;
    if (refs.shareGainNode) refs.shareGainNode.gain.value = shareVolume;
    saveVolume('share', shareVolume);
    reconcileTransmission();
  }, [shareVolume]);

  const micIcon =
    micVolume === 0
      ? MicOff
      : [MicEmpty, MicHalf, MicFull][Math.round(micVolume * 2)];

  const handleShareToggle = async () => {
    if (sharingVideo || hasShareAudio) {
      stopShareAudio();
      setSharingVideo(false);
      setHasShareAudio(false);
      return;
    }
    setHint('');
    try {
      const { hasAudio, hasVideo } = await startShareAudio(() => {
        setSharingVideo(false);
        setHasShareAudio(false);
      });
      setSharingVideo(refs.shareVideoTrack !== null);
      setHasShareAudio(refs.shareStream !== null);
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

  return (
    <>
      <Wrapper>
        <Box ref={borderRef}>
          <Top>
            {sharingVideo ? (
              <Thumb
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onClick={() => requestView('host')}
              />
            ) : (
              <Circle style={{ background: circleColor(myPeerId) }}>
                {letterFor(myPeerId)}
              </Circle>
            )}
          </Top>
        </Box>
        <Toolbar>
            <IconSlider
              path={micIcon}
              value={micVolume}
              onChange={setMicVolume}
              onToggle={() => setMicVolume(micVolume === 0 ? 1 : 0)}
              title="Microphone"
            />
            <IconSlider
              path={shareVolume === 0 ? MusicNoteOff : MusicNote}
              value={shareVolume}
              onChange={setShareVolume}
              onToggle={() => setShareVolume(shareVolume === 0 ? 1 : 0)}
              disabled={!hasShareAudio}
              title="Shared audio"
            />
            <IconSlider
              path={sharingVideo || hasShareAudio ? StopScreenShare : ScreenShare}
              onToggle={handleShareToggle}
              title={sharingVideo || hasShareAudio ? 'Stop sharing' : 'Share screen'}
            />
            <IconSlider
              path={Chat}
              onToggle={onToggleChat}
              title="Chat"
              badge={chatUnread}
            />
            <IconSlider
              path={Gear}
              onToggle={() => setPopup('settings')}
              title="Settings"
            />
          </Toolbar>
      </Wrapper>
      {popup === 'settings' && (
        <SettingsPopup onClose={() => setPopup(null)} stats={stats} />
      )}
      {hint && (
        <Modal onClose={() => setHint('')} title="Screen sharing">
          <p>{hint}</p>
          <Button onClick={() => setHint('')}>Got it</Button>
        </Modal>
      )}
    </>
  );
}

// Stacks the self box and (below it) the toolbar, centred within the bottom
// dock section. The gap here plus the dock's bottom padding space the toolbar
// evenly between the box and the bottom of the screen.
const Wrapper = styled('div')`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`;

const Box = styled('div')`
  width: 280px;
  border: 3px solid #888;
  border-radius: 12px;
  background: #1a1a1a;
  display: flex;
  flex-direction: column;
`;

// The top region matches a participant box's shape (1.5:1) so the self box
// reads as one of them, with the toolbar added below.
const Top = styled('div')`
  aspect-ratio: 1.5 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* Match the box's inner radius (12px border-radius minus 3px border) on all
     corners so the video/circle never overlaps the reactive border. */
  border-radius: 9px;
`;

const Circle = styled('div')`
  height: 48%;
  aspect-ratio: 1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 600;
  color: #111;
`;

const Thumb = styled('video')`
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: pointer;
`;

const Toolbar = styled('div')`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
`;

const IconCell = styled('div')<{ $disabled?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: ${(p) => (p.$disabled ? 0.35 : 1)};

  /* :hover stays true while the pointer is over the floated slider because it
     is a DOM descendant — so the slider is reachable (unlike JS mouseleave). */
  & > [data-slider] {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
  }
  &:hover > [data-slider] {
    opacity: 1;
    pointer-events: auto;
  }

  /* Custom tooltip: shown instantly on hover (no browser title delay). */
  & > [data-tip] {
    opacity: 0;
    pointer-events: none;
  }
  &:hover > [data-tip] {
    opacity: 1;
  }
`;

// Unread-count bubble pinned to the top-right of the icon disc.
const Badge = styled('div')`
  position: absolute;
  top: 0;
  right: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  box-sizing: border-box;
  border-radius: 9px;
  background: ${colors.accent};
  color: #000;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  pointer-events: none;
`;

const IconButton = styled('button')<{ $disabled?: boolean }>`
  background: none;
  border: none;
  padding: 4px;
  cursor: ${(p) => (p.$disabled ? 'default' : 'pointer')};
  display: flex;
  align-items: center;
`;

const SliderFloat = styled('div')`
  position: absolute;
  /* Sit directly on top of the icon (no base gap), with a visual lift applied
     via margin below so the panel isn't flush against the disc. */
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 10px;
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 10px 6px;
  display: flex;
  align-items: center;
  justify-content: center;

  /* Transparent bridge wider and taller than the icon disc, covering the
     margin gap so moving the pointer from icon to slider never crosses a
     non-hovered dead zone. */
  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: -24px;
    right: -24px;
    height: 18px;
  }
`;

const Tooltip = styled('div')`
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 8px;
  background: ${colors.bg};
  border: 1px solid ${colors.border};
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 0.8rem;
  white-space: nowrap;
  color: ${colors.accent2};
`;

// Absolutely positioned so a long label (e.g. "Shared audio") doesn't widen
// the narrow menu around the slider.
const SliderTitle = styled('div')`
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  white-space: nowrap;
  font-size: 0.75rem;
  color: ${colors.accent2};
`;

// Native vertical range: narrow, and up = louder.
const VerticalRange = styled('input')`
  writing-mode: vertical-lr;
  direction: rtl;
  width: 22px;
  height: 110px;
  accent-color: ${colors.accent2};
`;
