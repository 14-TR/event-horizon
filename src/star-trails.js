import * as THREE from 'three';
import { infallPeriod } from './motion.js';

export const TRAIL_BUDGETS = Object.freeze({ mobile: 96, desktop: 320, cinematic: 512 });
const SEGMENTS = 4;
const SAMPLE_INTERVAL = 0.055;

/** Short world-space histories of existing nodes, never synthetic particles. */
export class StarTrails {
  constructor(layout, quality = 'desktop') {
    const budget = TRAIL_BUDGETS[quality];
    if (!budget) throw new RangeError(`Unknown trail quality: ${quality}`);
    const count = Math.min(budget, layout.nodes.length);
    const colors = new Map(layout.clusters.map(cluster => [cluster.id, new THREE.Color(cluster.color)]));
    const periods = new Map(layout.clusters.map((cluster, index) => [cluster.id, infallPeriod(index)]));
    this.entries = Array.from({ length: count }, (_, index) => {
      const node = layout.nodes[Math.floor(index * layout.nodes.length / count)];
      return { node, color: colors.get(node.cluster), period: periods.get(node.cluster), history: [] };
    });
    this.maxLength = quality === 'mobile' ? 0.85 : 1.3;
    this.selectedCluster = null;
    this.lastSample = -Infinity;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'color']) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * SEGMENTS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false }));
    this.mesh.name = 'actual-note-trails';
    this.mesh.frustumCulled = false;
  }

  update(time) {
    if (time === this.time) return;
    if (time < this.time || time - this.time > 0.5) this.reset();
    this.time = time;
    const sample = time - this.lastSample >= SAMPLE_INTERVAL;
    for (const entry of this.entries) {
      const cycle = Math.floor(time / entry.period);
      if (entry.cycle !== cycle) {
        entry.history = [[...entry.node.position]];
        entry.cycle = cycle;
      } else if (sample) {
        entry.history.unshift([...entry.node.position]);
        entry.history.length = Math.min(entry.history.length, SEGMENTS);
      }
    }
    if (sample) this.lastSample = time;
    this.draw();
  }

  reset() {
    for (const entry of this.entries) { entry.history = []; entry.cycle = undefined; }
    this.time = undefined;
    this.lastSample = -Infinity;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  draw() {
    const { position, color } = this.mesh.geometry.attributes;
    let vertex = 0;
    for (const entry of this.entries) {
      if (this.selectedCluster !== null && entry.node.cluster !== this.selectedCluster) continue;
      let from = entry.node.position, length = 0;
      for (const [index, to] of entry.history.entries()) {
        const distance = Math.hypot(...to.map((value, axis) => value - from[axis]));
        length += distance;
        if (length > this.maxLength) break;
        if (distance > 0.00001) {
          for (const [end, point] of [from, to].entries()) {
            position.setXYZ(vertex, ...point);
            const fade = Math.pow(1 - (index + end) / (SEGMENTS + 1), 1.7);
            color.setXYZ(vertex++, entry.color.r * fade, entry.color.g * fade, entry.color.b * fade);
          }
        }
        from = to;
      }
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, vertex);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
