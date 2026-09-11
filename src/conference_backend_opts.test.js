import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conferenceBackendOpts } from "./conference_backend_opts.js";

describe("conferenceBackendOpts", () => {
  it("returns mesh SFU opts", () => {
    assert.deepEqual(conferenceBackendOpts("sfu"), {
      subscribe_mode: "mesh"
    });
  });

  it("returns MCU recipe with mesh video", () => {
    assert.deepEqual(conferenceBackendOpts("mcu"), {
      audio: "mcu",
      video: "sfu",
      subscribe_mode: "mesh"
    });
  });

  it("returns hub cascade MCU recipe", () => {
    assert.deepEqual(conferenceBackendOpts("mcu", "hub"), {
      audio: "mcu",
      video: "sfu",
      subscribe_mode: "mesh",
      mcu_cascade: "hub"
    });
  });

  it("returns spoke cascade SFU when audioMode is sfu", () => {
    assert.deepEqual(conferenceBackendOpts("sfu", "spoke"), {
      audio: "sfu",
      video: "sfu",
      subscribe_mode: "mesh",
      mcu_cascade: "spoke"
    });
  });

  it("returns spoke MCU when audioMode is mcu", () => {
    assert.deepEqual(conferenceBackendOpts("mcu", "spoke"), {
      audio: "mcu",
      video: "sfu",
      subscribe_mode: "mesh",
      mcu_cascade: "spoke"
    });
  });

  it("returns hub with PCM trunk and spoke mix-minus", () => {
    assert.deepEqual(
      conferenceBackendOpts("mcu", "hub", {
        trunkProfile: "pcm",
        spokeMixMinus: true
      }),
      {
        audio: "mcu",
        video: "sfu",
        subscribe_mode: "mesh",
        mcu_cascade: "hub",
        mcu_cascade_trunk_profile: "pcm",
        mcu_spoke_mix_minus: true
      }
    );
  });

  it("returns spoke MCU with PCM trunk", () => {
    assert.deepEqual(
      conferenceBackendOpts("mcu", "spoke", { trunkProfile: "pcm" }),
      {
        audio: "mcu",
        video: "sfu",
        subscribe_mode: "mesh",
        mcu_cascade: "spoke",
        mcu_cascade_trunk_profile: "pcm"
      }
    );
  });

  it("ignores spoke mix-minus on spoke edge", () => {
    assert.deepEqual(
      conferenceBackendOpts("sfu", "spoke", { spokeMixMinus: true }),
      {
        audio: "sfu",
        video: "sfu",
        subscribe_mode: "mesh",
        mcu_cascade: "spoke"
      }
    );
  });
});
