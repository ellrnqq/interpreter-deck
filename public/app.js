const state = {
  sourceMode: "mic",
  sourceStream: null,
  peerConnection: null,
  dataChannel: null,
  audioContext: null,
  analyser: null,
  animationFrame: null,
  firstCaptionStartedAt: null,
  sessionStartedAt: null,
  eventCount: 0,
  muted: false,
  translatedText: "",
  sourceText: "",
  lastTranslatedChunk: "",
  noCaptionTimer: null,
  lastSignal: 0,
  pins: []
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  sourceButtons: [...document.querySelectorAll("[data-source]")],
  targetLanguage: document.querySelector("#targetLanguage"),
  stageLanguage: document.querySelector("#stageLanguage"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  muteButton: document.querySelector("#muteButton"),
  translatedVolume: document.querySelector("#translatedVolume"),
  translatedAudio: document.querySelector("#translatedAudio"),
  spotlightText: document.querySelector("#spotlightText"),
  sourceTranscript: document.querySelector("#sourceTranscript"),
  translatedTranscript: document.querySelector("#translatedTranscript"),
  levelCanvas: document.querySelector("#levelCanvas"),
  signalValue: document.querySelector("#signalValue"),
  webrtcValue: document.querySelector("#webrtcValue"),
  channelValue: document.querySelector("#channelValue"),
  eventCount: document.querySelector("#eventCount"),
  firstCaption: document.querySelector("#firstCaption"),
  eventLog: document.querySelector("#eventLog"),
  clearButton: document.querySelector("#clearButton"),
  pinButton: document.querySelector("#pinButton"),
  clearPins: document.querySelector("#clearPins"),
  pins: document.querySelector("#pins"),
  copySource: document.querySelector("#copySource")
};

const languageFallback = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  hi: "Hindi",
  ru: "Russian",
  id: "Indonesian",
  vi: "Vietnamese"
};

function setStatus(text, tone = "idle") {
  els.connectionStatus.classList.toggle("live", tone === "live");
  els.connectionStatus.classList.toggle("warn", tone === "warn");
  els.connectionStatus.querySelector("span:last-child").textContent = text;
}

function logEvent(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  els.eventLog.prepend(item);
  while (els.eventLog.children.length > 18) {
    els.eventLog.lastElementChild.remove();
  }
}

async function loadLanguages() {
  let languages = languageFallback;
  try {
    const response = await fetch("/api/languages");
    if (response.ok) {
      languages = await response.json();
    }
  } catch {
    logEvent("Using bundled language list.");
  }

  els.targetLanguage.replaceChildren(
    ...Object.entries(languages).map(([code, label]) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      return option;
    })
  );
  els.targetLanguage.value = "en";
  syncLanguageLabel();
}

function syncLanguageLabel() {
  const selected = els.targetLanguage.selectedOptions[0];
  els.stageLanguage.textContent = selected?.textContent || "Translation";
}

function showUserMessage(message, tone = "warn") {
  els.spotlightText.textContent = message;
  setStatus(tone === "warn" ? "Check log" : "Live", tone);
}

function clearTranscripts() {
  state.translatedText = "";
  state.sourceText = "";
  state.lastTranslatedChunk = "";
  state.firstCaptionStartedAt = null;
  els.sourceTranscript.textContent = "";
  els.translatedTranscript.textContent = "";
  els.spotlightText.textContent = "Waiting for translated speech.";
  els.firstCaption.textContent = "--";
  els.webrtcValue.textContent = "--";
  els.channelValue.textContent = "--";
}

function clearNoCaptionTimer() {
  if (state.noCaptionTimer) {
    clearTimeout(state.noCaptionTimer);
    state.noCaptionTimer = null;
  }
}

function appendTranscript(kind, delta) {
  const text = delta || "";
  if (!text) return;

  if (kind === "translation") {
    state.translatedText += text;
    state.lastTranslatedChunk = (state.lastTranslatedChunk + text).slice(-360);
    els.translatedTranscript.textContent = state.translatedText;
    els.spotlightText.textContent = tailSentence(state.translatedText);

    if (!state.firstCaptionStartedAt && state.sessionStartedAt) {
      state.firstCaptionStartedAt = performance.now();
      const seconds = (state.firstCaptionStartedAt - state.sessionStartedAt) / 1000;
      els.firstCaption.textContent = `${seconds.toFixed(1)}s`;
    }
  } else {
    state.sourceText += text;
    els.sourceTranscript.textContent = state.sourceText;
  }

  scrollToEnd(kind === "translation" ? els.translatedTranscript : els.sourceTranscript);
}

function tailSentence(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Waiting for translated speech.";

  const chunks = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = chunks.slice(-2).join(" ");
  return last.length > 220 ? `${last.slice(-217)}...` : last;
}

function scrollToEnd(element) {
  element.scrollTop = element.scrollHeight;
}

async function captureSourceAudio() {
  if (state.sourceMode === "tab") {
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio
    });

    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("No tab audio track was selected.");
    }
    stream.getVideoTracks().forEach((track) => {
      track.enabled = false;
    });
    return stream;
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

async function createClientSecret(targetLanguage) {
  const response = await fetch("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetLanguage })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "Could not create a Realtime Translation session.");
  }

  const secret = body.value || body.client_secret?.value || body.client_secret;
  if (!secret) {
    throw new Error("The server did not return a client secret.");
  }

  return secret;
}

async function startTranslation() {
  els.startButton.disabled = true;
  clearTranscripts();
  setStatus("Starting");
  logEvent("Creating translation session.");

  try {
    const targetLanguage = els.targetLanguage.value;
    const targetLabel = els.targetLanguage.selectedOptions[0]?.textContent || targetLanguage;
    state.sessionStartedAt = performance.now();
    const [clientSecret, sourceStream] = await Promise.all([
      createClientSecret(targetLanguage),
      captureSourceAudio()
    ]);
    state.sourceStream = sourceStream;
    logEvent(`Source audio captured. Target: ${targetLabel}.`);

    startMeter(sourceStream);

    const pc = new RTCPeerConnection();
    state.peerConnection = pc;

    sourceStream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, sourceStream);
      track.addEventListener("ended", () => stopTranslation("Source stopped."));
    });

    const events = pc.createDataChannel("oai-events");
    state.dataChannel = events;
    events.onopen = () => {
      els.channelValue.textContent = "open";
      logEvent("Realtime data channel opened.");
    };
    events.onmessage = handleRealtimeEvent;
    events.onerror = () => {
      els.channelValue.textContent = "error";
      logEvent("Realtime data channel error.");
    };
    events.onclose = () => {
      els.channelValue.textContent = "closed";
      logEvent("Realtime data channel closed.");
    };

    pc.onconnectionstatechange = () => {
      const label = pc.connectionState;
      els.webrtcValue.textContent = label;
      if (label === "connected") setStatus("Live", "live");
      if (["failed", "disconnected", "closed"].includes(label)) {
        setStatus(label, label === "closed" ? "idle" : "warn");
      }
      logEvent(`Peer connection: ${label}.`);
    };

    pc.oniceconnectionstatechange = () => {
      logEvent(`ICE connection: ${pc.iceConnectionState}.`);
    };

    pc.ontrack = ({ streams }) => {
      els.translatedAudio.srcObject = streams[0];
      els.translatedAudio.volume = Number(els.translatedVolume.value);
      els.translatedAudio.muted = state.muted;
      void els.translatedAudio.play().catch(() => {
        logEvent("Audio playback needs a browser gesture.");
      });
      logEvent("Translated audio track received.");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(
      "https://api.openai.com/v1/realtime/translations/calls",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      }
    );

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      throw new Error(`OpenAI WebRTC call failed: ${errorText}`);
    }

    await pc.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    els.stopButton.disabled = false;
    setStatus("Live", "live");
    logEvent("Translation is live. Speak in a language different from the selected target.");
    clearNoCaptionTimer();
    state.noCaptionTimer = setTimeout(() => {
      if (!state.sourceText && !state.translatedText) {
        const hint =
          state.lastSignal < 4
            ? "No captions yet. The browser is not receiving much microphone or tab audio."
            : "No captions yet. Try speaking a language different from the selected target.";
        logEvent(hint);
        showUserMessage(hint);
      }
    }, 12000);
  } catch (error) {
    stopTranslation(error.message || "Startup failed.");
    setStatus("Error", "warn");
    showUserMessage(error.message || "Startup failed.");
  } finally {
    els.startButton.disabled = false;
  }
}

function handleRealtimeEvent({ data }) {
  let event;
  try {
    event = JSON.parse(data);
  } catch {
    logEvent("Received an unreadable event.");
    return;
  }

  state.eventCount += 1;
  els.eventCount.textContent = String(state.eventCount);

  if (event.type === "session.output_transcript.delta") {
    appendTranscript("translation", event.delta);
  } else if (event.type === "session.input_transcript.delta") {
    appendTranscript("source", event.delta);
  } else if (event.type === "error") {
    logEvent(event.error?.message || "Realtime API error.");
    setStatus("Error", "warn");
    showUserMessage(event.error?.message || "Realtime API error.");
  } else if (event.type?.endsWith(".done")) {
    logEvent(event.type);
  } else if (state.eventCount <= 8) {
    logEvent(event.type || "Realtime event received.");
  }
}

function stopTranslation(reason = "Stopped.") {
  clearNoCaptionTimer();

  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }

  if (state.audioContext) {
    void state.audioContext.close();
    state.audioContext = null;
  }

  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }

  if (state.sourceStream) {
    state.sourceStream.getTracks().forEach((track) => track.stop());
    state.sourceStream = null;
  }

  els.translatedAudio.srcObject = null;
  els.stopButton.disabled = true;
  setStatus("Idle");
  logEvent(reason);
  drawIdleMeter();
}

function startMeter(stream) {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  state.audioContext = audioContext;
  state.analyser = analyser;
  drawMeter();
}

function drawMeter() {
  const canvas = els.levelCanvas;
  const context = canvas.getContext("2d");
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteTimeDomainData(data);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#171f21";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#f3bf62";
  context.lineWidth = 3;
  context.beginPath();

  let sum = 0;
  data.forEach((value, index) => {
    const x = (index / (data.length - 1)) * canvas.width;
    const centered = value - 128;
    const y = canvas.height / 2 + centered * 0.55;
    sum += Math.abs(centered);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  const signal = Math.min(100, Math.round((sum / data.length / 42) * 100));
  state.lastSignal = signal;
  els.signalValue.textContent = `${signal}%`;
  state.animationFrame = requestAnimationFrame(drawMeter);
}

function drawIdleMeter() {
  const canvas = els.levelCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#171f21";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 253, 248, 0.2)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, canvas.height / 2);
  context.lineTo(canvas.width, canvas.height / 2);
  context.stroke();
  els.signalValue.textContent = "0%";
}

function pinCurrentTranslation() {
  const text = tailSentence(state.lastTranslatedChunk || state.translatedText);
  if (!text || text === "Waiting for translated speech.") return;

  state.pins.unshift({
    id: crypto.randomUUID(),
    text,
    time: new Date()
  });
  state.pins = state.pins.slice(0, 12);
  renderPins();
}

function renderPins() {
  if (!state.pins.length) {
    els.pins.innerHTML = '<p class="empty-state">No pinned captions yet.</p>';
    return;
  }

  els.pins.replaceChildren(
    ...state.pins.map((pin) => {
      const article = document.createElement("article");
      article.className = "pin-card";
      const time = document.createElement("time");
      time.dateTime = pin.time.toISOString();
      time.textContent = pin.time.toLocaleTimeString();
      const text = document.createElement("p");
      text.textContent = pin.text;
      article.append(time, text);
      return article;
    })
  );
}

async function copyText(text, label) {
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
  logEvent(`${label} copied.`);
}

els.sourceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.sourceMode = button.dataset.source;
    els.sourceButtons.forEach((item) => {
      item.classList.toggle("active", item === button);
    });
  });
});

els.targetLanguage.addEventListener("change", syncLanguageLabel);
els.startButton.addEventListener("click", startTranslation);
els.stopButton.addEventListener("click", () => stopTranslation());
els.clearButton.addEventListener("click", clearTranscripts);
els.pinButton.addEventListener("click", pinCurrentTranslation);
els.clearPins.addEventListener("click", () => {
  state.pins = [];
  renderPins();
});
els.copySource.addEventListener("click", () => copyText(state.sourceText, "Source transcript"));

els.translatedVolume.addEventListener("input", () => {
  els.translatedAudio.volume = Number(els.translatedVolume.value);
});

els.muteButton.addEventListener("click", () => {
  state.muted = !state.muted;
  els.translatedAudio.muted = state.muted;
  els.muteButton.classList.toggle("active", state.muted);
  els.muteButton.setAttribute(
    "aria-label",
    state.muted ? "Unmute translated audio" : "Mute translated audio"
  );
});

window.addEventListener("beforeunload", () => stopTranslation("Window closed."));

drawIdleMeter();
renderPins();
void loadLanguages();
