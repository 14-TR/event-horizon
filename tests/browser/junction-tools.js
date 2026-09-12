import * as THREE from 'three';
import assert from 'node:assert/strict';

// Verification-only observation of real production uniforms, never app hooks.
export async function observeJunction(page) {
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype, names = new WeakMap();
    const location = proto.getUniformLocation, matrix = proto.uniformMatrix4fv, scalar = proto.uniform1f;
    window.__junction = {};
    proto.getUniformLocation = function (program, name) {
      const result = location.call(this, program, name); if (result) names.set(result, name); return result;
    };
    proto.uniformMatrix4fv = function (location, transpose, value, ...rest) {
      if (names.get(location) === 'uCameraToHole') window.__junction.camera = Array.from(value);
      if (names.get(location) === 'uInverseProjection') window.__junction.projection = Array.from(value);
      return matrix.call(this, location, transpose, value, ...rest);
    };
    proto.uniform1f = function (location, value) {
      if (names.get(location) === 'uTime') window.__junction.time = value;
      return scalar.call(this, location, value);
    };
  });
}

export async function settleJunction(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function hideJunctionOverlays(page) {
  await page.addStyleTag({ content: '.intro, #explore-tools, #flight-pad, [data-hud], .vignette { visibility: hidden !important; }' });
}

// Real OrbitControls pointer events. Solve the current tilted-up orbit frame;
// do not mistake an old opening-frame drag constant for a particular angle.
export async function aimJunction(page, elevation, azimuth, { steps = 5 } = {}) {
  const { width, height } = page.viewportSize();
  const depth = Math.max(19, 25 / (width / height));
  const target = new THREE.Vector3(0, depth * 0.052, 0);
  const up = new THREE.Vector3(0.1, 1, 0).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  const camera = await page.evaluate(() => window.__junction.camera);
  const offset = new THREE.Vector3(...camera.slice(12, 15)).multiplyScalar(1.15).sub(target);
  const radius = offset.length(), current = new THREE.Spherical().setFromVector3(offset.applyQuaternion(rotation));
  const e = elevation * Math.PI / 180, a = azimuth * Math.PI / 180;
  const direction = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const projection = target.dot(direction);
  const distance = projection + Math.sqrt(projection * projection + radius * radius - target.lengthSq());
  const goal = new THREE.Spherical().setFromVector3(direction.multiplyScalar(distance).sub(target).applyQuaternion(rotation));
  const deltaTheta = Math.atan2(Math.sin(goal.theta - current.theta), Math.cos(goal.theta - current.theta));
  const dx = -deltaTheta * height / (2 * Math.PI * 0.45), dy = -(goal.phi - current.phi) * height / (2 * Math.PI * 0.45);
  const count = Math.ceil(Math.max(Math.abs(dx) / (width * 0.3), Math.abs(dy) / (height * 0.35), 1));
  for (let i = 0; i < count; i++) {
    const x = width * 0.5, y = height * 0.5;
    await page.mouse.move(x, y);
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [x, y]), 'CANVAS');
    await page.mouse.down(); await page.mouse.move(x + dx / count, y + dy / count, { steps }); await page.mouse.up();
  }
  await settleJunction(page);
  const actual = await page.evaluate(() => ({ ...window.__junction, ...document.querySelector('#observatory').dataset }));
  const p = actual.camera.slice(12, 15);
  actual.elevation = Math.atan2(p[1], Math.hypot(p[0], p[2])) * 180 / Math.PI;
  actual.azimuth = Math.atan2(p[0], p[2]) * 180 / Math.PI;
  assert.ok(Math.abs(actual.elevation - elevation) < 0.01, `actual elevation ${actual.elevation}, requested ${elevation}`);
  assert.ok(Math.abs(Math.atan2(Math.sin((actual.azimuth - azimuth) * Math.PI / 180), Math.cos((actual.azimuth - azimuth) * Math.PI / 180))) < 0.001, 'actual azimuth');
  return actual;
}

// A local widest-path bottleneck, not total image brightness or a synthetic arc.
// The box bounds the reproduced LEFT junction and forbids a route around the
// opposite side of the hole. A 5px analysis average rejects isolated star cores.
export async function junctionStrength(page, screenshot) {
  return page.evaluate(async base64 => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0); image.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const x0 = 330, x1 = 415, y0 = 400, y1 = 540, width = x1 - x0 + 1, height = y1 - y0 + 1;
    const light = new Float64Array(width * height);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = ((y + dy) * canvas.width + x + dx) * 4;
        sum += (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
      }
      light[(y - y0) * width + x - x0] = sum / 25;
    }
    const start = (434 - y0) * width + 371 - x0, end = (523 - y0) * width + 398 - x0;
    const connected = threshold => {
      if (light[start] < threshold || light[end] < threshold) return false;
      const visited = new Uint8Array(light.length), queue = [start]; visited[start] = 1;
      for (let i = 0; i < queue.length; i++) {
        const at = queue[i]; if (at === end) return true;
        for (const next of [at - width, at + width, ...(at % width ? [at - 1] : []), ...(at % width < width - 1 ? [at + 1] : [])]) {
          if (next < 0 || next >= light.length || visited[next] || light[next] < threshold) continue;
          visited[next] = 1; queue.push(next);
        }
      }
      return false;
    };
    let low = 0, high = 1;
    for (let i = 0; i < 12; i++) { const mid = (low + high) / 2; if (connected(mid)) low = mid; else high = mid; }
    return { bridge: low, arc: light[start], disk: light[end], ratio: low / Math.min(light[start], light[end]), box: [x0, y0, x1, y1], source: [371, 434], destination: [398, 523] };
  }, screenshot.toString('base64'));
}
