import * as THREE from 'three';

export const CONNECTION_LIMIT = 12;

/** One transient draw of real incident relationships; never a light source. */
export class SelectedConnections {
  constructor(graph, layout) {
    this.nodes = new Map(layout.nodes.map(node => [node.id, node]));
    this.adjacency = new Map(layout.nodes.map(node => [node.id, new Set()]));
    for (const [a, b] of graph.edges) {
      this.adjacency.get(a)?.add(b);
      this.adjacency.get(b)?.add(a);
    }
    this.neighbors = [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CONNECTION_LIMIT * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CONNECTION_LIMIT * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.48, depthWrite: false, toneMapped: false }));
    this.line.name = 'selected-real-connections';
    this.line.visible = false;
    this.line.raycast = () => {}; // Noninteractive context, not a new graph population.
  }

  select(id, neighborId = null) {
    const node = this.nodes.get(id), adjacent = this.adjacency.get(id);
    this.node = node || null;
    this.neighbors = [];
    if (node) {
      const all = [...adjacent].sort();
      // Interleave within/cross-sector context, spread across each set rather
      // than truncating away all distant sectors or only showing low IDs.
      const within = all.filter(id => this.nodes.get(id)?.cluster === node.cluster);
      const cross = all.filter(id => this.nodes.get(id)?.cluster !== node.cluster);
      if (adjacent.has(neighborId)) this.neighbors.push(this.nodes.get(neighborId));
      for (let slot = 0; slot < CONNECTION_LIMIT && this.neighbors.length < Math.min(CONNECTION_LIMIT, all.length); slot++) {
        for (const bucket of [cross, within]) {
          if (!bucket.length) continue;
          const index = Math.floor(slot * bucket.length / Math.min(CONNECTION_LIMIT, bucket.length));
          const candidate = this.nodes.get(bucket[index]);
          if (candidate && !this.neighbors.includes(candidate) && this.neighbors.length < CONNECTION_LIMIT) this.neighbors.push(candidate);
        }
      }
      for (const id of all) {
        if (this.neighbors.length >= CONNECTION_LIMIT) break;
        const candidate = this.nodes.get(id);
        if (!this.neighbors.includes(candidate)) this.neighbors.push(candidate);
      }
    }
    const colors = this.line.geometry.attributes.color;
    this.neighbors.forEach((neighbor, index) => {
      const color = new THREE.Color(neighbor.id === neighborId ? '#ffe4ae' : neighbor.color).multiplyScalar(neighbor.id === neighborId ? 1.5 : 0.35);
      colors.setXYZ(index * 2, color.r, color.g, color.b);
      colors.setXYZ(index * 2 + 1, color.r, color.g, color.b);
    });
    colors.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.neighbors.length * 2);
    this.line.visible = this.neighbors.length > 0;
    this.update();
    return { id: node?.id ?? null, neighborId: adjacent?.has(neighborId) ? neighborId : null, rendered: this.neighbors.length, total: adjacent?.size ?? 0 };
  }

  update() {
    if (!this.node || !this.neighbors.length) return;
    const positions = this.line.geometry.attributes.position;
    this.neighbors.forEach((neighbor, index) => {
      positions.setXYZ(index * 2, ...this.node.position);
      positions.setXYZ(index * 2 + 1, ...neighbor.position);
    });
    positions.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }
}
