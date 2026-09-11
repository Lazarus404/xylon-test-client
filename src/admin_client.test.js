import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { AdminClient } from "xylon-client-sdk";
import { createAdminClient, mintToken } from "./admin_client.js";

test("mintToken posts session and participant", async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ token: "tok.abc" });
      }
    };
  };

  const admin = new AdminClient({
    baseUrl: "http://127.0.0.1:8092",
    fetch: fetchMock
  });

  const token = await mintToken(admin, {
    sessionId: "room-1",
    participantId: "alice"
  });
  assert.equal(token, "tok.abc");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8092/v1/token");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.session_id, "room-1");
  assert.equal(body.participant_id, "alice");
  assert.deepEqual(body.capabilities, []);
});

test("mintToken surfaces admin errors", async () => {
  const admin = new AdminClient({
    baseUrl: "http://127.0.0.1:8092",
    fetch: async () => ({
      ok: false,
      status: 500,
      async text() {
        return JSON.stringify({ error: "no_secret" });
      }
    })
  });

  await assert.rejects(
    () =>
      mintToken(admin, {
        sessionId: "r",
        participantId: "p"
      }),
    /Admin HTTP 500/
  );
});

test("mintToken requires fields", async () => {
  const admin = createAdminClient("http://127.0.0.1:8092");
  await assert.rejects(
    () => mintToken(admin, { sessionId: "", participantId: "p" }),
    /session_id/
  );
  await assert.rejects(
    () => mintToken(admin, { sessionId: "r", participantId: "" }),
    /participant_id/
  );
});

test("createAdminClient sets prepareRequest when authHeader given", async () => {
  let auth = "";
  const admin = createAdminClient("http://admin.example", {
    authHeader: "Bearer lab-session",
    fetch: async (_url, init) => {
      auth = new Headers(init.headers).get("authorization");
      return {
        ok: true,
        status: 200,
        async text() {
          return "{}";
        }
      };
    }
  });
  await admin.presence("room-1");
  assert.equal(auth, "Bearer lab-session");
});
