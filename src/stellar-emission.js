import { Color } from 'three';
import { DISK } from './layout.js';

const copper = new Color('#d57840'), ivory = new Color('#fff3de');

/** Shared linear source emission, not a physical temperature or luminosity.
 * Current radius grades actual stars and their exposure; sector tint is subtle.
 * A strictly positive outer floor keeps every real note represented.
 */
export function stellarColor(position, sector, target) {
  const radius = Math.hypot(position[0], position[2]);
  const heat = Math.exp(-Math.pow(Math.max(0, radius - DISK.inner) / 2.2, 1.4));
  return target.copy(copper).lerp(ivory, heat).lerp(sector, 0.08).multiplyScalar(0.3 + 1.4 * heat);
}
