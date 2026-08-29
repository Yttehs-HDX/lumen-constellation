import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NODES,
  addNode,
  constellationEdges,
  createWorld,
  cycleAtmosphere,
  decodeWorld,
  encodeWorld,
  generateStars,
  hitNode,
  moveNode,
  removeNode,
  sanitizeWorld,
} from "../core.mjs";

test("the same seed always paints the same stars", () => {
  assert.deepEqual(generateStars("quiet-night", 4), generateStars("quiet-night", 4));
  assert.notDeepEqual(generateStars("quiet-night", 4), generateStars("another-night", 4));
});

test("nodes can be added, moved, and removed without mutating prior worlds", () => {
  const empty = createWorld("test-sky");
  const one = addNode(empty, 0.2, 0.4);
  const moved = moveNode(one, one.nodes[0].id, 2, -1);
  const removed = removeNode(moved, moved.nodes[0].id);

  assert.equal(empty.nodes.length, 0);
  assert.equal(one.nodes.length, 1);
  assert.deepEqual([moved.nodes[0].x, moved.nodes[0].y], [1, 0]);
  assert.equal(removed.nodes.length, 0);
});

test("a sky never accepts more than its intentional maximum", () => {
  let world = createWorld("full-sky");
  for (let index = 0; index < MAX_NODES + 10; index += 1) {
    world = addNode(world, index / MAX_NODES, 0.5);
  }
  assert.equal(world.nodes.length, MAX_NODES);
});

test("hit testing selects only nearby lights", () => {
  const nodes = [
    { id: "a", x: 0.1, y: 0.1 },
    { id: "b", x: 0.8, y: 0.8 },
  ];
  assert.equal(hitNode(nodes, 0.105, 0.1, 0.02)?.id, "a");
  assert.equal(hitNode(nodes, 0.5, 0.5, 0.02), null);
});

test("constellation edges are unique and distance-bounded", () => {
  const nodes = [
    { id: "a", x: 0.1, y: 0.1 },
    { id: "b", x: 0.2, y: 0.1 },
    { id: "c", x: 0.3, y: 0.1 },
    { id: "far", x: 0.9, y: 0.9 },
  ];
  const edges = constellationEdges(nodes, 0.25);
  const keys = edges.map(({ from, to }) => [from.id, to.id].sort().join(":"));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(edges.every(({ distance }) => distance <= 0.25));
  assert.ok(edges.every(({ from, to }) => from.id !== "far" && to.id !== "far"));
});

test("atmospheres cycle in a closed loop", () => {
  let world = createWorld("moods");
  const sequence = [];
  for (let index = 0; index < 4; index += 1) {
    sequence.push(world.atmosphere);
    world = cycleAtmosphere(world);
  }
  assert.deepEqual(sequence, ["midnight", "tide", "ember", "midnight"]);
});

test("shared skies make a lossless URL-safe round trip", () => {
  let world = addNode(createWorld("a sky with spaces / 光"), 0.25, 0.75);
  world = cycleAtmosphere(world);
  const encoded = encodeWorld(world);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeWorld(encoded), world);
  assert.equal(decodeWorld("not.valid%%%"), null);
  assert.equal(decodeWorld("a".repeat(10_001)), null);
});

test("untrusted shared data is bounded and malformed data is rejected", () => {
  assert.equal(sanitizeWorld({ seed: "", nodes: [] }), null);
  const sanitized = sanitizeWorld({
    seed: "safe",
    atmosphere: "invented",
    nodes: Array.from({ length: 40 }, (_, index) => ({
      id: `node-${index}`,
      x: 0.5,
      y: 0.5,
      note: 999,
      size: 999,
      phase: 0,
    })),
  });
  assert.equal(sanitized.atmosphere, "midnight");
  assert.equal(sanitized.nodes.length, MAX_NODES);
  assert.equal(sanitized.nodes[0].note, 48);
  assert.equal(sanitized.nodes[0].size, 1.5);
});
