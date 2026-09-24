/**
 * Sample inbound WebRTC stats to separate Chrome playout lag from server delay.
 *
 * Rising `jbAvgSec` with flat packet loss usually means the jitter buffer is
 * absorbing late/irregular packets (network or server pacing). Flat jbAvg with
 * rising RTT points elsewhere. Outbound `qualityLimitationReason` of
 * `bandwidth` with climbing video jb often means SFU TWCC/REMB is throttling
 * the publisher.
 */

/**
 * @param {RTCPeerConnection} pc
 * @returns {Promise<{
 *   audio?: { jbAvgSec: number, jitter: number, lost: number, recv: number },
 *   video?: { jbAvgSec: number, jitter: number, lost: number, recv: number },
 *   outVideo?: { qualityLimitationReason: string, avgSendDelaySec: number },
 *   rttSec?: number
 * }>}
 */
export async function sampleInboundStats(pc) {
  if (!pc || typeof pc.getStats !== "function") return {};
  const report = await pc.getStats();
  /** @type {Record<string, unknown>} */
  const out = {};

  for (const r of report.values()) {
    if (r.type === "inbound-rtp" && (r.kind === "audio" || r.kind === "video")) {
      const emitted = Number(r.jitterBufferEmittedCount) || 0;
      const delay = Number(r.jitterBufferDelay) || 0;
      out[r.kind] = {
        jbAvgSec: emitted > 0 ? delay / emitted : 0,
        jitter: Number(r.jitter) || 0,
        lost: Number(r.packetsLost) || 0,
        recv: Number(r.packetsReceived) || 0
      };
    }
    if (r.type === "outbound-rtp" && r.kind === "video") {
      const sent = Number(r.packetsSent) || 0;
      const totalDelay = Number(r.totalPacketSendDelay) || 0;
      out.outVideo = {
        qualityLimitationReason: String(r.qualityLimitationReason || "none"),
        avgSendDelaySec: sent > 0 ? totalDelay / sent : 0
      };
    }
    if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded") {
      if (typeof r.currentRoundTripTime === "number") {
        out.rttSec = r.currentRoundTripTime;
      }
    }
  }
  return out;
}

/**
 * @param {unknown} sample
 * @returns {string}
 */
export function formatStatsLine(sample) {
  const s = sample && typeof sample === "object" ? sample : {};
  const parts = [];
  if (s.audio) {
    parts.push(
      `audio jbAvg=${Number(s.audio.jbAvgSec).toFixed(3)}s jitter=${Number(s.audio.jitter).toFixed(3)} lost=${s.audio.lost} recv=${s.audio.recv}`
    );
  }
  if (s.video) {
    parts.push(
      `video jbAvg=${Number(s.video.jbAvgSec).toFixed(3)}s jitter=${Number(s.video.jitter).toFixed(3)} lost=${s.video.lost} recv=${s.video.recv}`
    );
  }
  if (s.outVideo) {
    const ql = s.outVideo.qualityLimitationReason || "none";
    const delayMs = (Number(s.outVideo.avgSendDelaySec) || 0) * 1000;
    parts.push(`outVideo ql=${ql} sendDelay=${delayMs.toFixed(0)}ms`);
  }
  if (typeof s.rttSec === "number") {
    parts.push(`rtt=${(s.rttSec * 1000).toFixed(1)}ms`);
  }
  return parts.join(" | ") || "no inbound rtp";
}
