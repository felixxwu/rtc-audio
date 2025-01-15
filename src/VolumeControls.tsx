import {
  Icon,
  // MicEmpty,
  // MicFull,
  // MicHalf,
  SpeakerLoud,
  SpeakerMedium,
  SpeakerQuiet,
} from './Icon.tsx';
import { colors } from './colors.ts';
import styled from 'styled-components';
import { useEffect, useState } from 'react';
import { refs } from './refs.ts';

export const ICON_SIZE = 24;
export const STEP = 0.05;

export function VolumeControls() {
  // const [micVolume, setMicVolume] = useState(1);
  const [speakerVolume, setSpeakerVolume] = useState(1);

  // useEffect(() => {
  //   if (refs.gainNode) {
  //     refs.gainNode.gain.value = micVolume;
  //   }
  // }, [micVolume]);

  useEffect(() => {
    refs.audio.volume = speakerVolume;
  }, [speakerVolume]);

  // const micIcon = [MicEmpty, MicHalf, MicFull][Math.round(micVolume * 2)];
  const speakerIcon = [SpeakerQuiet, SpeakerMedium, SpeakerLoud][
    Math.round(speakerVolume * 2)
  ];

  // const handleMicIconClick = () => {
  //   setMicVolume(micVolume === 0 ? 1 : 0);
  // };

  const handleSpeakerIconClick = () => {
    setSpeakerVolume(speakerVolume === 0 ? 1 : 0);
  };

  return (
    <>
      {/*<Row>*/}
      {/*  <IconWrapper onClick={handleMicIconClick}>*/}
      {/*    <Icon path={micIcon} size={ICON_SIZE} color={colors.accent2} />*/}
      {/*  </IconWrapper>*/}
      {/*  <RangeInput*/}
      {/*    type="range"*/}
      {/*    value={micVolume}*/}
      {/*    min={0}*/}
      {/*    max={1}*/}
      {/*    step={STEP}*/}
      {/*    onChange={(e) => setMicVolume(Number(e.target.value))}*/}
      {/*  />*/}
      {/*</Row>*/}
      <Row>
        <IconWrapper onClick={handleSpeakerIconClick}>
          <Icon path={speakerIcon} size={ICON_SIZE} color={colors.accent2} />
        </IconWrapper>
        <RangeInput
          type="range"
          value={speakerVolume}
          min={0}
          max={1}
          step={STEP}
          onChange={(e) => setSpeakerVolume(Number(e.target.value))}
        />
      </Row>
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

const IconWrapper = styled('div')`
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
`;
