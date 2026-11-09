// Native range controls can jump on touch-down before the browser identifies a
// vertical scroll. Own touch adjustment, while pan-y remains a native gesture:
// https://www.w3.org/TR/pointerevents3/#the-touch-action-css-property
export function setupTouchControls(root = document, { now = () => performance.now() } = {}) {
  const quietMs = 180, slop = 8, scrolls = new WeakMap();
  const touches = new Set(), listeners = [];
  let gesture = null, completed = null, blockedClicks = [];
  const range = target => target?.closest?.('input[type="range"]');
  const control = target => target?.closest?.('button, input, select, textarea, a[href], label');
  const ancestors = element => {
    const result = [];
    for (let node = element; node; node = node.parentElement) result.push(node);
    return result;
  };
  const scrolling = element => ancestors(element).some(node => now() - (scrolls.get(node) ?? -Infinity) < quietMs);
  const enabled = element => element.isConnected && !element.matches(':disabled');
  const emit = (element, type) => element.dispatchEvent(new Event(type, { bubbles:true }));
  const commit = current => {
    if (current.changed && !current.committed && enabled(current.slider)) {
      current.committed = true; emit(current.slider, 'change');
    }
  };
  const prepare = current => {
    const slider = current.slider;
    if (!enabled(slider)) return false;
    slider.focus({ preventScroll:true });
    if (!enabled(slider)) return false;
    const rect = slider.getBoundingClientRect();
    const min = slider.min === '' ? 0 : Number(slider.min), max = slider.max === '' ? 100 : Number(slider.max);
    if (![min,max,rect.width].every(Number.isFinite) || max <= min || rect.width <= 16) return false;
    const rtl = slider.ownerDocument.defaultView.getComputedStyle(slider).direction === 'rtl';
    const fraction = (Number(slider.value)-min)/(max-min);
    const thumb = rect.left+8+(rtl ? 1-fraction : fraction)*(rect.width-16);
    Object.assign(current, { min, max, rect, rtl, value:slider.value, startValue:Number(slider.value), relative:Math.abs(current.x-thumb) <= 20 });
    return true;
  };
  const adjust = (current, x, tap = false) => {
    const slider = current.slider;
    if (!enabled(slider)) return;
    const { min,max,rect,rtl } = current;
    let fraction = (x-rect.left-8)/(rect.width-16);
    if (rtl) fraction = 1-fraction;
    const value = current.relative && !tap
      ? current.startValue+(x-current.x)/(rect.width-16)*(max-min)*(rtl ? -1 : 1)
      : min+fraction*(max-min);
    const before = slider.value;
    slider.value = String(Math.max(min,Math.min(max,value))); // Native step sanitization.
    current.value = slider.value;
    if (slider.value !== before) {
      current.changed = true; emit(slider, 'input');
      current.value = slider.value; // A consumer can normalize/synchronize it.
    }
  };
  const onDown = event => {
    completed = null;
    if (event.pointerType !== 'touch') return;
    touches.add(event.pointerId);
    const slider = range(event.target), element = control(event.target);
    blockedClicks = blockedClicks.filter(item => item.until > now());
    if (touches.size > 1 && gesture) { commit(gesture); gesture.mode = 'scroll'; }
    if (slider) {
      if (!enabled(slider)) return;
      event.preventDefault(); // Suppress compatibility mouse handling; native input is guarded below.
      if (touches.size > 1) return;
      gesture = { slider, id:event.pointerId, x:event.clientX, y:event.clientY, value:slider.value,
        parents:ancestors(slider), mode:scrolling(slider) ? 'scroll' : 'pending', changed:false };
    } else if (element) {
      // A fresh touch can stop a fling before click fires. Remember that it began
      // during scrolling so stopping the fling cannot also toggle a control.
      blockedClicks = blockedClicks.filter(item => item.element !== element || item.id !== event.pointerId);
      if (scrolling(element)) {
        event.preventDefault();
        blockedClicks.push({ element, id:event.pointerId, until:now()+1000 });
      }
    }
  };
  const onMove = event => {
    const current = gesture;
    if (!current || current.id !== event.pointerId || event.pointerType !== 'touch') return;
    if (!enabled(current.slider)) { gesture = null; return; }
    const dx = Math.abs(event.clientX-current.x), dy = Math.abs(event.clientY-current.y);
    if (current.mode === 'pending' && Math.max(dx,dy) >= slop) {
      if (dy >= slop && dx <= dy*1.5) current.mode = 'scroll';
      else if (dx >= slop && dx > dy*1.5) {
        if (scrolling(current.slider) || !prepare(current)) { current.mode = 'scroll'; return; }
        current.mode = 'drag';
        try { current.slider.setPointerCapture(event.pointerId); } catch {}
      }
    }
    if (current.mode === 'drag') { event.preventDefault(); adjust(current,event.clientX); }
  };
  const onEnd = event => {
    touches.delete(event.pointerId);
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    if (event.type === 'pointerup' && current.mode === 'pending'
        && Math.hypot(event.clientX-current.x,event.clientY-current.y) < slop
        && !scrolling(current.slider) && prepare(current)) adjust(current,event.clientX,true);
    gesture = null;
    commit(current);
    // Chromium can emit its own change after pointerup even though the native
    // input was restored. The accepted touch value already has one commit.
    completed = { slider:current.slider, value:current.slider.value, until:now()+1000 };
    try { if (current.slider.hasPointerCapture(event.pointerId)) current.slider.releasePointerCapture(event.pointerId); } catch {}
  };
  const onScroll = event => {
    const element = event.target === root ? root.scrollingElement : event.target;
    if (!element || element.scrollHeight <= element.clientHeight+1) return;
    scrolls.set(element,now());
    if (gesture?.parents.includes(element)) { gesture.mode = 'scroll'; commit(gesture); }
  };
  const onClick = event => {
    const touch = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents === true;
    if (!touch) return;
    blockedClicks = blockedClicks.filter(item => item.until > now());
    if (range(event.target) || blockedClicks.some(item => item.element.contains(event.target)
        && (event.pointerId === undefined || item.id === event.pointerId))) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const onNativeValue = event => {
    if (gesture?.slider === event.target && event.isTrusted) {
      event.target.value = gesture.value;
      event.stopImmediatePropagation();
    } else if (event.isTrusted && completed?.slider === event.target) {
      if (event.type === 'change' && completed.until > now() && event.target.value === completed.value) event.stopImmediatePropagation();
      completed = null;
    }
  };
  const blur = () => { if (gesture) commit(gesture); gesture = null; completed = null; touches.clear(); blockedClicks = []; };
  // A native thumb can lose shadow-DOM capture when capture transfers to the
  // input. Only pointerup/cancel ends the gesture; document still observes both.
  for (const [type,handler] of [['pointerdown',onDown],['pointermove',onMove],['pointerup',onEnd],['pointercancel',onEnd],
    ['scroll',onScroll],['click',onClick],['input',onNativeValue],['change',onNativeValue]]) {
    root.addEventListener(type,handler,{ capture:true, passive:false }); listeners.push([type,handler]);
  }
  root.defaultView?.addEventListener('blur',blur);
  return () => { blur(); for (const [type,handler] of listeners) root.removeEventListener(type,handler,true); root.defaultView?.removeEventListener('blur',blur); };
}
