import * as THREE from 'three';

const KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', KeyQ: 'down', KeyE: 'up' };

/** Deliberate, inertialess camera flight. Pausing the sky does not lock navigation. */
export class FlightControls {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.enabled = false;
    this.keys = new Set();
    this.thrust = new Set();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.look = null;
    this.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
    this.direction = new THREE.Vector3();
    const blocked = target => target?.closest?.('input, select, textarea, [contenteditable="true"], dialog') || document.querySelector('dialog[open]');
    window.addEventListener('keydown', event => {
      if (!this.enabled || blocked(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (KEYS[event.code]) { event.preventDefault(); this.keys.add(event.code); }
    }, { signal });
    window.addEventListener('keyup', event => this.keys.delete(event.code), { signal });
    window.addEventListener('blur', () => this.clear(), { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, { signal });
    canvas.addEventListener('pointerdown', event => {
      if (!this.enabled || this.look || event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      this.look = { id: event.pointerId, x: event.clientX, y: event.clientY };
      this.rotation.setFromQuaternion(camera.quaternion, 'YXZ');
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      if (!this.enabled || this.look?.id !== event.pointerId) return;
      this.rotation.y -= (event.clientX - this.look.x) * 0.003;
      this.rotation.x = THREE.MathUtils.clamp(this.rotation.x - (event.clientY - this.look.y) * 0.003, -Math.PI * 0.49, Math.PI * 0.49);
      camera.quaternion.setFromEuler(this.rotation);
      this.look.x = event.clientX;
      this.look.y = event.clientY;
    }, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(type, event => { if (this.look?.id === event.pointerId) this.look = null; }, { signal });
    }
  }

  clear() {
    this.keys.clear();
    this.thrust.clear();
    this.look = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.clear();
  }

  update(delta) {
    if (!this.enabled || document.hidden || document.querySelector('dialog[open]')) { this.clear(); return; }
    const active = direction => this.thrust.has(direction) || [...this.keys].some(key => KEYS[key] === direction);
    const x = Number(active('right')) - Number(active('left'));
    const y = Number(active('up')) - Number(active('down'));
    const z = Number(active('back')) - Number(active('forward'));
    this.direction.set(x, 0, z).applyQuaternion(this.camera.quaternion);
    this.direction.y += y;
    if (this.direction.lengthSq()) this.camera.position.addScaledVector(this.direction.normalize(), Math.min(delta, 0.05) * 12);
    // Bounded space keeps the starfield in range; the horizon itself is navigable around, not through.
    if (this.camera.position.length() > 100) this.camera.position.setLength(100);
    if (this.camera.position.length() < 4) this.camera.position.setLength(4);
  }

  dispose() {
    this.clear();
    this.abort.abort();
  }
}
