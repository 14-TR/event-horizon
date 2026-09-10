import { DISK, diskPosition } from './layout.js';

/** Art-directed stellar accretion, not gravity physics. Never mutates topology. */
export function createInfall(layout) {
  const sectors = new Map(layout.clusters.map(cluster => [cluster.id, { cluster, nodes: [] }]));
  for (const node of layout.nodes) sectors.get(node.cluster).nodes.push(node);
  return time => {
    for (const { cluster, nodes } of sectors.values()) {
      const center = [0, 0, 0];
      for (const node of nodes) {
        diskPosition(node.orbit, time, node.position);
        // Per-note phases keep the disk full while individual notes wrap outward.
        node.cycle = Math.floor(node.orbit.phase - time / DISK.period);
        for (let axis = 0; axis < 3; axis++) center[axis] += node.position[axis];
      }
      if (nodes.length) for (let axis = 0; axis < 3; axis++) cluster.center[axis] = center[axis] / nodes.length;
    }
  };
}
