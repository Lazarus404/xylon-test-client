import { formatLogLine } from "./dc_room.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("formatLogLine", () => {
  it("includes kind and text", () => {
    const line = formatLogLine("sent", "hello");
    assert.match(line, /sent: hello$/);
    assert.match(line, /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
  });
});
