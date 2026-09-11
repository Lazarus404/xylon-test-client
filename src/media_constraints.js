/**
 * Build getUserMedia / transceiver / datachannel flags from UI toggles.
 * At least one of audio, video, or datachannel must be true.
 */
export function resolveMediaPlan(toggles) {
  const audio = !!toggles.audio;
  const video = !!toggles.video;
  const datachannel = !!toggles.datachannel;

  if (!audio && !video && !datachannel) {
    throw new Error("Select at least one of audio, video, or datachannel");
  }

  return {
    audio,
    video,
    datachannel,
    getUserMedia: {
      audio: audio ? true : false,
      video: video ? true : false
    },
    needsGum: audio || video
  };
}

/** All non-empty A/V/DC combinations for docs and smoke checks. */
export function allMediaCombinations() {
  const flags = [false, true];
  const out = [];
  for (const audio of flags) {
    for (const video of flags) {
      for (const datachannel of flags) {
        if (audio || video || datachannel) {
          out.push({ audio, video, datachannel });
        }
      }
    }
  }
  return out;
}
