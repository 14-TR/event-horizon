import * as THREE from 'three';
import { DISK, diskPosition } from './layout.js';

// Detail per actual node, never a sampled subset of stars.
export const TRAIL_BUDGETS = Object.freeze({ mobile: 3, desktop: 5, cinematic: 7 });
const EXPOSURE_SECONDS = 0.85;

/** Bounded orbital exposures evaluated from the same actual-note trajectories.
 * Analytic history makes a reduced-motion opening equally complete and luminous.
 */
export class StarTrails {
  constructor(layout, quality = 'desktop') {
    this.segments = TRAIL_BUDGETS[quality];
    if (!this.segments) throw new RangeError(`Unknown trail quality: ${quality}`);
    const colors = new Map(layout.clusters.map(cluster => [cluster.id, new THREE.Color(cluster.color)]));
    this.entries = layout.nodes.map(node => ({
      node, color: colors.get(node.cluster), history: [],
      samples: Array.from({ length: this.segments }, () => [0, 0, 0]),
    }));
    this.maxLength = quality === 'mobile' ? 1.2 : 1.5;
    this.selectedCluster = null;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'color']) geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(layout.nodes.length * this.segments * 6), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false }));
    this.mesh.name = 'actual-note-trails';
    this.mesh.frustumCulled = false;
  }

  update(time) {
    if (time === this.time) return;
    this.time = time;
    const { position, color } = this.mesh.geometry.attributes;
    let vertex = 0;
    for (const entry of this.entries) {
      entry.history.length = 0;
      if (this.selectedCluster !== null && entry.node.cluster !== this.selectedCluster) continue;
      const { orbit } = entry.node;
      const cycle = Math.floor(orbit.phase - time / DISK.period);
      let from = entry.node.position, length = 0;
      for (let index = 0; index < this.segments; index++) {
        const prior = time - (index + 1) * EXPOSURE_SECONDS / this.segments;
        if (Math.floor(orbit.phase - prior / DISK.period) !== cycle) break;
        const to = diskPosition(orbit, prior, entry.samples[index]);
        length += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
        if (length > this.maxLength) break;
        entry.history.push(to);
        for (let end = 0; end < 2; end++) {
          position.setXYZ(vertex, ...(end ? to : from));
          const fade = Math.pow(1 - (index + end) / this.segments, 1.5);
          color.setXYZ(vertex++, entry.color.r * fade, entry.color.g * fade, entry.color.b * fade);
        }
        from = to;
      }
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, vertex);
  }

  reset() {
    for (const entry of this.entries) entry.history.length = 0;
    this.time = undefined;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
