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

// Both the direct view and HDR capture use this identical optical profile.
export const stellarLight = /* glsl */ `
  vec4 stellarLight(vec2 coordinate, vec3 color, float opacity) {
    float d = length(coordinate - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 90.0);
    float shoulder = exp(-d * d * 18.0);
    float halo = exp(-d * d * 3.5);
    float edge = 1.0 - smoothstep(0.72, 1.0, d);
    return vec4(color * (4.0 * core + 0.62 * shoulder + 0.07 * halo), edge * opacity);
  }
`;

export const pointFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  ${stellarLight}
  void main() { gl_FragColor = stellarLight(gl_PointCoord, vColor, uOpacity); }
`;
