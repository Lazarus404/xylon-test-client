import { formatLogLine, roomHeaders } from "./dc_room.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("formatLogLine", () => {
  it("includes kind and text", () => {
    const line = formatLogLine("sent", "hello");
    assert.match(line, /sent: hello$/);
    assert.match(line, /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
  });
});

describe("roomHeaders", () => {
  it("sets x-tenant-id without bearer when token omitted", () => {
    assert.deepEqual(roomHeaders("acme"), { "x-tenant-id": "acme" });
  });

  it("adds Authorization Bearer when token present", () => {
    assert.deepEqual(roomHeaders("acme", " tok "), {
      "x-tenant-id": "acme",
      authorization: "Bearer tok"
    });
  });
});

describe("waitIceConnected", () => {
  it("resolves when already connected", async () => {
    const { waitIceConnected } = await import("./dc_room.js");
    const pc = {
      iceConnectionState: "connected",
      addEventListener() {},
      removeEventListener() {}
    };
    await waitIceConnected(pc, 100);
  });

  it("rejects when already failed", async () => {
    const { waitIceConnected } = await import("./dc_room.js");
    const pc = {
      iceConnectionState: "failed",
      addEventListener() {},
      removeEventListener() {}
    };
    await assert.rejects(() => waitIceConnected(pc, 100), /ICE failed/);
  });
});
