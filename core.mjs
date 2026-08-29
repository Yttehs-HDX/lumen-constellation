export const MAX_NODES = 24;

export const ATMOSPHERES = [
  {
    id: "midnight",
    label: "Midnight",
    colors: ["#c7fff0", "#b8c9ff", "#e5bfff", "#f6f0c2"],
    root: 174.61,
  },
  {
    id: "tide",
    label: "Deep tide",
    colors: ["#b9ffea", "#75e7dc", "#9dbaff", "#defbd4"],
    root: 146.83,
  },
  {
    id: "ember",
    label: "Afterglow",
    colors: ["#ffd9a3", "#ffad8f", "#ffc4cf", "#f8edbd"],
    root: 130.81,
  },
];

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19];

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeed(now = Date.now()) {
  return `${now.toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

export function createWorld(seed = makeSeed()) {
  return {
    version: 1,
    seed: String(seed),
    atmosphere: "midnight",
    nodes: [],
  };
}

export function createNode(x, y, index, seed) {
  const random = mulberry32(hashSeed(`${seed}:${index}`));
  return {
    id: `${index.toString(36)}-${Math.floor(random() * 0xffffff).toString(36)}`,
    x: clamp(Number(x)),
    y: clamp(Number(y)),
    note: SCALE[index % SCALE.length],
    size: 0.82 + random() * 0.42,
    phase: random() * Math.PI * 2,
  };
}

export function addNode(world, x, y) {
  if (world.nodes.length >= MAX_NODES) return world;
  const next = structuredClone(world);
  next.nodes.push(createNode(x, y, next.nodes.length, next.seed));
  return next;
}

export function moveNode(world, id, x, y) {
  const next = structuredClone(world);
  const node = next.nodes.find((candidate) => candidate.id === id);
  if (node) {
    node.x = clamp(Number(x));
    node.y = clamp(Number(y));
  }
  return next;
}

export function removeNode(world, id) {
  const next = structuredClone(world);
  next.nodes = next.nodes.filter((node) => node.id !== id);
  return next;
}

export function cycleAtmosphere(world) {
  const current = ATMOSPHERES.findIndex(({ id }) => id === world.atmosphere);
  const next = structuredClone(world);
  next.atmosphere = ATMOSPHERES[(current + 1 + ATMOSPHERES.length) % ATMOSPHERES.length].id;
  return next;
}

export function getAtmosphere(id) {
  return ATMOSPHERES.find((atmosphere) => atmosphere.id === id) ?? ATMOSPHERES[0];
}

export function nodeFrequency(node, atmosphereId) {
  return getAtmosphere(atmosphereId).root * 2 ** (node.note / 12);
}

export function generateStars(seed, count = 180) {
  const random = mulberry32(hashSeed(seed));
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    x: random(),
    y: random(),
    size: 0.25 + random() ** 4 * 1.65,
    alpha: 0.12 + random() * 0.58,
    phase: random() * Math.PI * 2,
    speed: 0.2 + random() * 0.8,
  }));
}

export function hitNode(nodes, x, y, radiusX, radiusY = radiusX) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const distance = Math.hypot((node.x - x) / radiusX, (node.y - y) / radiusY);
    if (distance <= 1 && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

export function constellationEdges(nodes, maxDistance = 0.34) {
  const edgeKeys = new Set();
  const edges = [];
  nodes.forEach((node, nodeIndex) => {
    const nearest = nodes
      .map((other, otherIndex) => ({
        other,
        otherIndex,
        distance: Math.hypot(node.x - other.x, node.y - other.y),
      }))
      .filter(({ otherIndex, distance }) => otherIndex !== nodeIndex && distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 2);

    nearest.forEach(({ other, otherIndex, distance }) => {
      const key = [nodeIndex, otherIndex].sort((a, b) => a - b).join(":");
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({ from: node, to: other, distance });
      }
    });
  });
  return edges;
}

function isFiniteUnit(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function sanitizeWorld(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.seed !== "string" || !candidate.seed.slice(0, 80)) return null;
  const atmosphere = ATMOSPHERES.some(({ id }) => id === candidate.atmosphere)
    ? candidate.atmosphere
    : "midnight";
  const nodes = Array.isArray(candidate.nodes)
    ? candidate.nodes
        .slice(0, MAX_NODES)
        .filter(
          (node) =>
            node &&
            typeof node.id === "string" &&
            isFiniteUnit(node.x) &&
            isFiniteUnit(node.y) &&
            Number.isFinite(node.note),
        )
        .map((node, index) => ({
          id: node.id.slice(0, 80),
          x: node.x,
          y: node.y,
          note: clamp(Math.round(node.note), -24, 48),
          size: clamp(Number(node.size) || 1, 0.6, 1.5),
          phase: Number(node.phase) || index,
        }))
    : [];

  return { version: 1, seed: candidate.seed.slice(0, 80), atmosphere, nodes };
}

export function encodeWorld(world) {
  const json = JSON.stringify(sanitizeWorld(world));
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeWorld(encoded) {
  if (typeof encoded !== "string" || encoded.length > 10_000) return null;
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return sanitizeWorld(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
