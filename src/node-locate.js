import * as THREE from 'three';

/** Host-relative safe framing. Keep fractions so a resize retains composition. */
export function locateRegion(rect, width, height) {
  const full = { left: 0, top: 0, width, height };
  if (!rect || !['left', 'top', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) rect = full;
  const left = THREE.MathUtils.clamp(rect.left, 0, width);
  const top = THREE.MathUtils.clamp(rect.top, 0, height);
  const right = THREE.MathUtils.clamp(rect.left + rect.width, left, width);
  const bottom = THREE.MathUtils.clamp(rect.top + rect.height, top, height);
  if (right <= left || bottom <= top) return { x: 0, y: 0 };
  return { x: (left + right) / Math.max(1, width) - 1, y: 1 - (top + bottom) / Math.max(1, height) };
}

/** Look inward from outside the true source: never aim through the horizon. */
export function nodeFrame(world, camera, region) {
  const outward = new THREE.Vector3(world.x, 0, world.z).normalize();
  if (!outward.lengthSq()) outward.set(0, 0, 1);
  const direction = outward.add(new THREE.Vector3(0, 0.65, 0)).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const distance = 13;
  const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const target = world.clone().addScaledVector(right, -region.x * halfHeight * camera.aspect).addScaledVector(up, -region.y * halfHeight);
  return { target, position: target.clone().addScaledVector(direction, distance) };
}

/** Spherical dolly keeps long, opposite-side journeys outside the horizon. */
export function travelPosition(from, to, t, output) {
  const start = from.clone().normalize(), end = to.clone().normalize();
  const arc = new THREE.Quaternion().setFromUnitVectors(start, end);
  const rotation = new THREE.Quaternion().slerp(arc, t);
  const radius = THREE.MathUtils.lerp(from.length(), to.length(), t)
    + Math.sin(Math.PI * t) * Math.min(6, from.distanceTo(to) * 0.16);
  return output.copy(start).applyQuaternion(rotation).multiplyScalar(Math.max(4, radius));
}
