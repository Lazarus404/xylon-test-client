import { useCallback, useRef, useState } from "strike-fw/hooks";
import { Text } from "strike-fw/ui";
import { AppBar } from "strike-fw-ui/surfaces/app-bar.js";
import { Tabs } from "strike-fw-ui/navigation/tabs.js";
import { Alert } from "strike-fw-ui/feedback/alert.js";
import { Container } from "strike-fw-ui/layout/container.js";
import { AdminPanel } from "./panels/AdminPanel.jsx";
import { SipPanel } from "./panels/SipPanel.jsx";
import { ControlRoomPanel } from "./panels/ControlRoomPanel.jsx";
import { HttpRoomPanel } from "./panels/HttpRoomPanel.jsx";

function defaultSipWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/sip`;
}

function defaultControlWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/v1/ws`;
}

const TAB_ITEMS = [
  { id: "control", label: "Control WS" },
  { id: "admin", label: "Admin" },
  { id: "http", label: "HTTP Lab" },
  { id: "sip", label: "SIP Echo" }
];

export function App() {
  const [tab, setTab] = useState("control");
  const [status, setStatus] = useState("Idle");
  const [statusTone, setStatusTone] = useState("muted");
  const sipWs = useRef(defaultSipWs());
  const controlWs = useRef(defaultControlWs());

  const onStatus = useCallback((text, tone = "info") => {
    setStatus(text);
    setStatusTone(tone);
    console.info("[xylon-client]", text);
  }, []);

  return (
    <div class="xylon-shell">
      <AppBar
        elevated
        position="sticky"
        start={<span class="xylon-brand-mark" aria-hidden="true" />}
      >
        <div>
          <p class="xylon-brand">Xylon</p>
          <p class="xylon-tagline">Lab client · Control WS SDK · SIP · HTTP</p>
        </div>
      </AppBar>

      <Container class="xylon-main" size="lg">
        <Text as="p" class="xylon-hint">
          Filter DevTools by <code>xylon-client</code>. Control WS needs{" "}
          <code>control: [enabled: true]</code> on the server.
        </Text>

        <Tabs
          value={tab}
          onChange={setTab}
          items={TAB_ITEMS.map((it) => ({
            id: it.id,
            label: it.label,
            panel: null
          }))}
        />

        {/* Keep all panels mounted so status updates do not wipe form state. */}
        <div class="xylon-tab-body">
          <div hidden={tab !== "control"}>
            <ControlRoomPanel defaultWsUrl={controlWs.current} onStatus={onStatus} />
          </div>
          <div hidden={tab !== "admin"}>
            <AdminPanel onStatus={onStatus} />
          </div>
          <div hidden={tab !== "http"}>
            <HttpRoomPanel onStatus={onStatus} />
          </div>
          <div hidden={tab !== "sip"}>
            <SipPanel defaultWsUrl={sipWs.current} onStatus={onStatus} />
          </div>
        </div>

        <Alert class="xylon-status" tone={statusTone} title="Status">
          {status}
        </Alert>
      </Container>
    </div>
  );
}
