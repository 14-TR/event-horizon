export const SECTOR_COLORS = ['#8bded0', '#b8a2f5', '#f39e82', '#8dbbea', '#d7c486', '#cf99bb', '#a8c89e', '#80c5ce'];

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Artistic orbital coordinates, never physical or semantic distances. */
export function buildLayout(graph) {
  // Give the largest populations unobstructed top/bottom slots in the home view.
  const ranked = [...graph.clusters].sort((a, b) => b.count - a.count || a.id - b.id);
  const rank = new Map(ranked.map((cluster, index) => [cluster.id, index]));
  const showcaseAngles = [1.12, 4.55, 0.32, 2.70, 3.40, 5.70, 2.12, 4.00];
  const clusters = graph.clusters.map((cluster, index) => {
    const slot = rank.get(cluster.id);
    const angle = graph.clusters.length <= 8 ? showcaseAngles[slot] : (index / graph.clusters.length) * Math.PI * 2 + 0.32;
    const ring = (slot === 1 ? 16.5 : 17.5) + Math.floor(index / 12) * 2.8;
    return {
      ...cluster,
      color: SECTOR_COLORS[index % SECTOR_COLORS.length],
      center: [Math.cos(angle) * ring, Math.sin(angle) * ring * 0.78, Math.sin(angle * 3) * 2.2],
    };
  });
  const byCluster = new Map(clusters.map(cluster => [cluster.id, cluster]));
  const nodes = graph.nodes.map(node => {
    const rnd = random(Number(node.id.slice(1)) + 713);
    const angle = rnd() * Math.PI * 2;
    const vertical = rnd() * 2 - 1;
    const radius = Math.cbrt(rnd()) * 2.25;
    const horizontal = Math.sqrt(1 - vertical * vertical);
    const cluster = byCluster.get(node.cluster);
    if (cluster.count === 1) return { ...node, color: cluster.color, position: [...cluster.center] };
    return {
      ...node,
      color: cluster.color,
      position: [
        cluster.center[0] + Math.cos(angle) * horizontal * radius * 1.32,
        cluster.center[1] + vertical * radius,
        cluster.center[2] + Math.sin(angle) * horizontal * radius,
      ],
    };
  });
  return { nodes, clusters };
}
