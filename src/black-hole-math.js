import { Ray, Vector3 } from 'three';

/** Internal ray budgets; size is CSS pixels and DPR is bounded independently. */
export const QUALITY_PRESETS = Object.freeze({
  mobile: Object.freeze({ steps: 96, stepScale: 1.5, maxPixels: 340000, maxDpr: 1 }),
  desktop: Object.freeze({ steps: 144, stepScale: 1, maxPixels: 1100000, maxDpr: 1 }),
  cinematic: Object.freeze({ steps: 192, stepScale: 0.72, maxPixels: 2100000, maxDpr: 1.5 }),
});

export function qualitySettings(name, width, height, dpr = 1) {
  const preset = QUALITY_PRESETS[name];
  if (!preset) throw new RangeError(`Unknown quality: ${name}`);
  if (![width, height, dpr].every(Number.isFinite)) throw new TypeError('Viewport and DPR must be finite');
  width = Math.max(1, width);
  height = Math.max(1, height);
  dpr = Math.max(0.1, dpr);
  const scale = Math.min(dpr, preset.maxDpr, Math.sqrt(preset.maxPixels / (width * height)));
  return { ...preset, name, width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** CPU reference of the shader's inverse-projection/world-matrix reconstruction. */
export function cameraRay(camera, ndcX, ndcY) {
  camera.updateWorldMatrix(true, false);
  const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const direction = new Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  return new Ray(origin, direction);
}

