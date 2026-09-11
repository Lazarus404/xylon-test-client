import {
  Inviter,
  Registerer,
  SessionState,
  UserAgent
} from "sip.js";

function sdhOptions(plan, onDataChannel) {
  return {
    constraints: plan.getUserMedia,
    peerConnectionConfiguration: { iceServers: [] },
    iceGatheringTimeout: 3000,
    dataChannel: plan.datachannel,
    dataChannelLabel: "echo",
    onDataChannel
  };
}

function attachRemoteMedia(sdh, remoteVideoEl, remoteAudioEl) {
  if (!sdh) return;
  const stream = sdh.remoteMediaStream;
  if (!stream) return;

  if (stream.getAudioTracks().length && remoteAudioEl) {
    remoteAudioEl.srcObject = stream;
    remoteAudioEl.play().catch(() => {});
  }
  if (stream.getVideoTracks().length && remoteVideoEl) {
    remoteVideoEl.srcObject = stream;
    remoteVideoEl.play().catch(() => {});
  }
}

/**
 * @param {{
 *   wsUrl: string,
 *   fromAor: string,
 *   targetAor: string,
 *   plan: object,
 *   localVideoEl: HTMLVideoElement | null,
 *   remoteVideoEl: HTMLVideoElement | null,
 *   remoteAudioEl: HTMLAudioElement | null,
 *   onStatus: (msg: string, tone?: string) => void,
 *   onDcOpen: () => void,
 *   onTerminated: () => void,
 * }} opts
 */
export async function startSipEcho(opts) {
  const {
    wsUrl,
    fromAor,
    targetAor,
    plan,
    localVideoEl,
    remoteVideoEl,
    remoteAudioEl,
    onStatus,
    onDcOpen,
    onTerminated
  } = opts;

  let dcEchoed = false;

  /** @type {any} */
  const handle = {
    ua: null,
    registerer: null,
    session: null,
    localStream: null,
    dataChannel: null,
    localVideoEl,
    remoteVideoEl,
    remoteAudioEl
  };

  function wireDataChannel(dc) {
    handle.dataChannel = dc;
    dc.onopen = () => {
      onDcOpen();
      onStatus("datachannel open", "ok");
    };
    dc.onmessage = (ev) => {
      dcEchoed = true;
      onStatus(`DC echo: ${ev.data}`, "ok");
    };
    dc.onerror = (ev) =>
      onStatus(`DC error: ${ev && ev.message ? ev.message : ev}`, "danger");
  }

  function wirePeerConnection(sdh) {
    if (!sdh) return;
    if (sdh.dataChannel) wireDataChannel(sdh.dataChannel);

    sdh.peerConnectionDelegate = {
      ontrack: () => attachRemoteMedia(sdh, remoteVideoEl, remoteAudioEl),
      oniceconnectionstatechange: () => {
        const pc = sdh.peerConnection;
        const ice = pc ? pc.iceConnectionState : "?";
        onStatus(`ICE ${ice}; DC echoed=${dcEchoed}`, "info");
        if (ice === "connected" || ice === "completed") {
          attachRemoteMedia(sdh, remoteVideoEl, remoteAudioEl);
        }
      }
    };

    attachRemoteMedia(sdh, remoteVideoEl, remoteAudioEl);
  }

  const uri = UserAgent.makeURI(fromAor);
  if (!uri) throw new Error("invalid From AOR");

  const options = sdhOptions(plan, wireDataChannel);

  onStatus(`connecting WS ${wsUrl} ...`, "info");

  const ua = new UserAgent({
    uri,
    displayName: "xylon-test-client",
    transportOptions: {
      server: wsUrl,
      connectionTimeout: 10,
      traceSip: true
    },
    sessionDescriptionHandlerFactoryOptions: options,
    logBuiltinEnabled: true,
    logLevel: "warn",
    delegate: {
      onConnect: () => onStatus("SIP WS connected", "ok"),
      onDisconnect: (err) =>
        onStatus(`SIP WS disconnected${err ? ": " + err.message : ""}`, "warn")
    }
  });
  handle.ua = ua;

  await ua.start();
  if (!ua.isConnected()) {
    throw new Error("SIP WebSocket failed to connect (check WS URL /sip)");
  }

  const registerer = new Registerer(ua);
  handle.registerer = registerer;
  onStatus("REGISTER...", "info");
  await registerer.register();
  onStatus("REGISTER ok; creating offer...", "info");

  if (plan.needsGum) {
    const localStream = await navigator.mediaDevices.getUserMedia(plan.getUserMedia);
    handle.localStream = localStream;
    if (plan.video && localVideoEl) localVideoEl.srcObject = localStream;
  }

  const target = UserAgent.makeURI(targetAor);
  if (!target) throw new Error("invalid target AOR");

  const inviter = new Inviter(ua, target, {
    sessionDescriptionHandlerOptions: options,
    delegate: {
      onSessionDescriptionHandler: (sdh) => wirePeerConnection(sdh)
    }
  });
  handle.session = inviter;

  inviter.stateChange.addListener((state) => {
    onStatus(`session ${state}`, "info");
    if (state === SessionState.Established) {
      wirePeerConnection(inviter.sessionDescriptionHandler);
      attachRemoteMedia(inviter.sessionDescriptionHandler, remoteVideoEl, remoteAudioEl);
    }
    if (state === SessionState.Terminated) {
      onTerminated();
    }
  });

  await inviter.invite({
    requestDelegate: {
      onAccept: () => {
        onStatus("200 OK (accepted)", "ok");
        wirePeerConnection(inviter.sessionDescriptionHandler);
        attachRemoteMedia(inviter.sessionDescriptionHandler, remoteVideoEl, remoteAudioEl);
      },
      onReject: (response) => {
        const code = response && response.message && response.message.statusCode;
        onStatus(`INVITE rejected: ${code || "unknown"}`, "danger");
      }
    }
  });

  return handle;
}

export async function hangupSip(handle) {
  if (!handle) return;
  try {
    if (handle.session) await handle.session.bye();
  } catch (_) {}
  try {
    if (handle.registerer) await handle.registerer.unregister();
  } catch (_) {}
  try {
    if (handle.ua) await handle.ua.stop();
  } catch (_) {}
  if (handle.localStream) {
    for (const t of handle.localStream.getTracks()) t.stop();
  }
  if (handle.localVideoEl) handle.localVideoEl.srcObject = null;
  if (handle.remoteVideoEl) handle.remoteVideoEl.srcObject = null;
  if (handle.remoteAudioEl) handle.remoteAudioEl.srcObject = null;
}

export function sendDcPing(handle) {
  const dc = handle && handle.dataChannel;
  if (dc && dc.readyState === "open") {
    dc.send("ping-" + Date.now());
    return true;
  }
  return false;
}
