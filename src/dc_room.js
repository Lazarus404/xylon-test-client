/**
 * HTTP JSEP helpers for the Xylon datachannel room lab.
 */

/**
 * @param {{
 *   baseUrl: string,
 *   tenantId: string,
 *   sessionId: string,
 *   library: string,
 *   backendOpts?: Record<string, string | boolean>
 * }} opts
 * @returns {Promise<{created: boolean}>}
 */
export async function ensureSession(opts) {
  const { baseUrl, tenantId, sessionId, library, backendOpts } = opts;
  const body = { session_id: sessionId, library };
  if (backendOpts && Object.keys(backendOpts).length) {
    body.backend_opts = backendOpts;
  }

  const res = await fetch(`${trimSlash(baseUrl)}/v1/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": tenantId
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
 *   offerSdp: string
 * }} opts
 * @returns {Promise<string>}
 */
export async function postOffer(opts) {
  const { baseUrl, tenantId, sessionId, participantId, offerSdp } = opts;
  const url =
    `${trimSlash(baseUrl)}/v1/sessions/${encodeURIComponent(sessionId)}/offer` +
    `?participant_id=${encodeURIComponent(participantId)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/sdp",
      "x-tenant-id": tenantId
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
 *   participantId: string
 * }} opts
 * @returns {Promise<void>}
 */
export async function leaveParticipant(opts) {
  const { baseUrl, tenantId, sessionId, participantId } = opts;
  const url =
    `${trimSlash(baseUrl)}/v1/sessions/${encodeURIComponent(sessionId)}` +
    `/participants/${encodeURIComponent(participantId)}`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { "x-tenant-id": tenantId }
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
