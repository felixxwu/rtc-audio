const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 20,
};

export const pc = new RTCPeerConnection(servers);

// Ask the remote peer to send stereo Opus at the highest bitrate the spec
// allows (510 kbps — browsers clamp anything above it). Must be applied to
// both the offer and the answer so both directions get high quality.
//
// Rather than assuming a particular fmtp string exists (browsers differ),
// find every Opus payload type via its rtpmap line, then upsert the desired
// parameters into that payload's fmtp line — creating the line if absent.
export function enhanceAudioSdp(sdp: string): string {
  const params: Record<string, string> = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: '510000',
    maxplaybackrate: '48000',
    useinbandfec: '1',
    // Constant bitrate: hold max quality through quiet passages instead of
    // letting VBR dip. Costs bandwidth during silence.
    cbr: '1',
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
