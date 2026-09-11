import { useRef, useState } from "strike-fw/hooks";
import { Btn, Field, Select, Stack, Text } from "strike-fw/ui";
import { Card } from "strike-fw-ui/surfaces/card.js";
import { XylonRoom, waitDataChannelOpen } from "xylon-client-sdk";
import {
  createAdminClient,
  DEFAULT_ADMIN_URL,
  mintToken
} from "../admin_client.js";
import { formatLogLine } from "../dc_room.js";

/**
 * Control WS room via xylon-client-sdk (mint / paste / lab).
 * @param {{ defaultWsUrl: string, onStatus: (msg: string, tone?: string) => void }} props
 */
export function ControlRoomPanel({ defaultWsUrl, onStatus }) {
  const [wsUrl, setWsUrl] = useState(defaultWsUrl);
  const [authMode, setAuthMode] = useState("mint");
  const [adminUrl, setAdminUrl] = useState(DEFAULT_ADMIN_URL);
  const [token, setToken] = useState("");
  const [tenantId, setTenantId] = useState("acme");
  const [sessionId, setSessionId] = useState("room-1");
  const [participantId, setParticipantId] = useState("a");
  const [library, setLibrary] = useState("datachannel");
  const [label, setLabel] = useState("chat");
  const [mode, setMode] = useState("fanout_except_sender");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dcReady, setDcReady] = useState(false);

  const roomRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);

  function appendLog(kind, text) {
    setLog((prev) => prev + formatLogLine(kind, text) + "\n");
  }

  function onAuthModeChange(next) {
    setAuthMode(next);
    if (next === "lab") {
      setTenantId((t) => (t === "acme" ? "lab" : t));
    } else if (next === "mint") {
      setTenantId((t) => (t === "lab" ? "acme" : t));
    }
  }

  function clearE2eHook() {
    try {
      if (typeof window !== "undefined" && window.__xylonRoom === roomRef.current) {
        window.__xylonRoom = null;
      }
    } catch (_) {}
  }

  function exposeE2eHook(room) {
    try {
      if (typeof window !== "undefined") {
        window.__xylonRoom = room;
      }
    } catch (_) {}
  }

  function wireConferenceSignals(room) {
    room.__e2eFeedsDiffs = [];
    room.__e2eLastFeedsSnapshot = null;
    room.onFeedsSnapshot = (frame) => {
      room.__e2eLastFeedsSnapshot = frame;
      const pubs = (frame && frame.publishers) || [];
      appendLog("info", `feeds.snapshot n=${pubs.length} ${JSON.stringify(pubs)}`);
    };
    room.onFeedsDiff = (frame) => {
      room.__e2eFeedsDiffs.push(frame);
      appendLog(
        "info",
        `feeds.diff ${frame.action} ${frame.participant_id} ${JSON.stringify(frame.streams || frame.kinds || [])}`
      );
    };
    room.onPresenceSnapshot = (frame) => {
      const ids = Object.keys((frame && frame.participants) || {});
      appendLog("info", `presence.snapshot n=${ids.length}`);
    };
    room.onPresenceDiff = (frame) => {
      appendLog("info", `presence.diff ${frame.action} ${frame.participant_id}`);
    };
  }

  async function onConnect() {
    setBusy(true);
    setDcReady(false);
    try {
      if (!participantId.trim()) throw new Error("participant id required");
      if (!sessionId.trim()) throw new Error("session id required");

      const lbl = label.trim() || "chat";
      const room = new XylonRoom();
      roomRef.current = room;
      room.onconnectionstatechange = (s) => onStatus(`PC ${s}`, "info");
      room.onerror = (err) => onStatus(String(err.message || err), "danger");

      onStatus("Control WS joining...", "info");

      const lib = library.trim() || "datachannel";
      const conference = lib === "conference";
      const backendOpts =
        lib === "datachannel"
          ? { mode, default_label: lbl }
          : conference
            ? { subscribe_mode: "manual" }
            : undefined;

      /** @type {import("xylon-client-sdk").ConnectOptions} */
      const connectOpts = {
        wsUrl: wsUrl.trim(),
        library: lib,
        participantId: participantId.trim(),
        dataChannelLabels: lib === "datachannel" ? [lbl] : [],
        ...(backendOpts ? { backendOpts } : {})
      };

      if (authMode === "mint") {
        const tid = tenantId.trim() || "acme";
        connectOpts.tenantId = tid;
        connectOpts.sessionId = sessionId.trim();
        const admin = createAdminClient(adminUrl.trim() || DEFAULT_ADMIN_URL);
        connectOpts.getToken = () =>
          mintToken(admin, {
            sessionId: sessionId.trim(),
            participantId: participantId.trim()
          });
      } else if (authMode === "paste") {
        const tok = token.trim();
        if (!tok) throw new Error("token required for paste mode");
        connectOpts.token = tok;
        if (tenantId.trim()) connectOpts.tenantId = tenantId.trim();
        if (sessionId.trim()) connectOpts.sessionId = sessionId.trim();
      } else {
        connectOpts.tenantId = tenantId.trim() || "lab";
        connectOpts.sessionId = sessionId.trim();
      }

      if (conference) {
        wireConferenceSignals(room);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        localStreamRef.current = stream;
        connectOpts.mediaStream = stream;
      }

      await room.connect(connectOpts);
      exposeE2eHook(room);

      if (conference) {
        setConnected(true);
        appendLog(
          "info",
          `joined ${sessionId.trim()} as ${participantId.trim()} (${authMode}) conference`
        );
        onStatus("Control WS conference connected", "ok");
        return;
      }

      const channel = room.dataChannel(lbl) || room.createDataChannel(lbl);
      dcRef.current = channel;
      wireDc(channel, lbl);
      await waitDataChannelOpen(channel);
      setDcReady(true);
      appendLog("info", `dc open label=${lbl}`);

      setConnected(true);
      appendLog("info", `joined ${sessionId.trim()} as ${participantId.trim()} (${authMode})`);
      onStatus("Control WS connected", "ok");
    } catch (err) {
      console.error("[xylon-client]", err);
      const msgText = String(err && err.message ? err.message : err);
      onStatus(msgText, "danger");
      appendLog("info", msgText);
      teardown();
    } finally {
      setBusy(false);
    }
  }

  function wireDc(channel, lbl) {
    channel.onopen = () => {
      setDcReady(true);
      appendLog("info", `dc open label=${lbl}`);
      onStatus("datachannel open", "ok");
    };
    channel.onmessage = (ev) => {
      appendLog("recv", String(ev.data));
      onStatus(`recv: ${ev.data}`, "ok");
    };
    channel.onclose = () => {
      setDcReady(false);
      appendLog("info", "dc closed");
    };
    if (channel.readyState === "open") {
      setDcReady(true);
    }
  }

  function teardown() {
    clearE2eHook();
    try {
      if (dcRef.current) dcRef.current.close();
    } catch (_) {}
    try {
      if (roomRef.current) roomRef.current.close();
    } catch (_) {}
    try {
      const stream = localStreamRef.current;
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
      }
    } catch (_) {}
    roomRef.current = null;
    dcRef.current = null;
    localStreamRef.current = null;
    setConnected(false);
    setDcReady(false);
  }

  function onDisconnect() {
    teardown();
    appendLog("info", "disconnected");
    onStatus("Control WS disconnected", "muted");
  }

  function onSend() {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      onStatus("room dc not open", "warn");
      return;
    }
    dc.send(msg);
    appendLog("sent", msg);
    setMsg("");
  }

  return (
    <Card
      outlined
      title="Control WebSocket"
      subtitle="xylon-client-sdk · AdminClient mint, paste token, or lab tenant/session."
    >
      <Stack gap={12}>
        <Text as="p" class="xylon-hint">
          Mint uses SDK AdminClient against demo admin (default :8092); platform
          interface is server-side. Use Lab with <code>--control lab</code>; Mint/Paste
          with <code>--control hmac</code>. Conference join sends{" "}
          <code>subscribe_mode: manual</code>; call subscribe on feeds yourself.
        </Text>
        <Field
          label="Control WS URL"
          value={wsUrl}
          onInput={(e) => setWsUrl(e.target.value)}
        />
        <Select
          label="Auth mode"
          value={authMode}
          onChange={(e) => onAuthModeChange(e.target.value)}
          options={[
            { value: "mint", label: "Mint (AdminClient -> demo admin)" },
            { value: "paste", label: "Paste token" },
            { value: "lab", label: "Lab (tenant/session, no crypto)" }
          ]}
        />
        {authMode === "mint" ? (
          <Field
            label="Admin URL"
            value={adminUrl}
            onInput={(e) => setAdminUrl(e.target.value)}
            placeholder={DEFAULT_ADMIN_URL}
          />
        ) : null}
        {authMode === "paste" ? (
          <Field
            label="Token"
            value={token}
            onInput={(e) => setToken(e.target.value)}
            placeholder="host-minted HMAC/JWT"
          />
        ) : null}
        <div class="xylon-panel-grid xylon-panel-grid--2">
          <Field
            label="Tenant"
            value={tenantId}
            onInput={(e) => setTenantId(e.target.value)}
          />
          <Field
            label="Session / room"
            value={sessionId}
            onInput={(e) => setSessionId(e.target.value)}
          />
          <Field
            label="Participant id"
            value={participantId}
            onInput={(e) => setParticipantId(e.target.value)}
          />
          <Field
            label="Library"
            value={library}
            onInput={(e) => setLibrary(e.target.value)}
          />
          <Field
            label="DC label"
            value={label}
            onInput={(e) => setLabel(e.target.value)}
          />
          <Select
            label="Mode (on join create)"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: "fanout_except_sender", label: "fanout_except_sender" },
              { value: "fanout_all", label: "fanout_all" }
            ]}
          />
        </div>
        <Stack row gap={8}>
          <Btn
            variant="primary"
            type="button"
            state={busy ? "busy" : "rest"}
            disabled={busy || connected}
            onClick={onConnect}
          >
            Connect
          </Btn>
          <Btn type="button" disabled={!connected} onClick={onDisconnect}>
            Disconnect
          </Btn>
        </Stack>
        <Stack row gap={8}>
          <Field
            label="Message"
            value={msg}
            onInput={(e) => setMsg(e.target.value)}
            disabled={!dcReady}
          />
          <Btn type="button" disabled={!dcReady} onClick={onSend}>
            Send
          </Btn>
        </Stack>
        <pre class="xylon-log">{log || " "}</pre>
      </Stack>
    </Card>
  );
}
