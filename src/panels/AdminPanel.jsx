import { useState } from "strike-fw/hooks";
import { Btn, Field, Stack, Text } from "strike-fw/ui";
import { Card } from "strike-fw-ui/surfaces/card.js";
import { createAdminClient, DEFAULT_ADMIN_URL } from "../admin_client.js";

const DEFAULT_INJECT = '{\n  "payload": "hello",\n  "dest": "all",\n  "label": "chat"\n}';
const DEFAULT_MODERATE = '{\n  "action": "kick",\n  "participant_id": "p2"\n}';

function formatResult(data) {
  if (data === null || data === undefined) return "(empty)";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/**
 * Control admin lab via SDK AdminClient -> demo admin -> platform interface.
 * @param {{ onStatus: (msg: string, tone?: string) => void }} props
 */
export function AdminPanel({ onStatus }) {
  const [adminUrl, setAdminUrl] = useState(DEFAULT_ADMIN_URL);
  const [sessionId, setSessionId] = useState("room-1");
  const [historyLabel, setHistoryLabel] = useState("chat");
  const [authHeader, setAuthHeader] = useState("");
  const [injectJson, setInjectJson] = useState(DEFAULT_INJECT);
  const [moderateJson, setModerateJson] = useState(DEFAULT_MODERATE);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  function appendLog(kind, text) {
    const line = `[${new Date().toISOString()}] ${kind}: ${text}`;
    setLog((prev) => (prev ? prev + "\n\n" + line : line));
  }

  function admin() {
    return createAdminClient(adminUrl.trim() || DEFAULT_ADMIN_URL, {
      authHeader: authHeader.trim() || undefined
    });
  }

  async function run(label, fn) {
    setBusy(true);
    try {
      const data = await fn();
      const out = formatResult(data);
      appendLog(label, out);
      onStatus(`${label} ok`, "ok");
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      appendLog(`${label} error`, msg);
      onStatus(msg, "danger");
    } finally {
      setBusy(false);
    }
  }

  function parseJson(text, name) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${name}: invalid JSON`);
    }
  }

  return (
    <Card
      outlined
      title="Control admin"
      subtitle="AdminClient -> demo admin (:8092) -> platform interface -> Xylon. Never Xylon REST from the browser."
    >
      <Stack gap={12}>
        <Text as="p" class="xylon-hint">
          Requires demo admin, secret store, and platform interface (e.g. workspace{" "}
          <code>start.sh</code>). Optional Authorization header demonstrates{" "}
          <code>prepareRequest</code> for real SaaS backends.
        </Text>
        <div class="xylon-panel-grid xylon-panel-grid--2">
          <Field
            label="Admin URL"
            value={adminUrl}
            onInput={(e) => setAdminUrl(e.target.value)}
            placeholder={DEFAULT_ADMIN_URL}
          />
          <Field
            label="Session / room"
            value={sessionId}
            onInput={(e) => setSessionId(e.target.value)}
          />
          <Field
            label="History label"
            value={historyLabel}
            onInput={(e) => setHistoryLabel(e.target.value)}
          />
          <Field
            label="Authorization header (optional)"
            value={authHeader}
            onInput={(e) => setAuthHeader(e.target.value)}
            placeholder="Bearer ..."
          />
        </div>
        <Stack row gap={8}>
          <Btn
            type="button"
            disabled={busy}
            onClick={() =>
              run("presence", () => admin().presence(sessionId.trim()))
            }
          >
            Presence
          </Btn>
          <Btn
            type="button"
            disabled={busy}
            onClick={() =>
              run("history", () =>
                admin().history(sessionId.trim(), historyLabel.trim() || "chat")
              )
            }
          >
            History
          </Btn>
        </Stack>
        <Field
          label="Inject JSON (POST /data)"
          as="textarea"
          rows={4}
          value={injectJson}
          onInput={(e) => setInjectJson(e.target.value)}
        />
        <Btn
          type="button"
          disabled={busy}
          onClick={() =>
            run("inject", () =>
              admin().inject(sessionId.trim(), parseJson(injectJson, "inject"))
            )
          }
        >
          Inject
        </Btn>
        <Field
          label="Moderate JSON (POST /moderate)"
          as="textarea"
          rows={4}
          value={moderateJson}
          onInput={(e) => setModerateJson(e.target.value)}
        />
        <Btn
          type="button"
          disabled={busy}
          onClick={() =>
            run("moderate", () =>
              admin().moderate(sessionId.trim(), parseJson(moderateJson, "moderate"))
            )
          }
        >
          Moderate
        </Btn>
        <pre class="xylon-log">{log || " "}</pre>
      </Stack>
    </Card>
  );
}
