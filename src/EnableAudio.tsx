import { pc } from './pc.ts';
import styled from 'styled-components';
import { colors } from './colors.ts';
import { useState } from 'react';
import { refs } from './refs.ts';
import { Button } from './Button.tsx';

export function EnableAudio({
  setAudioEnabled,
}: {
  setAudioEnabled: (enabled: boolean) => void;
}) {
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [error, setError] = useState('');

  const handleEnableAudio = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          autoGainControl: false,
          channelCount: {
            ideal: 2,
          },
          echoCancellation: false,
          noiseSuppression: false,
          // Not in TS lib types yet; where supported, stops the browser
          // applying voice-focused processing that hurts music.
          ...{ voiceIsolation: false },
          // Match Opus's native 48kHz so nothing gets resampled on the way
          // to the encoder.
          sampleRate: 48000,
          sampleSize: 16,
        },
      });

      refs.audioContext = new AudioContext({
        latencyHint: 'playback',
        sampleRate: 48000,
      });
      refs.gainNode = refs.audioContext.createGain();

      // Route the mic through a gain node so its level can be adjusted;
      // the gain-adjusted stream is what gets sent to the peer.
      refs.micGainNode = refs.audioContext.createGain();
      const micDestination =
        refs.audioContext.createMediaStreamDestination();
      const source = refs.audioContext.createMediaStreamSource(localStream);
      source.connect(refs.micGainNode);
      refs.micGainNode.connect(micDestination);

      // Local monitor path, muted by default.
      refs.micGainNode.connect(refs.gainNode);
      refs.gainNode.connect(refs.audioContext.destination);
      refs.gainNode.gain.value = 0;

      const remoteStream = new MediaStream();

      // Push tracks from local stream to peer connection
      micDestination.stream.getTracks().forEach((track) => {
        // Tell the encoder this is music, not speech — prioritises fidelity
        // over intelligibility and avoids speech-tuned processing.
        track.contentHint = 'music';
        const sender = pc.addTrack(track, micDestination.stream);

        // Mark audio packets high priority (DSCP) so they win under
        // network contention. No-op in browsers that don't support it.
        const params = sender.getParameters();
        params.encodings.forEach((encoding) => {
          encoding.priority = 'high';
          encoding.networkPriority = 'high';
        });
        sender.setParameters(params).catch((e) => console.error(e));
      });

      // Prefer RED (in-band redundancy — strong packet loss protection)
      // with Opus next, and drop low-quality fallbacks (PCMU/PCMA etc.).
      pc.getTransceivers().forEach((transceiver) => {
        if (
          transceiver.sender.track?.kind !== 'audio' ||
          !('setCodecPreferences' in transceiver)
        ) {
          return;
        }
        const codecs = RTCRtpReceiver.getCapabilities('audio')?.codecs ?? [];
        const byMimeType = (mimeType: string) =>
          codecs.filter((c) => c.mimeType.toLowerCase() === mimeType);
        const preferred = [
          ...byMimeType('audio/red'),
          ...byMimeType('audio/opus'),
        ];
        if (preferred.length) transceiver.setCodecPreferences(preferred);
      });

      // Pull tracks from remote stream, add to video stream
      pc.ontrack = (event) => {
        // Prefer stability over latency: buffer up to 500ms rather than
        // glitch on jitter — right trade-off for one-way music streaming.
        if ('jitterBufferTarget' in event.receiver) {
          event.receiver.jitterBufferTarget = 500;
        } else if ('playoutDelayHint' in event.receiver) {
          // legacy equivalent, in seconds
          (event.receiver as { playoutDelayHint?: number }).playoutDelayHint =
            0.5;
        }

        event.streams[0].getTracks().forEach((track) => {
          remoteStream.addTrack(track);
        });
      };

      refs.audio.autoplay = true;
      refs.audio.srcObject = remoteStream;

      setAudioEnabled(true);
    } catch (e) {
      console.error(e);
      setError((e as Error).message);
      setPermissionDenied(true);
    }
  };

  if (permissionDenied) {
    return (
      <PermissionDenied>
        Permission denied. Please enable audio in your browser settings.
        {error}
      </PermissionDenied>
    );
  }

  return <Button onClick={handleEnableAudio}>Enable Audio</Button>;
}

const PermissionDenied = styled('p')`
  color: ${colors.accent2};
`;
