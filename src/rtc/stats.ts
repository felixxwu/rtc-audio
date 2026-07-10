import { refs } from './refs.ts';
import { AUDIO_CHANNEL_LABEL } from '../codec/audioProtocol.ts';
import type { Stats } from '../components/SettingsPopup.tsx';

// The subset of RTCStatsReport RTP fields this module reads. The report's
// entries come through untyped; bytes are always present on the entries we
// keep, the loss/jitter fields only on inbound audio.
interface RtpEntry {
  timestamp: number;
  bytesReceived: number;
  bytesSent: number;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
}

// Sample WebRTC stats across all peers and roll them into the aggregate the UI
// shows, also writing each peer's live audio rates back onto peer.stats for the
// participant tiles. Deltas are computed per-pc from each report's own
// timestamp — setInterval drifts and background tabs are throttled, so an
// assumed 1s interval spikes. Bitrate is summed across peers; loss and jitter
// report the worst pair.
export async function sampleStats(): Promise<Stats> {
  const peers = [...refs.peers.values()];

  let totalKbps = 0;
  const outgoing: number[] = [];
  let videoInKbps = 0;
  let videoOutKbps = 0;
  let dataInKbps = 0;
  let dataOutKbps = 0;
  let worstLossPercent = 0;
  let worstJitterMs = 0;
  await Promise.all(
    peers.map(async (peer) => {
      // inbound-rtp/outbound-rtp audio count codec payload only and are
      // supported in all browsers (unlike the transport stats type, missing
      // in Firefox). Video (screen share) is the same stat with kind 'video'.
      // File transfer runs on the data channels, reported separately under
      // 'data-channel' — summed here so Total reflects everything on the wire
      // (payload level, excluding protocol overhead).
      const stats = await peer.pc.getStats(null);
      // Single pass over the report: pick out the first audio/video RTP entry
      // in each direction and, for data channels, sum bytes by purpose. The
      // 'audio' channel carries the lossless FLAC stream, so its bytes are
      // attributed to audio (below) rather than to data; cursors + files stay
      // in the data bucket.
      let inboundAudio: RtpEntry | undefined;
      let outboundAudio: RtpEntry | undefined;
      let inboundVideo: RtpEntry | undefined;
      let outboundVideo: RtpEntry | undefined;
      let firstValue: { timestamp: number } | undefined;
      let dataBytesReceived = 0;
      let dataBytesSent = 0;
      let audioDataReceived = 0;
      let audioDataSent = 0;
      for (const s of stats.values()) {
        firstValue ??= s;
        if (s.type === 'inbound-rtp' && s.kind === 'audio') inboundAudio ??= s;
        else if (s.type === 'outbound-rtp' && s.kind === 'audio')
          outboundAudio ??= s;
        else if (s.type === 'inbound-rtp' && s.kind === 'video')
          inboundVideo ??= s;
        else if (s.type === 'outbound-rtp' && s.kind === 'video')
          outboundVideo ??= s;
        else if (s.type === 'data-channel') {
          if (s.label === AUDIO_CHANNEL_LABEL) {
            audioDataReceived += s.bytesReceived ?? 0;
            audioDataSent += s.bytesSent ?? 0;
          } else {
            dataBytesReceived += s.bytesReceived ?? 0;
            dataBytesSent += s.bytesSent ?? 0;
          }
        }
      }
      // Skip only if there's no audio at all on any transport (RTP or the
      // FLAC data channel). On FLAC the RTP audio stats may be absent.
      const hasAudioChannel = audioDataReceived > 0 || audioDataSent > 0;
      if (!inboundAudio && !outboundAudio && !hasAudioChannel) return;

      const timestamp = (inboundAudio ?? outboundAudio ?? firstValue)?.timestamp;
      if (timestamp === undefined) return;
      const elapsedMs = timestamp - peer.stats.ts;
      if (peer.stats.ts > 0 && elapsedMs > 0) {
        // Byte delta → kbps over this report's actual elapsed window, floored
        // at 0 (counters only ever grow, but a codec swap can reset the
        // baseline to a larger value for one sample).
        const rate = (curr: number, prev: number) =>
          Math.max(0, Math.round(((curr - prev) * 8) / elapsedMs));
        // Per-peer audio downlink = Opus RTP in + FLAC data-channel in.
        let peerInKbps = 0;
        if (inboundAudio) {
          const {
            bytesReceived,
            packetsLost = 0,
            packetsReceived = 0,
            jitter = 0,
          } = inboundAudio;
          peerInKbps += rate(bytesReceived, peer.stats.bytes);
          const newLost = Math.max(0, packetsLost - peer.stats.lost);
          const newReceived = packetsReceived - peer.stats.received;
          const newTotal = newLost + newReceived;
          if (newTotal > 0) {
            worstLossPercent = Math.max(
              worstLossPercent,
              Math.round((newLost / newTotal) * 100)
            );
          }
          worstJitterMs = Math.max(worstJitterMs, Math.round(jitter * 1000));
        }
        // FLAC audio arrives on the 'audio' data channel — count it as
        // audio-in alongside any Opus RTP audio.
        peerInKbps += rate(audioDataReceived, peer.stats.audioDataBytes);
        totalKbps += peerInKbps;
        // Per-peer audio uplink = Opus RTP out + FLAC data-channel out (only
        // one is non-zero, depending on the active codec).
        const rtpOutKbps = outboundAudio
          ? rate(outboundAudio.bytesSent, peer.stats.bytesSent)
          : 0;
        const flacOutKbps = rate(audioDataSent, peer.stats.audioDataBytesSent);
        const peerOutKbps = rtpOutKbps + flacOutKbps;
        outgoing.push(peerOutKbps);
        // Expose per-peer audio rates for the participant tiles.
        peer.stats.inKbps = peerInKbps;
        peer.stats.outKbps = peerOutKbps;
        if (inboundVideo) {
          videoInKbps += rate(inboundVideo.bytesReceived, peer.stats.videoBytes);
        }
        if (outboundVideo) {
          videoOutKbps += rate(
            outboundVideo.bytesSent,
            peer.stats.videoBytesSent
          );
        }
        dataInKbps += rate(dataBytesReceived, peer.stats.dataBytes);
        dataOutKbps += rate(dataBytesSent, peer.stats.dataBytesSent);
      }
      peer.stats.ts = timestamp;
      if (inboundAudio) {
        peer.stats.bytes = inboundAudio.bytesReceived;
        peer.stats.lost = inboundAudio.packetsLost ?? 0;
        peer.stats.received = inboundAudio.packetsReceived ?? 0;
      }
      if (outboundAudio) {
        peer.stats.bytesSent = outboundAudio.bytesSent;
      }
      if (inboundVideo) peer.stats.videoBytes = inboundVideo.bytesReceived;
      if (outboundVideo) {
        peer.stats.videoBytesSent = outboundVideo.bytesSent;
      }
      peer.stats.dataBytes = dataBytesReceived;
      peer.stats.dataBytesSent = dataBytesSent;
      peer.stats.audioDataBytes = audioDataReceived;
      peer.stats.audioDataBytesSent = audioDataSent;
    })
  );

  return {
    bitrateKbps: totalKbps,
    outgoingKbps: outgoing,
    totalInKbps: totalKbps + videoInKbps + dataInKbps,
    totalOutKbps:
      outgoing.reduce((sum, kbps) => sum + kbps, 0) + videoOutKbps + dataOutKbps,
    packetLossPercent: worstLossPercent,
    jitterMs: worstJitterMs,
  };
}
