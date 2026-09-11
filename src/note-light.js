import * as THREE from 'three';

// One bounded, flow-aligned emitting volume per actual note. The box is only a
// ray-integration bound: its faces never contribute light. No synthetic sources.
export function noteLightVertex(capture = false) {
  return /* glsl */ `
    attribute vec3 aPosition;
    attribute vec3 aEmission;
    attribute float aSize;
    uniform float uExtent;
    varying vec3 vLocal;
    varying vec3 vOrigin;
    varying vec3 vHalfSize;
    varying vec3 vEmission;
    varying float vSeed;
    varying float vHeight;
    varying float vCurve;
    varying float vWorldScale;
    void main() {
      // Source transforms are rigid/uniform, like the actual disk frame.
      // vOrigin remains in object units; ray depth is converted below.
      float radius = max(length(aPosition.xz), 0.1);
      vec3 radial = vec3(aPosition.x, 0.0, aPosition.z) / radius;
      vec3 tangent = vec3(-radial.z, 0.0, radial.x);
      mat3 basis = mat3(tangent, radial, vec3(0, 1, 0));
      vHalfSize = vec3(1.15 + aSize * 0.035, 0.48 + aSize * 0.012, 0.12 + aSize * 0.004);
      vLocal = position;
      vEmission = aEmission;
      vSeed = aSize * 13.61;
      vCurve = vHalfSize.x * vHalfSize.x / (2.0 * radius * vHalfSize.y);
      vec4 world = modelMatrix * vec4(aPosition + basis * (position * vHalfSize), 1.0);
      vHeight = (modelMatrix * vec4(aPosition, 1.0)).y;
      vWorldScale = length(modelMatrix[0].xyz);
      // Capture rays look down WORLD Y, including a transformed source parent.
      vec3 eye = ${capture ? '(inverse(modelMatrix) * vec4(world.xyz + vec3(0, 100, 0), 1.0)).xyz' : '(inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz'};
      vec3 delta = eye - aPosition;
      vOrigin = vec3(dot(delta, tangent), dot(delta, radial), delta.y) / vHalfSize;
      gl_Position = ${capture ? 'vec4(world.xz / uExtent, 0.0, 1.0)' : 'projectionMatrix * viewMatrix * world'};
    }
  `;
}

// Shared direct/capture transfer, evaluated in the source's co-moving frame.
// Domain-warped finite wisps, not periodic global rings or independent gas noise.
export const noteLightProfile = /* glsl */ `
  float grain(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1, 0), vec2(127.1, 311.7)),
      dot(i + vec2(0, 1), vec2(127.1, 311.7)), dot(i + vec2(1), vec2(127.1, 311.7)))) * 43758.5453);
    return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
  }
  float noteStructure(vec3 p, float seed) {
    float warp = grain(vec2(p.x * 2.1, p.y * 3.0) + seed) - 0.5;
    float filament = grain(vec2(p.x * 2.7, p.y * 17.0 + warp * 3.5) + seed);
    float torn = grain(vec2(p.x * 6.0, p.y * 9.0) - seed);
    return (0.24 + filament * filament * 1.6) * (0.65 + torn * 0.65);
  }
  float columnIntegral(float t) {
    float t2 = t * t;
    return t * (1.0 - (2.0 / 3.0) * t2 + 0.2 * t2 * t2);
  }
  vec3 noteEmission(vec3 origin, vec3 end, vec3 halfSize, vec3 color, float seed, float curve, float limit) {
    vec3 direction = normalize((end - origin) * halfSize) / halfSize;
    float a = dot(direction, direction);
    float closest = -dot(origin, direction) / a;
    vec3 peak = origin + direction * closest;
    // Bend the finite source column along the disk flow. Turbulence is sampled
    // at its closest point, not marched eight times through nearly equal wisps.
    // This is a column-filtered volume approximation, not full volume transport.
    origin.y += peak.x * peak.x * curve;
    closest = -dot(origin, direction) / a;
    peak = origin + direction * closest;
    float support = 1.0 - dot(peak, peak);
    if (support <= 0.0) return vec3(0);
    float halfLength = sqrt(support / a);
    float enter = max(-1.0, -closest / halfLength);
    float leave = min(1.0, (limit - closest) / halfLength);
    if (leave <= enter) return vec3(0);
    // Exact integral of the compact (1-r²)² kernel, clipped by ray depth. A
    // finite polynomial column has smooth edges and no box-face contribution.
    float light = support * support * halfLength * (columnIntegral(leave) - columnIntegral(enter));
    return color * noteStructure(peak, seed) * light * 0.15 / (2.0 * halfSize.z);
  }
`;

export function noteLightMaterial(capture = false, extent = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uExtent: { value: extent }, uRayDepth: { value: null },
      uOcclusion: { value: 0 }, uViewport: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: noteLightVertex(capture),
    fragmentShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vOrigin;
      varying vec3 vHalfSize;
      varying vec3 vEmission;
      varying float vSeed;
      varying float vHeight;
      varying float vCurve;
      varying float vWorldScale;
      uniform sampler2D uRayDepth;
      uniform float uOcclusion;
      uniform vec2 uViewport;
      ${noteLightProfile}
      void main() {
        // Clip the integration interval, not the raster box's back face. This
        // preserves foreground emission and removes triangular shadow cutouts.
        float limit = 60000.0;
        ${capture ? '' : 'if (uOcclusion > 0.0) limit = abs(texture2D(uRayDepth, gl_FragCoord.xy / uViewport).a) / vWorldScale;'}
        vec3 emission = noteEmission(vOrigin, vLocal, vHalfSize, vEmission, vSeed, vCurve, limit);
        // Direct screen accumulation composes exponential exposures without
        // clipping the overlapping inner body. Capture remains additive HDR.
        ${capture ? '' : 'emission = 1.0 - exp(-emission * 1.35);'}
        gl_FragColor = vec4(emission, ${capture ? 'dot(emission, vec3(0.2126, 0.7152, 0.0722)) * vHeight' : '1.0'});
      }
    `,
    transparent: true, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: capture ? THREE.OneFactor : THREE.OneMinusSrcColorFactor,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

/** A bounded screen-light image, borrowing every actual volume unchanged. */
export class NoteLightPass {
  constructor(sources) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.target.texture.name = 'actual-note-direct-volume-light';
    this.scene = new THREE.Scene();
    this.entries = sources.map(source => {
      const image = new THREE.Mesh(source.geometry, source.material);
      image.frustumCulled = false;
      image.matrixAutoUpdate = false;
      image.raycast = () => {};
      this.scene.add(image);
      return { source, image };
    });
  }

  resize(width, height) {
    this.target.setSize(width, height);
    for (const { image } of this.entries) image.material.uniforms.uViewport.value.set(width, height);
  }

  render(renderer, camera) {
    // Borrow live geometry/materials, but never source IDs or picking. Updating
    // before renderer.render also reaches the next paused frame's GPU upload.
    for (const { source, image } of this.entries) {
      source.onBeforeRender();
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
      renderer.setClearColor(0, 0);
      renderer.clear(true, false, false);
      renderer.render(this.scene, camera);
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
  }
}

/** One noninteractive light envelope per actual source; never another node. */
export function createNoteLight(points) {
  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(2, 2, 2));
  geometry.instanceCount = points.geometry.attributes.position.count;
  const bindings = [['aPosition', 'position'], ['aEmission', 'aColor'], ['aSize', 'aSize']].map(([name, sourceName]) => {
    const source = points.geometry.attributes[sourceName];
    const attribute = new THREE.InstancedBufferAttribute(source.array, source.itemSize).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return { source, attribute, version: -1 };
  });
  const mesh = new THREE.Mesh(geometry, noteLightMaterial());
  mesh.name = 'actual-note-emission';
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.onBeforeRender = () => {
    for (const binding of bindings) if (binding.version !== binding.source.version) {
      binding.attribute.needsUpdate = true;
      binding.version = binding.source.version;
    }
  };
  return mesh;
}
