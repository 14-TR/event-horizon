import { parseGraph } from '../src/graph.js';

// Expectations use the same anonymous schema as the app, never supplied counts.
export function validateTopology(raw) {
  const graph = parseGraph(raw);
  if (!graph.nodes.length) throw new Error('Acceptance requires a nonempty topology.');
  return graph;
}

// Spatial cross-sector probes require a genuine edge, not a remembered ID pair.
export function connectedPair(graph) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const adjacency = new Map(graph.nodes.map(node => [node.id, new Set()]));
  for (const [a, b] of graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const ranked = [...graph.nodes].sort((a, b) => adjacency.get(b.id).size - adjacency.get(a.id).size || a.id.localeCompare(b.id));
  for (const node of ranked) {
    const neighborId = [...adjacency.get(node.id)].sort().find(id => byId.get(id).cluster !== node.cluster);
    if (neighborId) return { id: node.id, neighborId };
  }
  throw new Error('This spatial probe requires a real cross-sector connection.');
}
