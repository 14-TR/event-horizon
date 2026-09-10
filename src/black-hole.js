import * as THREE from 'three';
import { qualitySettings } from './black-hole-math.js';
import { fullscreenVertex, rayFragment, compositeFragment } from './black-hole-shaders.js';

/**
 * Camera-dependent world-space black-hole pass for Three.js WebGL2.
 * Owns only its internal resources, never your camera, scene or renderer.
 * `anchor`: fixed Object3D frame; local XZ is the disk, uniform scale = horizon.
 * Render BEFORE your 3D content using render(renderer, camera, time, scene).
 */
export class BlackHoleRenderer {
  constructor({ quality = 'desktop', horizonRadius = 1.15, exposure = 1.4, glow = 0.30 } = {}) {
    if (!Number.isFinite(horizonRadius) || horizonRadius <= 0) throw new RangeError('Horizon radius must be finite and positive');
    this.anchor = new THREE.Object3D();
    this.anchor.name = 'black-hole-world-frame';
    this.anchor.scale.setScalar(horizonRadius);
    this.viewport = { width: 1, height: 1, dpr: 1 };
    this.settings = qualitySettings(quality, 1, 1);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.target.texture.name = 'black-hole-radiance-and-signed-depth';
    this.uniforms = {
      uInverseProjection: { value: new THREE.Matrix4() },
      uProjection: { value: new THREE.Matrix4() },
      uCameraToHole: { value: new THREE.Matrix4() },
      uHoleToWorld: { value: new THREE.Matrix4() },
      uWorldScale: { value: horizonRadius },
      uTime: { value: 0 }, uStepScale: { value: this.settings.stepScale },
      uLensing: { value: 1 }, uStars: { value: 1 },
      uImage: { value: this.target.texture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: exposure }, uGlow: { value: glow },
    };
    this.rayMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: fullscreenVertex, fragmentShader: rayFragment,
      uniforms: this.uniforms, defines: { MAX_STEPS: this.settings.steps },
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: fullscreenVertex, fragmentShader: compositeFragment,
      uniforms: this.uniforms, depthTest: true, depthWrite: true, toneMapped: false,
    });
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.rayScene = new THREE.Scene();
    this.compositeScene = new THREE.Scene();
    for (const [scene, material] of [[this.rayScene, this.rayMaterial], [this.compositeScene, this.compositeMaterial]]) {
      const triangle = new THREE.Mesh(this.geometry, material);
      triangle.frustumCulled = false;
      scene.add(triangle);
    }
    this.passCamera = new THREE.Camera();
    this.inverseHole = new THREE.Matrix4();
    this.worldScale = new THREE.Vector3();
    this.savedScissor = new THREE.Vector4();
    this.pickPixel = new Uint16Array(4);
    this.pickProjection = new THREE.Vector3();
    this.pickOrigin = new THREE.Vector3();
  }

  resize(width, height, dpr = 1) {
    this.settings = qualitySettings(this.settings.name, width, height, dpr);
    this.viewport = { width, height, dpr };
    this.target.setSize(this.settings.width, this.settings.height);
    this.uniforms.uTexel.value.set(1 / this.settings.width, 1 / this.settings.height);
  }

  setQuality(name) {
    const { width, height, dpr } = this.viewport;
    this.settings = qualitySettings(name, width, height, dpr);
    this.rayMaterial.defines.MAX_STEPS = this.settings.steps;
    this.uniforms.uStepScale.value = this.settings.stepScale;
    this.rayMaterial.needsUpdate = true;
    this.resize(width, height, dpr);
  }

  update(camera, timeSeconds) {
    if (!camera.isPerspectiveCamera) throw new TypeError('Black-hole rays require a PerspectiveCamera');
    if (!Number.isFinite(timeSeconds)) throw new TypeError('Time must be finite');
    camera.updateWorldMatrix(true, false);
    this.anchor.updateWorldMatrix(true, false);
    this.worldScale.setFromMatrixScale(this.anchor.matrixWorld);
    const { x, y, z } = this.worldScale;
    if (x <= 0 || !Number.isFinite(x) || Math.abs(x - y) > x * 1e-5 || Math.abs(x - z) > x * 1e-5) {
      throw new RangeError('The hole frame and its parents require positive uniform scale');
    }
    this.inverseHole.copy(this.anchor.matrixWorld).invert();
    this.uniforms.uCameraToHole.value.multiplyMatrices(this.inverseHole, camera.matrixWorld);
    this.uniforms.uHoleToWorld.value.copy(this.anchor.matrixWorld);
    this.uniforms.uWorldScale.value = this.worldScale.x;
    this.uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.uProjection.value.copy(camera.projectionMatrix);
    this.uniforms.uTime.value = timeSeconds;
  }

  /** Full-frame replacement for renderer.render(scene, camera); preserves renderer state. */
  render(renderer, camera, timeSeconds, foregroundScene = null) {
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error('Black-hole pass requires WebGL2 EXT_color_buffer_float; retain a non-WebGL fallback.');
    }
    this.update(camera, timeSeconds);
    const target = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const scissorTest = renderer.getScissorTest();
    renderer.getScissor(this.savedScissor);
    try {
      renderer.autoClear = false;
      renderer.setScissorTest(false);
      renderer.setRenderTarget(this.target);
      // setRenderTarget applies its physical-pixel viewport. setViewport would apply DPR twice.
      renderer.render(this.rayScene, this.passCamera);
      renderer.setRenderTarget(target);
      renderer.clear(true, true, false);
      renderer.render(this.compositeScene, this.passCamera);
      if (foregroundScene) renderer.render(foregroundScene, camera);
    } finally {
      renderer.setRenderTarget(target);
      renderer.setScissor(this.savedScissor);
      renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
    }
  }

  /** Read the same signed ray-depth that occludes foreground geometry.
   * One bounded pixel read on picking/selected reticles; no full-frame readback.
   */
  isOccluded(renderer, camera, worldPosition) {
    const projected = this.pickProjection.copy(worldPosition).project(camera);
    if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) return true;
    const x = Math.min(this.target.width - 1, Math.max(0, Math.floor((projected.x * 0.5 + 0.5) * this.target.width)));
    const y = Math.min(this.target.height - 1, Math.max(0, Math.floor((projected.y * 0.5 + 0.5) * this.target.height)));
    this.pickPixel.fill(0x7e00); // NaN sentinel: failed readback must not silently pick hidden stars.
    renderer.readRenderTargetPixels(this.target, x, y, 1, 1, this.pickPixel);
    const depth = Math.abs(THREE.DataUtils.fromHalfFloat(this.pickPixel[3]));
    if (!Number.isFinite(depth)) throw new Error('Occlusion depth readback unavailable.');
    const distance = camera.getWorldPosition(this.pickOrigin).distanceTo(worldPosition);
    return depth < 59000 && distance > depth + Math.max(0.08, depth * 0.002);
  }

  dispose() {
    this.target.dispose();
    this.rayMaterial.dispose();
    this.compositeMaterial.dispose();
    this.geometry.dispose();
  }
}
