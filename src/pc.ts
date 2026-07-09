export const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 20,
};

// Upload cost in a mesh is one stream per other peer, so scale the ask down
// as the room grows. Room size is taken at offer time; existing pairs keep
// their old rate until they reconnect (renegotiation on growth is a fast
// follow, not v1).
const bitrateForRoomSize = (size: number) =>
  size <= 2 ? 510000 : size <= 4 ? 256000 : 128000;

// Ask the remote peer to send stereo Opus at the highest bitrate the room
// size allows (510 kbps is the spec ceiling — browsers clamp anything above
// it). Must be applied to both the offer and the answer so both directions
// get high quality.
//
// Rather than assuming a particular fmtp string exists (browsers differ),
// find every Opus payload type via its rtpmap line, then upsert the desired
// parameters into that payload's fmtp line — creating the line if absent.
export function enhanceAudioSdp(sdp: string, roomSize = 2): string {
  const params: Record<string, string> = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: String(bitrateForRoomSize(roomSize)),
    maxplaybackrate: '48000',
    useinbandfec: '1',
    // VBR (cbr=0): more efficient quality-per-bit than CBR and it drops the
    // uplink during quiet/silent passages instead of padding to the cap. At
    // the 510 kbps ceiling Opus is already transparent, so this costs no
    // audible quality; the truly-lossless option is the FLAC codec.
    cbr: '0',
    // 20ms frames: better coding efficiency and half the packet overhead of
    // the 10ms default, for ~10ms extra latency.
    minptime: '20',
  };

  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(newline);

  const opusPayloadTypes = new Set<string>();
  for (const line of lines) {
    const match = /^a=rtpmap:(\d+) opus\//i.exec(line);
    if (match) opusPayloadTypes.add(match[1]);
  }

  for (const pt of opusPayloadTypes) {
    const fmtpPrefix = `a=fmtp:${pt} `;
    const fmtpIndex = lines.findIndex((line) => line.startsWith(fmtpPrefix));

    if (fmtpIndex === -1) {
      // No fmtp line for this payload type — insert one after its rtpmap.
      const rtpmapIndex = lines.findIndex((line) =>
        line.toLowerCase().startsWith(`a=rtpmap:${pt} opus/`)
      );
      const fmtpValue = Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join(';');
      lines.splice(rtpmapIndex + 1, 0, `${fmtpPrefix}${fmtpValue}`);
      continue;
    }

    // Merge with existing parameters, overriding any we care about.
    const existing: Record<string, string> = {};
    for (const pair of lines[fmtpIndex].slice(fmtpPrefix.length).split(';')) {
      const [key, value] = pair.split('=');
      if (key?.trim()) existing[key.trim()] = value?.trim() ?? '';
    }
    Object.assign(existing, params);
    const fmtpValue = Object.entries(existing)
      .map(([key, value]) => (value === '' ? key : `${key}=${value}`))
      .join(';');
    lines[fmtpIndex] = `${fmtpPrefix}${fmtpValue}`;
  }

  return lines.join(newline);
}
