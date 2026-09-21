/** Momentary, multi-pointer thrust. Disclosure never owns the opt-in mode. */
export function bindFlightPad(pad, { getControls, isEnabled, onInput = () => {} }) {
  const abort = new AbortController();
  const { signal } = abort;
  const document = pad.ownerDocument;
  const buttons = [...pad.querySelectorAll('[data-flight]')];
  const held = new Map(buttons.map(button => [button, new Set()]));
  function sync() {
    const controls = getControls();
    controls?.thrust.clear();
    for (const [button, sources] of held) {
      button.setAttribute('aria-pressed', String(sources.size > 0));
      if (sources.size) controls?.thrust.add(button.dataset.flight);
    }
  }
  function release(button) {
    const sources = [...held.get(button)];
    held.get(button).clear();
    for (const source of sources) {
      if (typeof source === 'number' && button.hasPointerCapture(source)) button.releasePointerCapture(source);
    }
    sync();
  }
  function clear() {
    for (const button of buttons) release(button);
    getControls()?.clear();
  }
  for (const button of buttons) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', event => {
      if (!isEnabled() || event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      onInput();
      held.get(button).add(event.pointerId);
      sync();
    }, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => {
      held.get(button).delete(event.pointerId);
      sync();
    }, { signal });
    button.addEventListener('keydown', event => {
      if (!isEnabled() || ![' ', 'Enter'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (!held.get(button).has(event.key)) onInput();
      held.get(button).add(event.key);
      sync();
    }, { signal });
    button.addEventListener('keyup', event => { held.get(button).delete(event.key); sync(); }, { signal });
    button.addEventListener('blur', () => release(button), { signal });
  }
  document.defaultView.addEventListener('blur', clear, { signal });
  document.defaultView.addEventListener('pagehide', clear, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); }, { signal });
  return { clear, dispose() { clear(); abort.abort(); } };
}
