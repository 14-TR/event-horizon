// A stylized, procedural lens image. This is not a relativity simulation.
export const blackHoleVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const blackHoleFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uInclination;
  uniform float uRoll;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0, amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p + 8.2;
      amplitude *= 0.5;
    }
    return value;
  }
  vec3 fire(float intensity, float heat) {
    vec3 amber = vec3(1.0, 0.25, 0.035);
    vec3 gold = vec3(1.0, 0.68, 0.29);
    vec3 white = vec3(1.0, 0.92, 0.72);
    return mix(mix(amber, gold, clamp(heat, 0.0, 1.0)), white,
      smoothstep(0.8, 2.5, intensity)) * intensity;
  }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(30.0, 20.0);
    float cs = cos(uRoll), sn = sin(uRoll);
    p = mat2(cs, -sn, sn, cs) * p;
    float r = length(p);
    float angle = atan(p.y, p.x);
    float time = uTime * 0.08;
    float diskR = length(vec2(p.x, p.y / uInclination));
    float diskAngle = atan(p.y / uInclination, p.x);
    float turbulence = fbm(vec2(diskR * 2.1, diskAngle * 4.0 - time));
    float bands = 0.77 + 0.23 * sin(diskR * 24.0 + turbulence * 11.0);
    float fine = 0.93 + 0.07 * sin(diskR * 73.0 - turbulence * 16.0);
    float diskMask = smoothstep(3.0, 3.6, diskR) * (1.0 - smoothstep(8.4, 12.2, diskR));
    float doppler = 0.67 + 0.65 * (1.0 - smoothstep(-8.0, 8.0, p.x));
    float disk = diskMask * pow(4.0 / max(diskR, 4.0), 1.4)
      * (0.5 + turbulence * 1.2) * bands * fine * doppler * 1.9;

    // The back of the disk is drawn up around the shadow by the lens.
    float upper = smoothstep(-0.4, 1.5, p.y);
    float lensNoise = fbm(vec2(angle * 8.0 - time, r * 4.8));
    float lensBands = 0.78 + 0.22 * sin(r * 62.0 + lensNoise * 12.0);
    float arcWidth = mix(0.13, 0.52, upper);
    float arc = exp(-pow((r - 3.43) / arcWidth, 2.0)) * lensBands
      * (0.55 + lensNoise) * mix(0.52, 1.8, upper) * doppler;
    float photon = exp(-abs(r - 3.015) * 65.0) * 1.65;
    float secondary = exp(-abs(r - 3.16) * 40.0) * 0.55;
    float halo = exp(-abs(r - 3.35) * 1.25) * 0.3;
    float broadGlow = exp(-r * 0.26) * 0.08;
    float wingGlow = exp(-abs(p.y) * 2.4) * exp(-abs(p.x) * 0.14) * 0.19;
    vec3 color = fire(disk, 0.63) + fire(arc, 0.75) + fire(photon + secondary, 1.0)
      + vec3(1.0, 0.26, 0.045) * (halo + broadGlow + wingGlow);
    float shadow = smoothstep(2.955, 3.015, r);
    color *= shadow;
    // Tone compression keeps the hot filaments creamy, not clipped white.
    color = vec3(1.0) - exp(-color * 1.32);
    float brightness = max(color.r, max(color.g, color.b));
    float alpha = max(1.0 - smoothstep(2.975, 3.015, r), clamp(brightness * 2.5, 0.0, 1.0));
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color / max(alpha, 0.004), alpha);
  }
`;

export const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uPixelRatio * (48.0 / -mv.z), 1.0, 42.0);
    gl_Position = projectionMatrix * mv;
  }
`;
export const pointFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 38.0);
    float glow = exp(-d * d * 5.0) * 0.34;
    gl_FragColor = vec4(vColor * (1.0 + core * 0.6), (core + glow) * uOpacity);
  }
`;
