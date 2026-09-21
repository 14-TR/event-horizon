import test from 'node:test';
import assert from 'node:assert/strict';
const { bindFlightPad } = await import('../src/flight-pad.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const send = (target, type, fields = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
};
function setup() {
  assert.equal(typeof bindFlightPad, 'function', 'touch flight must have an independent lifecycle');
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { defaultView: window, hidden: false });
  const buttons = ['forward', 'left'].map(direction => Object.assign(new EventTarget(), {
    dataset: { flight: direction }, attributes: {}, captures: new Set(),
    setAttribute(key, value) { this.attributes[key] = value; },
    setPointerCapture(id) { this.captures.add(id); },
    hasPointerCapture(id) { return this.captures.has(id); },
    releasePointerCapture(id) { this.captures.delete(id); },
  }));
  const pad = { ownerDocument: document, querySelectorAll: () => buttons };
  const controls = { thrust: new Set(), clear() { this.thrust.clear(); } };
  let enabled = true;
  let inputs = 0;
  const binding = bindFlightPad(pad, { getControls: () => controls, isEnabled: () => enabled, onInput: () => inputs++ });
  return { window, document, buttons, controls, binding, inputs: () => inputs, disable: () => { enabled = false; } };
}

test('touch thrust supports simultaneous inputs and cancellation without releasing a different pointer', () => {
  const { buttons: [forward, left], controls, binding, inputs } = setup();
  send(forward, 'pointerdown', { pointerId: 1, button: 0 });
  send(left, 'pointerdown', { pointerId: 2, button: 0 });
  assert.deepEqual([...controls.thrust].sort(), ['forward', 'left']);
  assert.equal(inputs(), 2, 'manual thrust reports input to cancel scene transitions');
  send(forward, 'pointercancel', { pointerId: 1 });
  assert.deepEqual([...controls.thrust], ['left']);
  send(left, 'lostpointercapture', { pointerId: 2 });
  assert.equal(controls.thrust.size, 0);
  binding.dispose();
});

test('blur, visibility changes, disclosure cleanup and disposal cannot leave stuck thrust', () => {
  for (const cause of ['blur', 'hidden', 'clear', 'dispose']) {
    const { buttons: [button], controls, binding, window, document } = setup();
    send(button, 'pointerdown', { pointerId: 3, button: 0 });
    assert.equal(controls.thrust.size, 1);
    if (cause === 'blur') send(window, 'blur');
    if (cause === 'hidden') { document.hidden = true; send(document, 'visibilitychange'); }
    if (cause === 'clear') binding.clear();
    if (cause === 'dispose') binding.dispose();
    assert.equal(controls.thrust.size, 0, cause);
    assert.equal(button.attributes['aria-pressed'], 'false', cause);
    binding.dispose();
  }
});

test('keyboard thrust releases only its own input and disabled flight cannot start', () => {
  const { buttons: [button], controls, binding, disable } = setup();
  send(button, 'keydown', { key: 'Enter' });
  send(button, 'pointerdown', { pointerId: 1, button: 0 });
  send(button, 'keyup', { key: 'Enter' });
  assert.equal(controls.thrust.size, 1);
  send(button, 'blur');
  assert.equal(controls.thrust.size, 0);
  disable();
  send(button, 'pointerdown', { pointerId: 2, button: 0 });
  send(button, 'keydown', { key: ' ' });
  assert.equal(controls.thrust.size, 0);
  binding.dispose();
});
