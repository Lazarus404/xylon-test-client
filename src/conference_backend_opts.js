/**
 * HTTP Lab conference `backend_opts` for session create.
 *
 * Defaults stay Opus hub-mix + SFU spoke (cascade). Opt-in cascade flags:
 * `trunkProfile`, `spokeMixMinus`, and spoke MCU (`audioMode: "mcu"` + spoke).
 *
 * @param {"sfu" | "mcu"} audioMode
 * @param {"" | "hub" | "spoke"} [mcuCascade]
 * @param {{
 *   trunkProfile?: "opus" | "pcm",
 *   spokeMixMinus?: boolean
 * }} [extra]
 * @returns {Record<string, string | boolean>}
 */
export function conferenceBackendOpts(audioMode, mcuCascade = "", extra = {}) {
  const trunkProfile = extra.trunkProfile || "opus";
  const spokeMixMinus = extra.spokeMixMinus === true;

  if (mcuCascade === "spoke") {
    const opts = {
      audio: audioMode === "mcu" ? "mcu" : "sfu",
      video: "sfu",
      subscribe_mode: "mesh",
      mcu_cascade: "spoke"
    };
    if (trunkProfile === "pcm") opts.mcu_cascade_trunk_profile = "pcm";
    return opts;
  }

  if (audioMode === "mcu" || mcuCascade === "hub") {
    const opts = {
      audio: "mcu",
      video: "sfu",
      subscribe_mode: "mesh",
      // Include all decoded contributors (fake Chrome mic / oscillator often
      // looks "quiet" under the default 25 gate).
      audio_level_average: 127
    };
    if (mcuCascade === "hub") {
      opts.mcu_cascade = "hub";
      if (trunkProfile === "pcm") opts.mcu_cascade_trunk_profile = "pcm";
      if (spokeMixMinus) opts.mcu_spoke_mix_minus = true;
    }
    return opts;
  }

  return { subscribe_mode: "mesh" };
}
