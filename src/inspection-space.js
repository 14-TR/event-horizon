/** Largest usable axis-aligned scene region, in host-relative CSS pixels.
 * Rectangles are measured from the actual DOM after disclosure/layout, not
 * guessed from breakpoints. Padding protects the reticle and its small label.
 */
export function uncoveredRect(host, blockers, padding = 24) {
  const right = host.width - padding;
  const bottom = host.height - padding;
  if (right <= padding || bottom <= padding) return null;
  const boxes = blockers.filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({
    left: Math.max(padding, rect.left - host.left - padding),
    top: Math.max(padding, rect.top - host.top - padding),
    right: Math.min(right, rect.left - host.left + rect.width + padding),
    bottom: Math.min(bottom, rect.top - host.top + rect.height + padding),
  })).filter(box => box.right > box.left && box.bottom > box.top);
  const xs = [...new Set([padding, right, ...boxes.flatMap(box => [box.left, box.right])])].sort((a, b) => a - b);
  const ys = [...new Set([padding, bottom, ...boxes.flatMap(box => [box.top, box.bottom])])].sort((a, b) => a - b);
  let best = null;
  let area = 0;
  for (const left of xs) for (const x of xs) {
    if (x - left < 96) continue;
    for (const top of ys) for (const y of ys) {
      if (y - top < 80 || (x - left) * (y - top) <= area) continue;
      if (boxes.some(box => left < box.right && x > box.left && top < box.bottom && y > box.top)) continue;
      best = { left, top, width: x - left, height: y - top };
      area = best.width * best.height;
    }
  }
  return best;
}

/** Optional until the scene contract is integrated; never lie about success. */
export function locateSelection(scene, id, host, blockers) {
  if (!id || !scene?.locateNode) return false;
  const safeRect = uncoveredRect(host, blockers);
  return safeRect ? scene.locateNode(id, { safeRect }) === true : false;
}
