import * as THREE from 'three';

// The same finite, curved note-light footprint is drawn directly and captured.
// It is an artistic emission envelope, not gas particles or an orbital history.
export function noteLightVertex(capture = false) {
  return /* glsl */ `
    attribute vec3 aPosition;
    attribute vec3 aEmission;
    attribute float aSize;
    uniform float uExtent;
    varying vec2 vLocal;
    varying vec3 vEmission;
    varying float vSeed;
    varying float vHeight;
    void main() {
      vLocal = uv * 2.0 - 1.0;
      vEmission = aEmission;
      vSeed = aSize * 13.61;
      float radius = length(aPosition.xz);
      float angle = atan(aPosition.z, aPosition.x);
      float along = 0.65 + aSize * 0.035;
      float across = 0.38 + aSize * 0.012;
      float azimuth = angle + vLocal.x * along / max(radius, 0.1);
      float r = radius + vLocal.y * across;
      vec4 world = modelMatrix * vec4(cos(azimuth) * r, aPosition.y, sin(azimuth) * r, 1.0);
      vHeight = world.y;
      gl_Position = ${capture ? 'vec4(world.xz / uExtent, 0.0, 1.0)' : 'projectionMatrix * viewMatrix * world'};
    }
  `;
}

export const noteLightProfile = /* glsl */ `
  float grain(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1, 0), vec2(127.1, 311.7)),
      dot(i + vec2(0, 1), vec2(127.1, 311.7)), dot(i + vec2(1), vec2(127.1, 311.7)))) * 43758.5453);
    return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
  }
  vec3 noteEmission(vec2 local, vec3 color, float seed) {
    float edge = (1.0 - smoothstep(0.7, 1.0, abs(local.x))) * (1.0 - smoothstep(0.65, 1.0, abs(local.y)));
    float kernel = exp(-local.x * local.x * 2.8 - local.y * local.y * 4.5) * edge;
    float structure = 0.55 + 0.6 * grain(vec2(local.x * 3.5, local.y * 14.0) + seed);
    return color * kernel * structure * 0.08;
  }
`;

export function noteLightMaterial(capture = false, extent = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uExtent: { value: extent } },
    vertexShader: noteLightVertex(capture),
    fragmentShader: /* glsl */ `
      varying vec2 vLocal;
      varying vec3 vEmission;
      varying float vSeed;
      varying float vHeight;
      ${noteLightProfile}
      void main() {
        vec3 emission = noteEmission(vLocal, vEmission, vSeed);
        gl_FragColor = vec4(emission, ${capture ? 'dot(emission, vec3(0.2126, 0.7152, 0.0722)) * vHeight' : '1.0'});
      }
    `,
    transparent: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    depthTest: !capture, depthWrite: false, toneMapped: false,
  });
}

/** One noninteractive light envelope per actual source; never another node. */
export function createNoteLight(points) {
  const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2, 6, 1));
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
