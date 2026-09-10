// Luminous sprites for actual anonymous graph nodes.
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
