/** Synthetic test topology only. Never served as public/graph.json. */
export function makeFixture({ sectors = 6, perSector = 72 } = {}) {
  const nodes = [];
  const edges = [];
  const id = index => `n${String(index + 1).padStart(6, '0')}`;
  for (let cluster = 0; cluster < sectors; cluster++) {
    for (let j = 0; j < perSector; j++) {
      const index = cluster * perSector + j;
      nodes.push({ id: id(index), cluster });
      if (j) edges.push([id(index - 1), id(index)]);
      if (j > 3 && j % 3 === 0) edges.push([id(index - 3), id(index)]);
    }
    if (cluster) edges.push([id(cluster * perSector), id(0)]);
  }
  return {
    version: 1, nodes, edges,
    clusters: Array.from({ length: sectors }, (_, cluster) => ({ id: cluster, label: 'PRIVATE_NOT_A_SECTOR', count: perSector })),
    meta: { source: 'anonymized-vault-topology', notes: nodes.length, links: edges.length, clusters: sectors },
  };
}
