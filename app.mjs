import {
  MAX_NODES,
  addNode,
  constellationEdges,
  createWorld,
  cycleAtmosphere,
  decodeWorld,
  encodeWorld,
  generateStars,
  getAtmosphere,
  hitNode,
  makeSeed,
  moveNode,
  nodeFrequency,
  removeNode,
  sanitizeWorld,
} from "./core.mjs";

const STORAGE_KEY = "lumen-world-v1";
const STEP_MS = 620;
const canvas = document.querySelector("#sky");
const context = canvas.getContext("2d");
const welcome = document.querySelector("#welcome");
const countLabel = document.querySelector("#node-count");
const progress = document.querySelector("#progress");
const status = document.querySelector("#status");
const guide = document.querySelector("#guide");
const guideTrigger = document.querySelector('.instrument [data-action="guide"]');
const clearTrigger = document.querySelector('[data-action="clear"]');
const pageRegions = [document.querySelector(".masthead"), document.querySelector("main"), document.querySelector(".instrument")];

let viewport = { width: 1, height: 1, ratio: 1 };
let world = loadWorld();
let backgroundStars = generateStars(world.seed);
let ripples = [];
let motes = [];
let dragging = null;
let playing = false;
let muted = false;
let playIndex = -1;
let nextStepAt = 0;
let lastFrame = performance.now();
let statusTimer = null;
let audio = null;

class LumenAudio {
  constructor() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = AudioContext ? new AudioContext() : null;
    if (!this.context) return;

    this.master = this.context.createGain();
    this.master.gain.value = 0.26;
    this.filter = this.context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 3100;
    this.filter.Q.value = 0.7;
    this.filter.connect(this.master);
    this.master.connect(this.context.destination);
  }

  async wake() {
    if (this.context?.state === "suspended") await this.context.resume();
  }

  play(frequency, pan = 0, strength = 1) {
    if (!this.context || muted) return;
    this.wake();
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner?.();
    const fundamental = this.context.createOscillator();
    const shimmer = this.context.createOscillator();

    fundamental.type = "sine";
    shimmer.type = "triangle";
    fundamental.frequency.setValueAtTime(frequency, now);
    shimmer.frequency.setValueAtTime(frequency * 2.002, now);
    shimmer.detune.setValueAtTime(4, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15 * strength, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    if (panner) {
      panner.pan.setValueAtTime(Math.max(-0.8, Math.min(0.8, pan)), now);
      gain.connect(panner);
      panner.connect(this.filter);
    } else {
      gain.connect(this.filter);
    }
    fundamental.connect(gain);
    shimmer.connect(gain);
    fundamental.start(now);
    shimmer.start(now);
    fundamental.stop(now + 1.7);
    shimmer.stop(now + 1.7);
  }
}

function loadWorld() {
  const shared = location.hash.startsWith("#sky=") ? decodeWorld(location.hash.slice(5)) : null;
  if (shared) return shared;
  try {
    const stored = sanitizeWorld(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (stored) return stored;
  } catch {
    // A broken local save should never keep the sky from opening.
  }
  return createWorld(makeSeed());
}

function saveWorld() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(world));
  } catch {
    // Storage can be disabled; the instrument should remain playable in memory.
  }
}

function syncInterface() {
  const atmosphere = getAtmosphere(world.atmosphere);
  const hasLights = world.nodes.length > 0;
  document.body.dataset.atmosphere = world.atmosphere;
  document.body.classList.toggle("is-playing", playing);
  document.body.classList.toggle("is-muted", muted);
  welcome.classList.toggle("is-hidden", hasLights);
  welcome.setAttribute("aria-hidden", String(hasLights));
  countLabel.textContent = String(world.nodes.length).padStart(2, "0");
  canvas.setAttribute(
    "aria-label",
    `An interactive ${atmosphere.label.toLowerCase()} sky with ${world.nodes.length} lights.`,
  );
  const playButton = document.querySelector('[data-action="play"]');
  playButton.setAttribute("aria-label", playing ? "Pause constellation" : "Play constellation");
  playButton.setAttribute("aria-pressed", String(playing));
  playButton.disabled = !hasLights;
  document.querySelector("#play-label").textContent = playing ? "Pause" : "Play";
  const soundButton = document.querySelector('[data-action="sound"]');
  soundButton.setAttribute("aria-label", muted ? "Turn sound on" : "Mute sound");
  soundButton.setAttribute("aria-pressed", String(!muted));
  document.querySelector("#sound-label").textContent = muted ? "Muted" : "Sound";
  const moodButton = document.querySelector('[data-action="atmosphere"]');
  moodButton.setAttribute("aria-label", `Change atmosphere, current ${atmosphere.label}`);
  document.querySelector("#mood-label").textContent = atmosphere.label;
  document.querySelector('[data-action="add"]').disabled = world.nodes.length >= MAX_NODES;
  document.querySelector('[data-action="share"]').disabled = !hasLights;
  clearTrigger.disabled = !hasLights;
}

function setWorld(next, { save = true } = {}) {
  world = next;
  if (save) saveWorld();
  syncInterface();
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  viewport = { width: window.innerWidth, height: window.innerHeight, ratio };
  canvas.width = Math.round(viewport.width * ratio);
  canvas.height = Math.round(viewport.height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function coordinates(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  };
}

function ensureAudio() {
  audio ??= new LumenAudio();
  audio.wake();
}

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function addRipple(node, strong = false) {
  ripples.push({ x: node.x, y: node.y, age: 0, life: strong ? 1500 : 950, strong });
  const atmosphere = getAtmosphere(world.atmosphere);
  const color = atmosphere.colors[world.nodes.indexOf(node) % atmosphere.colors.length];
  for (let index = 0; index < (strong ? 14 : 8); index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 0.012 + Math.random() * 0.025;
    motes.push({
      x: node.x,
      y: node.y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      age: 0,
      life: 650 + Math.random() * 700,
      size: 0.8 + Math.random() * 1.7,
      color,
    });
  }
}

function playNode(index, strong = false) {
  if (!world.nodes.length) return;
  const normalizedIndex = (index + world.nodes.length) % world.nodes.length;
  const node = world.nodes[normalizedIndex];
  playIndex = normalizedIndex;
  audio?.play(nodeFrequency(node, world.atmosphere), node.x * 2 - 1, strong ? 1 : 0.72);
  addRipple(node, strong);
}

function togglePlaying(force) {
  if (!world.nodes.length) {
    showStatus("Place a light first");
    return;
  }
  ensureAudio();
  playing = typeof force === "boolean" ? force : !playing;
  if (playing) {
    playIndex = -1;
    nextStepAt = performance.now();
    showStatus("The sky is playing");
  } else {
    showStatus("The sky is resting");
    progress.style.width = "0";
  }
  syncInterface();
}

function showStatus(message) {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  status.classList.add("is-visible");
  statusTimer = window.setTimeout(() => status.classList.remove("is-visible"), 1800);
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  ensureAudio();
  const point = coordinates(event);
  const target = hitNode(world.nodes, point.x, point.y, 24 / viewport.width, 24 / viewport.height);

  if (event.altKey && target) {
    setWorld(removeNode(world, target.id));
    addRipple(target);
    showStatus("One light returned to the dark");
    return;
  }

  if (target) {
    dragging = { id: target.id, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    playNode(world.nodes.indexOf(target), true);
    return;
  }

  const node = placeLight(point.x, point.y);
  if (!node) return;
  dragging = { id: node.id, pointerId: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
}

function placeLight(x, y, message) {
  ensureAudio();
  if (world.nodes.length >= MAX_NODES) {
    showStatus("This sky is full — 24 lights");
    return null;
  }
  setWorld(addNode(world, x, y));
  const node = world.nodes.at(-1);
  addRipple(node, true);
  audio.play(nodeFrequency(node, world.atmosphere), node.x * 2 - 1, 1);
  if (message || world.nodes.length === 1) showStatus(message || "Your first light");
  return node;
}

function placeKeyboardLight() {
  const index = world.nodes.length;
  const angle = index * 2.399963 - Math.PI / 2;
  const radius = 0.1 + Math.min(index, 11) * 0.024;
  placeLight(0.5 + Math.cos(angle) * radius, 0.43 + Math.sin(angle) * radius, "A new light");
}

function onPointerMove(event) {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  const point = coordinates(event);
  setWorld(moveNode(world, dragging.id, point.x, point.y));
}

function onPointerUp(event) {
  if (!dragging || dragging.pointerId !== event.pointerId) return;
  dragging = null;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

function drawStarfield(time) {
  context.save();
  backgroundStars.forEach((star) => {
    const pulse = 0.72 + Math.sin(time * 0.00035 * star.speed + star.phase) * 0.28;
    context.beginPath();
    context.arc(star.x * viewport.width, star.y * viewport.height, star.size, 0, Math.PI * 2);
    context.fillStyle = `rgba(225, 235, 239, ${star.alpha * pulse})`;
    context.fill();
  });
  context.restore();
}

function drawEdges() {
  if (world.nodes.length < 2) return;
  const edges = constellationEdges(world.nodes);
  const atmosphere = getAtmosphere(world.atmosphere);
  context.save();
  context.lineWidth = 0.7;
  edges.forEach(({ from, to, distance }) => {
    const gradient = context.createLinearGradient(
      from.x * viewport.width,
      from.y * viewport.height,
      to.x * viewport.width,
      to.y * viewport.height,
    );
    gradient.addColorStop(0, colorWithAlpha(atmosphere.colors[world.nodes.indexOf(from) % 4], 0.28));
    gradient.addColorStop(1, colorWithAlpha(atmosphere.colors[world.nodes.indexOf(to) % 4], 0.28));
    context.strokeStyle = gradient;
    context.globalAlpha = Math.max(0.18, 1 - distance / 0.42);
    context.beginPath();
    context.moveTo(from.x * viewport.width, from.y * viewport.height);
    context.lineTo(to.x * viewport.width, to.y * viewport.height);
    context.stroke();
  });
  context.restore();
}

function drawRipples(delta) {
  const atmosphere = getAtmosphere(world.atmosphere);
  ripples = ripples.filter((ripple) => ripple.age < ripple.life);
  ripples.forEach((ripple) => {
    ripple.age += delta;
    const amount = ripple.age / ripple.life;
    context.beginPath();
    context.arc(
      ripple.x * viewport.width,
      ripple.y * viewport.height,
      7 + amount * (ripple.strong ? 58 : 38),
      0,
      Math.PI * 2,
    );
    context.strokeStyle = colorWithAlpha(atmosphere.colors[0], (1 - amount) * 0.27);
    context.lineWidth = 1;
    context.stroke();
  });
}

function drawMotes(delta) {
  motes = motes.filter((mote) => mote.age < mote.life);
  motes.forEach((mote) => {
    mote.age += delta;
    const seconds = delta / 1000;
    mote.x += mote.vx * seconds;
    mote.y += mote.vy * seconds;
    mote.vy -= 0.002 * seconds;
    const alpha = Math.max(0, 1 - mote.age / mote.life);
    if (alpha === 0) return;
    context.beginPath();
    context.arc(mote.x * viewport.width, mote.y * viewport.height, mote.size * alpha, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(mote.color, alpha * 0.7);
    context.fill();
  });
}

function drawNodes(time) {
  const atmosphere = getAtmosphere(world.atmosphere);
  world.nodes.forEach((node, index) => {
    const x = node.x * viewport.width;
    const y = node.y * viewport.height;
    const active = index === playIndex && playing;
    const pulse = 1 + Math.sin(time * 0.0017 + node.phase) * 0.08 + (active ? 0.34 : 0);
    const radius = 3.1 * node.size * pulse;
    const color = atmosphere.colors[index % atmosphere.colors.length];
    const glow = context.createRadialGradient(x, y, 0, x, y, active ? 42 : 25);
    glow.addColorStop(0, colorWithAlpha(color, active ? 0.38 : 0.25));
    glow.addColorStop(0.24, colorWithAlpha(color, active ? 0.18 : 0.09));
    glow.addColorStop(1, colorWithAlpha(color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, active ? 42 : 25, 0, Math.PI * 2);
    context.fill();

    context.shadowColor = color;
    context.shadowBlur = active ? 18 : 11;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    context.fillStyle = "rgba(255, 255, 255, 0.88)";
    context.beginPath();
    context.arc(x - radius * 0.23, y - radius * 0.25, Math.max(0.7, radius * 0.24), 0, Math.PI * 2);
    context.fill();
  });
}

function updatePlayback(time) {
  if (!playing || !world.nodes.length) return;
  if (time >= nextStepAt) {
    playNode(playIndex + 1);
    nextStepAt = time + STEP_MS;
  }
  const elapsed = STEP_MS - Math.max(0, nextStepAt - time);
  const cycleProgress = ((Math.max(0, playIndex) + elapsed / STEP_MS) / world.nodes.length) * 100;
  progress.style.width = `${Math.min(100, cycleProgress)}%`;
  if (cycleProgress >= 99.8) window.setTimeout(() => (progress.style.width = "0"), 80);
}

function render(time) {
  const delta = Math.min(50, time - lastFrame);
  lastFrame = time;
  context.clearRect(0, 0, viewport.width, viewport.height);
  drawStarfield(time);
  drawEdges();
  drawRipples(delta);
  drawMotes(delta);
  drawNodes(time);
  updatePlayback(time);
  requestAnimationFrame(render);
}

async function shareSky() {
  if (!world.nodes.length) {
    showStatus("Place a light before sharing");
    return;
  }
  const url = new URL(location.href);
  url.hash = `sky=${encodeWorld(world)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "My LUMEN sky", text: "I made a tiny sky.", url: url.href });
      showStatus("Sky shared");
    } else {
      await navigator.clipboard.writeText(url.href);
      showStatus("Sky link copied");
    }
  } catch (error) {
    if (error.name !== "AbortError") showStatus("Could not copy — use the address bar");
  }
}

function clearSky() {
  if (!world.nodes.length || document.querySelector(".confirm")) return;
  const fragment = document.querySelector("#confirm-template").content.cloneNode(true);
  document.body.append(fragment);
  const confirm = document.querySelector(".confirm");
  setPageInert(true);
  const keepButton = confirm.querySelector('[data-confirm="no"]');
  keepButton.focus();
  keepButton.addEventListener("click", dismissConfirm);
  confirm.querySelector('[data-confirm="yes"]').addEventListener("click", () => {
    playing = false;
    setWorld(createWorld(makeSeed()));
    backgroundStars = generateStars(world.seed);
    ripples = [];
    motes = [];
    playIndex = -1;
    progress.style.width = "0";
    history.replaceState(null, "", location.pathname + location.search);
    dismissConfirm();
    showStatus("A fresh patch of night");
  });
}

function setPageInert(inert) {
  pageRegions.forEach((region) => {
    region.inert = inert;
  });
}

function dismissConfirm() {
  const confirm = document.querySelector(".confirm");
  if (!confirm) return;
  confirm.remove();
  setPageInert(false);
  const returnTarget = world.nodes.length ? clearTrigger : document.querySelector('[data-action="add"]');
  returnTarget.focus();
}

function toggleGuide(force) {
  const open = typeof force === "boolean" ? force : !guide.classList.contains("is-open");
  guide.classList.toggle("is-open", open);
  guide.setAttribute("aria-hidden", String(!open));
  guide.inert = !open;
  setPageInert(open);
  if (open) guide.querySelector(".guide__close").focus();
  else guideTrigger.focus();
}

function handleAction(action) {
  switch (action) {
    case "add":
      placeKeyboardLight();
      break;
    case "play":
      togglePlaying();
      break;
    case "sound":
      ensureAudio();
      muted = !muted;
      showStatus(muted ? "Sound off" : "Sound on");
      syncInterface();
      break;
    case "atmosphere": {
      setWorld(cycleAtmosphere(world));
      const atmosphere = getAtmosphere(world.atmosphere);
      if (world.nodes.length) playNode(Math.max(0, playIndex), true);
      showStatus(atmosphere.label);
      break;
    }
    case "share":
      shareSky();
      break;
    case "clear":
      clearSky();
      break;
    case "guide":
      toggleGuide();
      break;
  }
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resize);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) handleAction(button.dataset.action);
  if (event.target === guide) toggleGuide(false);
});

document.addEventListener("keydown", (event) => {
  const dialogOpen = guide.classList.contains("is-open") || Boolean(document.querySelector(".confirm"));
  if (event.key === "Escape") {
    if (guide.classList.contains("is-open")) toggleGuide(false);
    else dismissConfirm();
  } else if (dialogOpen) {
    return;
  } else if (event.key === " ") {
    event.preventDefault();
    togglePlaying();
  } else if (event.key.toLowerCase() === "m") {
    handleAction("sound");
  } else if (event.key.toLowerCase() === "a") {
    handleAction("atmosphere");
  } else if (event.key.toLowerCase() === "l") {
    placeKeyboardLight();
  }
});

resize();
syncInterface();
requestAnimationFrame(render);
