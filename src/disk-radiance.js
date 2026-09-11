import * as THREE from 'three';
import { DISK } from './layout.js';
import { stellarLight } from './shaders.js';
import { noteLightMaterial } from './note-light.js';

export const DISK_IMAGE_SIZES = Object.freeze({ mobile: 512, desktop: 768, cinematic: 1024 });
const extent = DISK.outer + 0.7; // Includes sprite footprints and bounded trail ends.
const flatPosition = /* glsl */ `
  vec4 world = modelMatrix * vec4(position, 1.0);
  gl_Position = vec4(world.xz / uExtent, 0.0, 1.0);
  vHeight = world.y;
`;

/** A linear-HDR exposure of the ACTUAL point/trail buffers onto world XZ.
 * Borrowed geometry stays live; copies are light only, never graph/picking objects.
 * Alpha stores emission-weighted actual height for a shallow-disk correction.
 * A single mean height and finite sprite footprints remain approximations.
 */
export class DiskRadiance {
  constructor(points, trailSource, quality = 'desktop', envelopes = []) {
    const size = DISK_IMAGE_SIZES[quality];
    if (!size) throw new RangeError(`Unknown disk image quality: ${quality}`);
    this.extent = extent;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, depthBuffer: false, stencilBuffer: false,
    });
    this.target.texture.name = 'actual-note-disk-radiance';
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: { uExtent: { value: extent }, uResolution: { value: size }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute vec3 aColor;
        uniform float uExtent;
        uniform float uResolution;
        varying vec3 vColor;
        varying float vHeight;
        void main() {
          vColor = aColor;
          gl_PointSize = max(1.0, aSize * 0.035 * uResolution / (2.0 * uExtent));
          ${flatPosition}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vHeight;
        ${stellarLight}
        void main() {
          vec4 light = stellarLight(gl_PointCoord, vColor, uOpacity);
          vec3 emission = light.rgb * light.a;
          gl_FragColor = vec4(emission, dot(emission, vec3(0.2126, 0.7152, 0.0722)) * vHeight);
        }
      `,
      transparent: true, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: { uExtent: { value: extent }, uOpacity: { value: trailSource.material.opacity } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        uniform float uExtent;
        varying vec3 vColor;
        varying float vHeight;
        void main() { vColor = color; ${flatPosition} }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vHeight;
        void main() {
          vec3 emission = vColor * uOpacity;
          gl_FragColor = vec4(emission, dot(emission, vec3(0.2126, 0.7152, 0.0722)) * vHeight);
        }
      `,
      transparent: true, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.entries = points.map(source => {
      const image = new THREE.Points(source.geometry, this.pointMaterial);
      image.frustumCulled = false;
      image.matrixAutoUpdate = false;
      image.raycast = () => {}; // An exposure is not a second anonymous node.
      this.scene.add(image);
      return { source, image };
    });
    this.noteCount = points.reduce((sum, source) => sum + source.geometry.attributes.position.count, 0);
    this.envelopeMaterial = noteLightMaterial(true, extent);
    this.envelopes = envelopes.map(source => {
      const image = new THREE.Mesh(source.geometry, this.envelopeMaterial);
      image.frustumCulled = false;
      image.matrixAutoUpdate = false;
      image.raycast = () => {};

      this.scene.add(image);
      return { source, image };
    });
    this.trailSource = trailSource;
    this.trailImage = new THREE.LineSegments(trailSource.geometry, this.trailMaterial);
    this.trailImage.frustumCulled = false;
    this.trailImage.matrixAutoUpdate = false;
    this.trailImage.raycast = () => {};
    this.scene.add(this.trailImage);
  }

  render(renderer) {
    // Three uploads attributes while building its render list, BEFORE calling
    // mesh.onBeforeRender. Synchronize here so a paused source edit reaches the
    // very next capture, rather than showing stale color/height for one frame.
    for (const { source } of this.envelopes) source.onBeforeRender();
    // Honor isolation/visibility, including ancestors, without moving live objects.
    for (const { source, image } of [...this.entries, ...this.envelopes, { source: this.trailSource, image: this.trailImage }]) {
      source.updateWorldMatrix(true, false);
      image.matrix.copy(source.matrixWorld);
      image.visible = true;
      for (let parent = source; parent; parent = parent.parent) image.visible &&= parent.visible;
    }
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    const color = renderer.getClearColor(new THREE.Color()).clone(), alpha = renderer.getClearAlpha();
    const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
    try {
      renderer.autoClear = false;
      renderer.setScissorTest(false);
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(target);
      renderer.setClearColor(color, alpha);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
    }
  }

  dispose() {
    this.target.dispose();
    this.pointMaterial.dispose();
    this.trailMaterial.dispose();
    this.envelopeMaterial.dispose();
  }
}
