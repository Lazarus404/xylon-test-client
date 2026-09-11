import { AdminClient } from "xylon-client-sdk";

export const DEFAULT_ADMIN_URL = "http://127.0.0.1:8092";

/**
 * Lab factory for customer admin HTTP. Optional authHeader demonstrates
 * prepareRequest for real SaaS apps (session Bearer, etc.).
 * @param {string} baseUrl
 * @param {{ authHeader?: string, fetch?: typeof fetch }} [opts]
 */
export function createAdminClient(baseUrl, { authHeader, fetch: fetchImpl } = {}) {
  const url = String(baseUrl || DEFAULT_ADMIN_URL).replace(/\/$/, "");
  if (!url) throw new Error("admin URL required");
  return new AdminClient({
    baseUrl: url,
    prepareRequest: authHeader
      ? ({ headers }) => {
          headers.set("authorization", authHeader);
        }
      : undefined,
    fetch: fetchImpl
  });
}

/**
 * Mint a Control WS token via demo admin POST /v1/token.
 * @param {AdminClient} admin
 * @param {{ sessionId: string, participantId: string, capabilities?: unknown, ttlSec?: number }} opts
 * @returns {Promise<string>}
 */
export async function mintToken(admin, opts) {
  const sessionId = String(opts.sessionId || "").trim();
  const participantId = String(opts.participantId || "").trim();
  if (!sessionId) throw new Error("session_id required");
  if (!participantId) throw new Error("participant_id required");

  const body = {
    session_id: sessionId,
    participant_id: participantId,
    capabilities: opts.capabilities ?? []
  };
  if (opts.ttlSec != null) body.ttl_sec = opts.ttlSec;

  const { token } = await admin.mintToken(body);
  return token;
}
