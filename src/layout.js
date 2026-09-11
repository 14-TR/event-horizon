export const SECTOR_COLORS = ['#b2d6cf', '#f6e2c6', '#c3b6dc', '#dba276', '#d4d4ad', '#d7afb7', '#a5bed4', '#b6ccbf'];
export const DISK = Object.freeze({ inner: 3.65, outer: 11.8, thickness: 0.48, turns: 7.4, rotation: 0.075, period: 96 });

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** One artistic disk coordinate for each real note. Never a semantic distance. */
export function diskPosition(orbit, time = 0, target = [0, 0, 0]) {
  const phase = ((orbit.phase - time / DISK.period) % 1 + 1) % 1;
  // Longer residence at small radii concentrates real notes, not a gas overlay.
  // Finite radial slope avoids an artificial density spike at the inner rim.
  const r = DISK.inner + (DISK.outer - DISK.inner) * (0.24 * phase + 0.76 * Math.pow(phase, 4));
  const bend = 0.22 * Math.sin(phase * 9.1 + orbit.flow) + 0.12 * Math.sin(phase * 17.3 - orbit.flow);
  const angle = orbit.angle + DISK.turns * Math.pow(phase, 0.72) + bend - time * DISK.rotation;
  target[0] = Math.cos(angle) * r;
  target[2] = Math.sin(angle) * r;
  // A shallow warp plus independent vertical spread: a volume, not a billboard.
  target[1] = orbit.height * (0.35 + 0.65 * phase) + Math.sin(angle * 1.7 + phase * 3.4) * 0.15 * (0.3 + 0.7 * phase);
  return target;
}

export function buildLayout(graph) {
  const ranked = [...graph.clusters].sort((a, b) => b.count - a.count || a.id - b.id);
  const rank = new Map(ranked.map((cluster, index) => [cluster.id, index]));
  const clusters = graph.clusters.map((cluster, index) => ({
    ...cluster, color: SECTOR_COLORS[index % SECTOR_COLORS.length], center: [0, 0, 0],
  }));
  const buckets = new Map(clusters.map(cluster => [cluster.id, []]));
  for (const node of graph.nodes) buckets.get(node.cluster).push(node);
  const orbits = new Map();
  for (const cluster of clusters) {
    const nodes = buckets.get(cluster.id).sort((a, b) => a.id.localeCompare(b.id));
    const base = 0.5 + rank.get(cluster.id) * 2.39996322973;
    nodes.forEach((node, index) => {
      const rnd = random(Number(node.id.slice(1)) + 713);
      orbits.set(node.id, {
        phase: (index + 0.25 + rnd() * 0.5) / nodes.length,
        // One coherent, irregular stream per sector, not three equally spaced
        // rails or azimuthally scattered beads. Cross-sections remain broad.
        flow: base,
        angle: base + (rnd() + rnd() - 1) * 1.1,
        height: (rnd() + rnd() - 1) * DISK.thickness,
      });
    });
  }
  const byCluster = new Map(clusters.map(cluster => [cluster.id, cluster]));
  const nodes = graph.nodes.map(node => {
    const orbit = orbits.get(node.id), cluster = byCluster.get(node.cluster);
    const position = diskPosition(orbit);
    for (let axis = 0; axis < 3; axis++) cluster.center[axis] += position[axis] / cluster.count;
    return { ...node, color: cluster.color, orbit, position };
  });
  return { nodes, clusters };
}
