import assert from "node:assert/strict";
import test from "node:test";
import { allMediaCombinations, resolveMediaPlan } from "./media_constraints.js";

test("rejects empty plan", () => {
  assert.throws(() => resolveMediaPlan({}), /at least one/i);
});

test("seven non-empty combinations", () => {
  assert.equal(allMediaCombinations().length, 7);
});

test("audio-only needs gum audio", () => {
  const plan = resolveMediaPlan({ audio: true });
  assert.equal(plan.needsGum, true);
  assert.equal(plan.getUserMedia.audio, true);
  assert.equal(plan.getUserMedia.video, false);
  assert.equal(plan.datachannel, false);
});

test("dc-only skips gum", () => {
  const plan = resolveMediaPlan({ datachannel: true });
  assert.equal(plan.needsGum, false);
  assert.equal(plan.datachannel, true);
});
