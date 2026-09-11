const PAGE_SIZE = 6;

/** Submitted overlay edges are distinct from real degree and visible pixels. */
export function connectionPreview(context) {
  const { displayed, total } = context || {};
  if (!Number.isSafeInteger(displayed) || !Number.isSafeInteger(total) || displayed < 0 || total < displayed) return '';
  const format = value => new Intl.NumberFormat('en-US').format(value);
  return `${format(displayed)} of ${format(total)} connections drawn in space.`;
}

/** Anonymous, edge-derived navigation. No source metadata or persistent history. */
export function createExploration(graph) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const adjacency = new Map(graph.nodes.map(node => [node.id, new Set()]));
  for (const [a, b] of graph.edges) {
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  const home = () => ({ clusterId: null, nodeId: null, page: 0, filter: 'all' });
  const history = [];
  let current = home();
  function visit({ clusterId = null, nodeId = null }) {
    const node = nodes.get(nodeId);
    if (nodeId !== null && !node) return false;
    if (node) clusterId = node.cluster;
    if (clusterId !== null && !graph.clusters.some(cluster => cluster.id === clusterId)) return false;
    if (current.clusterId === clusterId && current.nodeId === nodeId) return true;
    history.push({ ...current });
    current = { clusterId, nodeId, page: 0, filter: 'all' };
    return true;
  }
  function neighbors() {
    const all = [...(adjacency.get(current.nodeId) || [])].map(id => nodes.get(id))
      .sort((a, b) => a.cluster - b.cluster || a.id.localeCompare(b.id));
    const within = all.filter(node => node.cluster === current.clusterId).length;
    const filtered = all.filter(node => current.filter === 'all' || (node.cluster === current.clusterId) === (current.filter === 'within'));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = Math.max(0, Math.min(current.page, pages - 1));
    return {
      items: filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
      total: all.length, within, cross: all.length - within, filtered: filtered.length, pages, page,
      start: filtered.length ? page * PAGE_SIZE + 1 : 0, end: Math.min((page + 1) * PAGE_SIZE, filtered.length),
    };
  }
  return {
    get current() { return { ...current }; },
    get previous() { return history.length ? { ...history.at(-1) } : null; },
    visit,
    follow(id) { return adjacency.get(current.nodeId)?.has(id) ? visit({ nodeId: id }) : false; },
    back() { if (!history.length) return false; current = history.pop(); return true; },
    reset() { history.length = 0; current = home(); },
    setPage(page) { current.page = Number.isFinite(page) ? Math.trunc(page) : 0; current.page = neighbors().page; },
    setFilter(filter) { current.filter = ['all', 'within', 'cross'].includes(filter) ? filter : 'all'; current.page = 0; },
    neighbors,
  };
}
