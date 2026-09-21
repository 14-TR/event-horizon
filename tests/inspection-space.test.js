import test from 'node:test';
import assert from 'node:assert/strict';
const { uncoveredRect, locateSelection } = await import('../src/inspection-space.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

test('Locate uses the largest uncovered host-relative region, not the drawer-covered screen center', () => {
  assert.equal(typeof uncoveredRect, 'function', 'safe inspection framing must exist');
  for (const [width, height, drawerTop] of [[320, 568, 305], [390, 844, 581], [1440, 900, 28]]) {
    const host = { left: 40, top: 60, width, height };
    const title = { left: 66, top: 88, width: 180, height: 82 };
    const drawer = width < 700
      ? { left: 52, top: drawerTop + host.top, width: width - 24, height: height - drawerTop - 12 }
      : { left: host.left + width - 364, top: host.top + 28, width: 336, height: height - 56 };
    const safe = uncoveredRect(host, [title, drawer]);
    assert.ok(safe.width > 200 && safe.height > 100);
    assert.ok(safe.left >= 20 && safe.top >= 20);
    assert.ok(safe.left + safe.width <= width - 20);
    assert.ok(safe.top + safe.height <= height - 20);
    const absolute = { ...safe, left: safe.left + host.left, top: safe.top + host.top };
    assert.ok(!overlaps(absolute, title));
    assert.ok(!overlaps(absolute, drawer));
  }
});

test('no safe scene area is reported when the host is covered or has no size', () => {
  assert.equal(typeof uncoveredRect, 'function');
  assert.equal(uncoveredRect({ left: 0, top: 0, width: 320, height: 568 }, [{ left: 0, top: 0, width: 320, height: 568 }]), null);
  assert.equal(uncoveredRect({ left: 0, top: 0, width: 0, height: 0 }, []), null);
  assert.deepEqual(uncoveredRect({ left: 0, top: 0, width: 320, height: 568 }, []), { left: 24, top: 24, width: 272, height: 520 });
});

test('the scene handoff uses the selected ID and safeRect, tolerates an unintegrated or unavailable API', () => {
  assert.equal(typeof locateSelection, 'function');
  const host = { left: 0, top: 0, width: 320, height: 568 };
  const blockers = [{ left: 12, top: 300, width: 296, height: 256 }];
  const calls = [];
  const scene = { locateNode(id, options) { calls.push({ id, options }); return true; } };
  assert.equal(locateSelection(scene, 'n000001', host, blockers), true);
  assert.deepEqual(calls, [{ id: 'n000001', options: { safeRect: uncoveredRect(host, blockers) } }]);
  assert.equal(locateSelection(undefined, 'n000001', host, blockers), false);
  assert.equal(locateSelection({}, 'n000001', host, blockers), false);
  assert.equal(locateSelection(scene, null, host, blockers), false);
  assert.equal(locateSelection(scene, 'n000001', host, [host]), false);
  assert.equal(calls.length, 1);
});
