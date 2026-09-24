import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStatsLine } from "./webrtc_stats.js";

describe("formatStatsLine", () => {
  it("formats audio sample", () => {
    const line = formatStatsLine({
      audio: { jbAvgSec: 0.12, jitter: 0.004, lost: 1, recv: 200 },
      rttSec: 0.02
    });
    assert.match(line, /audio jbAvg=0\.120s/);
    assert.match(line, /rtt=20\.0ms/);
  });

  it("formats outbound video quality limitation", () => {
    const line = formatStatsLine({
      video: { jbAvgSec: 0.04, jitter: 0.01, lost: 0, recv: 100 },
      outVideo: { qualityLimitationReason: "bandwidth", avgSendDelaySec: 0.5 }
    });
    assert.match(line, /video jbAvg=0\.040s/);
    assert.match(line, /outVideo ql=bandwidth/);
    assert.match(line, /sendDelay=500ms/);
  });

  it("handles empty sample", () => {
    assert.equal(formatStatsLine({}), "no inbound rtp");
  });
});
