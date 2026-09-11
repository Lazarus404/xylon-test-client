import { useRef, useState } from "strike-fw/hooks";
import { Btn, Check, Field, Select, Stack, Text } from "strike-fw/ui";
import { Card } from "strike-fw-ui/surfaces/card.js";
import {
  CHAT_LABEL,
  GAME_DATA_CHANNEL_LABELS,
  RPC_LABEL,
  STATE_LABEL,
  StatePublisher,
  StateReceiver,
  createRpcClient
} from "xylon-client-sdk";
import { conferenceBackendOpts } from "../conference_backend_opts.js";
import {
  ensureSession,
  formatLogLine,
  leaveParticipant,
  postOffer,
  waitIceComplete
} from "../dc_room.js";
import { resolveMediaPlan } from "../media_constraints.js";

/**
 * HTTP JSEP lab: datachannel chat + RPC, or conference/echo A/V (control off / x-tenant-id).
 * @param {{ onStatus: (msg: string, tone?: string) => void }} props
 */
export function HttpRoomPanel({ onStatus }) {
  const [baseUrl, setBaseUrl] = useState(
    `${location.protocol}//${location.host}`
  );
  const [tenantId, setTenantId] = useState("lab");
  const [sessionId, setSessionId] = useState("room-1");
  const [participantId, setParticipantId] = useState("a");
  const [library, setLibrary] = useState("datachannel");
  const [label, setLabel] = useState("chat");
  const [mode, setMode] = useState("mfu");
  const [rpcPeer, setRpcPeer] = useState("b");
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(false);
  const [audioMode, setAudioMode] = useState("sfu");
  const [mcuCascade, setMcuCascade] = useState("");
  const [trunkProfile, setTrunkProfile] = useState("opus");
  const [spokeMixMinus, setSpokeMixMinus] = useState(false);
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dcReady, setDcReady] = useState(false);
  const [stateAccepted, setStateAccepted] = useState(0);
  const [stateDropped, setStateDropped] = useState(0);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const channelsRef = useRef(/** @type {Record<string, RTCDataChannel>} */ ({}));
  const rpcRef = useRef(null);
  const statePubRef = useRef(null);
  const stateRecRef = useRef(null);
  const stateTimerRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const isDc = library === "datachannel";
  const isAv = library === "conference" || library === "echo";
  const isGameMfu = isDc && mode === "mfu";

  function appendLog(kind, text) {
    setLog((prev) => prev + formatLogLine(kind, text) + "\n");
  }

  function setRoomUi(isConnected, open) {
    setConnected(isConnected);
    setDcReady(!!open);
  }

  function attachRemoteTrack(ev) {
    const stream = ev.streams && ev.streams[0] ? ev.streams[0] : null;
    if (!stream) return;
    if (ev.track.kind === "audio" && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (ev.track.kind === "video" && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }

  /**
   * @param {string[]} labels
   */
  async function connectDatachannel(labels) {
    const roomPc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = roomPc;
    channelsRef.current = {};

    /** @type {RTCDataChannel[]} */
    const opened = [];
    for (const lbl of labels) {
      const roomDc = roomPc.createDataChannel(lbl);
      channelsRef.current[lbl] = roomDc;
      if (lbl === CHAT_LABEL || labels.length === 1) {
        dcRef.current = roomDc;
      }
      roomDc.onopen = () => {
        opened.push(roomDc);
        appendLog("info", `dc open label=${lbl}`);
        if (opened.length >= labels.length) {
          setRoomUi(true, true);
          onStatus("datachannel room connected", "ok");
          maybeStartRpc(participantId.trim());
          maybeStartState();
        }
      };
      roomDc.onmessage = (ev) => {
        if (lbl === RPC_LABEL) return;
        appendLog("recv", `[${lbl}] ${String(ev.data)}`);
        onStatus(`room recv: ${ev.data}`, "ok");
      };
      roomDc.onclose = () => appendLog("info", `dc closed label=${lbl}`);
    }

    const offer = await roomPc.createOffer();
    await roomPc.setLocalDescription(offer);
    await waitIceComplete(roomPc);

    onStatus("posting offer...", "info");
    const answerSdp = await postOffer({
      baseUrl: baseUrl.trim(),
      tenantId: tenantId.trim(),
      sessionId: sessionId.trim(),
      participantId: participantId.trim(),
      offerSdp: roomPc.localDescription.sdp
    });
    await roomPc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    appendLog("info", `offer ok as ${participantId}`);
    const chat = channelsRef.current[CHAT_LABEL] || dcRef.current;
    setRoomUi(true, chat && chat.readyState === "open");
  }

  function maybeStartRpc(localId) {
    try {
      if (rpcRef.current) {
        rpcRef.current.close();
        rpcRef.current = null;
      }
      if (!channelsRef.current[RPC_LABEL]) return;
      const rpc = createRpcClient({
        localParticipantId: localId,
        getChannel: (lbl) => channelsRef.current[lbl] || null
      });
      rpc.registerRpcMethod("ping", (payload) => ({
        pong: true,
        echo: payload,
        from: localId
      }));
      rpcRef.current = rpc;
      appendLog("info", "rpc client ready (ping)");
    } catch (err) {
      appendLog("info", `rpc setup: ${String(err && err.message ? err.message : err)}`);
    }
  }

  function stopState() {
    if (stateTimerRef.current) {
      clearInterval(stateTimerRef.current);
      stateTimerRef.current = null;
    }
    try {
      if (statePubRef.current) {
        statePubRef.current.close();
        statePubRef.current = null;
      }
    } catch (_) {}
    try {
      if (stateRecRef.current) {
        stateRecRef.current.close();
        stateRecRef.current = null;
      }
    } catch (_) {}
  }

  function maybeStartState() {
    try {
      stopState();
      const ch = channelsRef.current[STATE_LABEL];
      if (!ch) return;
      setStateAccepted(0);
      setStateDropped(0);
      const rec = new StateReceiver({
        channel: ch,
        onState: (topic, body, meta) => {
          setStateAccepted((n) => n + 1);
          appendLog(
            "state",
            `ok ${meta.senderId} ${topic} seq=${meta.seq} ${JSON.stringify(body)}`
          );
        }
      });
      const pub = new StatePublisher({ channel: ch, maxRateHz: 10 });
      stateRecRef.current = rec;
      statePubRef.current = pub;
      let tick = 0;
      stateTimerRef.current = setInterval(() => {
        tick += 1;
        const yaw = (tick * 12) % 360;
        pub.publish("transform", {
          x: Math.cos((tick / 10) * Math.PI),
          y: Math.sin((tick / 10) * Math.PI),
          yaw
        });
        setStateDropped(rec.dropped);
      }, 100);
      appendLog("info", "state publisher 10Hz transform + receiver");
    } catch (err) {
      appendLog(
        "info",
        `state setup: ${String(err && err.message ? err.message : err)}`
      );
    }
  }

  async function connectAv() {
    const plan = resolveMediaPlan({ audio, video, datachannel: false });
    const roomPc = new RTCPeerConnection({ iceServers: [] });
    pcRef.current = roomPc;
    roomPc.ontrack = attachRemoteTrack;

    const stream = await navigator.mediaDevices.getUserMedia(plan.getUserMedia);
    localStreamRef.current = stream;
    for (const track of stream.getTracks()) {
      roomPc.addTrack(track, stream);
    }
    if (localVideoRef.current && stream.getVideoTracks().length) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play().catch(() => {});
    }

    const offer = await roomPc.createOffer();
    await roomPc.setLocalDescription(offer);
    await waitIceComplete(roomPc);

    onStatus("posting offer...", "info");
    const answerSdp = await postOffer({
      baseUrl: baseUrl.trim(),
      tenantId: tenantId.trim(),
      sessionId: sessionId.trim(),
      participantId: participantId.trim(),
      offerSdp: roomPc.localDescription.sdp
    });
    await roomPc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    appendLog("info", `A/V offer ok as ${participantId} library=${library}`);
    setRoomUi(true, false);
    onStatus(`${library} room connected`, "ok");
  }

  async function onConnect() {
    setBusy(true);
    try {
      if (!participantId.trim()) throw new Error("participant id required");
      const lib = library.trim() || "datachannel";
      const lbl = label.trim() || "chat";

      onStatus("creating/joining session...", "info");
      /** @type {Record<string, unknown> | undefined} */
      let backendOpts;
      if (lib === "datachannel") {
        if (mode === "mfu") {
          backendOpts = {
            mode: "mfu",
            default_dest: "except_sender",
            labels: [...GAME_DATA_CHANNEL_LABELS],
            default_label: CHAT_LABEL,
            rpc_router: true,
            state_coalesce: true
          };
        } else {
          backendOpts = { mode, default_label: lbl };
        }
      } else if (lib === "conference") {
        backendOpts = conferenceBackendOpts(audioMode, mcuCascade, {
          trunkProfile,
          spokeMixMinus
        });
      }
      const { created } = await ensureSession({
        baseUrl: baseUrl.trim(),
        tenantId: tenantId.trim(),
        sessionId: sessionId.trim(),
        library: lib,
        backendOpts
      });
      appendLog(
        "info",
        created ? `created ${sessionId}` : `joined existing ${sessionId}`
      );

      if (lib === "datachannel") {
        const labels =
          mode === "mfu" ? [...GAME_DATA_CHANNEL_LABELS] : [lbl];
        await connectDatachannel(labels);
      } else {
        await connectAv();
      }
    } catch (err) {
      console.error("[xylon-client]", err);
      const msgText = String(err && err.message ? err.message : err);
      onStatus(msgText, "danger");
      appendLog("info", msgText);
      onDisconnect();
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    try {
      await leaveParticipant({
        baseUrl: baseUrl.trim(),
        tenantId: tenantId.trim(),
        sessionId: sessionId.trim(),
        participantId: participantId.trim()
      });
    } catch (_) {}
    try {
      if (rpcRef.current) {
        rpcRef.current.close();
        rpcRef.current = null;
      }
    } catch (_) {}
    stopState();
    setStateAccepted(0);
    setStateDropped(0);
    try {
      for (const dc of Object.values(channelsRef.current)) {
        dc.close();
      }
    } catch (_) {}
    try {
      if (dcRef.current) dcRef.current.close();
    } catch (_) {}
    try {
      if (pcRef.current) pcRef.current.close();
    } catch (_) {}
    try {
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop();
      }
    } catch (_) {}
    pcRef.current = null;
    dcRef.current = null;
    channelsRef.current = {};
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setRoomUi(false, false);
    appendLog("info", "disconnected");
    onStatus("room disconnected", "muted");
  }

  function onSend() {
    const dc =
      channelsRef.current[CHAT_LABEL] || dcRef.current;
    if (!dc || dc.readyState !== "open") {
      onStatus("room dc not open", "warn");
      return;
    }
    const payload =
      mode === "mfu"
        ? JSON.stringify({ type: "chat", text: msg })
        : msg;
    dc.send(payload);
    appendLog("sent", payload);
    setMsg("");
  }

  async function onRpcPing() {
    const rpc = rpcRef.current;
    if (!rpc) {
      onStatus("rpc not ready", "warn");
      return;
    }
    const peer = rpcPeer.trim();
    if (!peer) {
      onStatus("rpc peer id required", "warn");
      return;
    }
    const t0 = performance.now();
    try {
      const result = await rpc.performRpc(peer, "ping", { t: Date.now() }, {
        timeoutMs: 5000
      });
      const ms = Math.round(performance.now() - t0);
      appendLog("rpc", `ping -> ${peer} ${ms}ms ${JSON.stringify(result)}`);
      onStatus(`rpc ok ${ms}ms`, "ok");
    } catch (err) {
      const text = String(err && err.message ? err.message : err);
      appendLog("rpc", `ping failed: ${text}`);
      onStatus(text, "danger");
    }
  }

  return (
    <Card
      outlined
      title="HTTP Lab"
      subtitle="POST /v1/sessions + offer · control off / x-tenant-id."
    >
      <Stack gap={12}>
        <Text as="p" class="xylon-hint">
          Unique participant per tab. Datachannel mode <code>mfu</code> opens
          chat/rpc/state with <code>rpc_router</code> + <code>state_coalesce</code>
          (RPC ping + 10 Hz transform ticks). Opaque modes use a single DC label.
        </Text>
        <Field
          label="Base URL"
          value={baseUrl}
          onInput={(e) => setBaseUrl(e.target.value)}
        />
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
          <Select
            label="Library"
            value={library}
            onChange={(e) => {
              const next = e.target.value;
              setLibrary(next);
              setSessionId((id) => {
                const raw = String(id || "room");
                const base = raw.replace(/-(datachannel|conference|echo)$/, "");
                return `${base}-${next}`;
              });
            }}
            options={[
              { value: "datachannel", label: "datachannel" },
              { value: "conference", label: "conference" },
              { value: "echo", label: "echo" }
            ]}
          />
          {isDc ? (
            <>
              {!isGameMfu ? (
                <Field
                  label="DC label"
                  value={label}
                  onInput={(e) => setLabel(e.target.value)}
                />
              ) : null}
              <Select
                label="Mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                options={[
                  { value: "mfu", label: "mfu (chat+rpc+state)" },
                  {
                    value: "fanout_except_sender",
                    label: "fanout_except_sender"
                  },
                  { value: "fanout_all", label: "fanout_all" }
                ]}
              />
            </>
          ) : null}
          {isAv ? (
            <>
              {library === "conference" ? (
                <>
                  <Select
                    label="Conference audio"
                    value={audioMode}
                    onChange={(e) => setAudioMode(e.target.value)}
                    options={[
                      { value: "sfu", label: "sfu (mesh)" },
                      { value: "mcu", label: "mcu (mix mid 0)" }
                    ]}
                  />
                  <Select
                    label="MCU cascade"
                    value={mcuCascade}
                    onChange={(e) => setMcuCascade(e.target.value)}
                    options={[
                      { value: "", label: "none" },
                      { value: "hub", label: "hub" },
                      { value: "spoke", label: "spoke" }
                    ]}
                  />
                  {mcuCascade === "hub" || mcuCascade === "spoke" ? (
                    <Select
                      label="Cascade trunk profile"
                      value={trunkProfile}
                      onChange={(e) => setTrunkProfile(e.target.value)}
                      options={[
                        { value: "opus", label: "opus (default)" },
                        { value: "pcm", label: "pcm (L16)" }
                      ]}
                    />
                  ) : null}
                  {mcuCascade === "hub" ? (
                    <Check
                      label="Spoke mix-minus"
                      checked={spokeMixMinus}
                      onChange={(e) => setSpokeMixMinus(e.target.checked)}
                    />
                  ) : null}
                </>
              ) : null}
              <Check
                label="Audio"
                checked={audio}
                onChange={(e) => setAudio(e.target.checked)}
              />
              <Check
                label="Video"
                checked={video}
                onChange={(e) => setVideo(e.target.checked)}
              />
            </>
          ) : null}
          {library === "conference" && audioMode === "mcu" ? (
            <Text as="p" class="xylon-hint">
              MCU: create with <code>audio:mcu</code> + <code>video:sfu</code>;
              one mix mid <code>0</code> sendrecv; mesh auto-subscribes video
              only. Spoke + MCU is mix-of-mixes; hub spoke mix-minus and PCM
              trunk are opt-in.
            </Text>
          ) : null}
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
        {isDc ? (
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
        ) : null}
        {isGameMfu ? (
          <Stack row gap={8}>
            <Field
              label="RPC peer id"
              value={rpcPeer}
              onInput={(e) => setRpcPeer(e.target.value)}
              disabled={!dcReady}
            />
            <Btn type="button" disabled={!dcReady} onClick={onRpcPing}>
              RPC ping
            </Btn>
            <Text as="span" class="xylon-hint">
              state ok={stateAccepted} drop={stateDropped}
            </Text>
          </Stack>
        ) : null}
        {isAv ? (
          <div class="xylon-media">
            <video ref={localVideoRef} autoplay playsinline muted />
            <video ref={remoteVideoRef} autoplay playsinline />
            <audio ref={remoteAudioRef} autoplay />
          </div>
        ) : null}
        <pre class="xylon-log">{log || " "}</pre>
      </Stack>
    </Card>
  );
}
