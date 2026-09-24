/**
 * HTTP JSEP helpers for the Xylon datachannel room lab.
 */

/**
 * @param {string} tenantId
 * @param {string} [token]
 * @returns {Record<string, string>}
 */
export function roomHeaders(tenantId, token) {
  /** @type {Record<string, string>} */
  const headers = { "x-tenant-id": tenantId };
  const tok = String(token || "").trim();
  if (tok) headers.authorization = `Bearer ${tok}`;
  return headers;
}

/**
 * @param {{
 *   baseUrl: string,
 *   tenantId: string,
 *   sessionId: string,
 *   library: string,
 *   backendOpts?: Record<string, string | boolean>,
 *   token?: string
 * }} opts
 * @returns {Promise<{created: boolean}>}
 */
export async function ensureSession(opts) {
  const { baseUrl, tenantId, sessionId, library, backendOpts, token } = opts;
  const body = { session_id: sessionId, library };
  if (backendOpts && Object.keys(backendOpts).length) {
    body.backend_opts = backendOpts;
  }

  const res = await fetch(`${trimSlash(baseUrl)}/v1/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...roomHeaders(tenantId, token)
    },
    body: JSON.stringify(body)
  });

  if (res.status === 201) return { created: true };
  if (res.status === 409) return { created: false };
  throw new Error(`create session ${res.status}: ${await res.text()}`);
}

/**
 * @param {{
 *   baseUrl: string,
 *   tenantId: string,
 *   sessionId: string,
 *   participantId: string,
 *   offerSdp: string,
 *   token?: string
 * }} opts
 * @returns {Promise<string>}
 */
export async function postOffer(opts) {
  const { baseUrl, tenantId, sessionId, participantId, offerSdp, token } = opts;
  const url =
    `${trimSlash(baseUrl)}/v1/sessions/${encodeURIComponent(sessionId)}/offer` +
    `?participant_id=${encodeURIComponent(participantId)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/sdp",
      ...roomHeaders(tenantId, token)
    },
    body: offerSdp
  });

  if (!res.ok) throw new Error(`offer ${res.status}: ${await res.text()}`);
  return res.text();
}

/**
 * @param {{
 *   baseUrl: string,
 *   tenantId: string,
 *   sessionId: string,
 *   participantId: string,
 *   token?: string
 * }} opts
 * @returns {Promise<void>}
 */
export async function leaveParticipant(opts) {
  const { baseUrl, tenantId, sessionId, participantId, token } = opts;
  const url =
    `${trimSlash(baseUrl)}/v1/sessions/${encodeURIComponent(sessionId)}` +
    `/participants/${encodeURIComponent(participantId)}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: roomHeaders(tenantId, token)
  });

  if (res.status === 204 || res.status === 404) return;
  throw new Error(`leave ${res.status}: ${await res.text()}`);
}

/**
 * @param {RTCPeerConnection} pc
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitIceComplete(pc, timeoutMs = 5000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Wait until ICE is connected/completed, or reject on failed/disconnected/closed.
 * @param {RTCPeerConnection} pc
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitIceConnected(pc, timeoutMs = 20000) {
  const ok = new Set(["connected", "completed"]);
  const bad = new Set(["failed", "closed"]);
  if (ok.has(pc.iceConnectionState)) return Promise.resolve();
  if (bad.has(pc.iceConnectionState)) {
    return Promise.reject(new Error(`ICE ${pc.iceConnectionState}`));
  }
  return new Promise((resolve, reject) => {
    const finish = (err) => {
      pc.removeEventListener("iceconnectionstatechange", onChange);
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const onChange = () => {
      const s = pc.iceConnectionState;
      if (ok.has(s)) finish();
      else if (bad.has(s)) finish(new Error(`ICE ${s}`));
    };
    const timer = setTimeout(
      () => finish(new Error(`ICE timeout (${pc.iceConnectionState})`)),
      timeoutMs
    );
    pc.addEventListener("iceconnectionstatechange", onChange);
  });
}

/**
 * @param {"sent"|"recv"|"info"} kind
 * @param {string} text
 * @returns {string}
 */
export function formatLogLine(kind, text) {
  const ts = new Date().toISOString().slice(11, 23);
  return `[${ts}] ${kind}: ${text}`;
}

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}
