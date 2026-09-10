/** Art-directed tidal loops, not gravity physics. IDs and edges never change. */
export function createInfall(layout) {
  const sectors = new Map(layout.clusters.map((cluster, index) => [cluster.id, {
    cluster, period: 42 + index * 4, nodes: [],
  }]));
  for (const node of layout.nodes) {
    sectors.get(node.cluster).nodes.push({ node, origin: [...node.position], radius: Math.hypot(...node.position) });
  }
  return time => {
    for (const { cluster, period, nodes } of sectors.values()) {
      const phase = ((time % period) + period) % period / period;
      const tilt = Math.sin(phase * Math.PI * 2) * 0.55;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      const center = [0, 0, 0];
      for (const { node, origin, radius } of nodes) {
        // Nearby notes stretch into a tidal stream; the inner turn speeds up.
        const shear = ((Number(node.id.slice(-3)) % 17) / 16 - 0.5) * Math.sin(phase * Math.PI) * 0.65;
        const angle = phase * 5.8 + phase * phase * 3.2 + shear;
        const scale = (radius * (1 - phase) + 2.1 * phase) / radius;
        const c = Math.cos(angle), s = Math.sin(angle);
        const x = (origin[0] * c - origin[1] * s) * scale;
        const y = (origin[0] * s + origin[1] * c) * scale;
        const z = origin[2] * scale;
        node.position[0] = x;
        node.position[1] = y * ct - z * st;
        node.position[2] = y * st + z * ct;
        for (let axis = 0; axis < 3; axis++) center[axis] += node.position[axis];
      }
      if (nodes.length) for (let axis = 0; axis < 3; axis++) cluster.center[axis] = center[axis] / nodes.length;
    }
  };
}
