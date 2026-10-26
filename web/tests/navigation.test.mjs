import test from 'node:test';
import assert from 'node:assert/strict';
import { decimal, navigate, pixelView, compare } from '../src/decimal.mjs';
import { gestureView, previewTransform, screenPoint } from '../src/navigation.mjs';

const base = { x: '-.5', y: '0', span: '3.6', fractal: 'mandelbrot', julia_x: '-.8', julia_y: '.156', iterations: 800, bailout: 64 };
const viewport = { width: 1200, height: 800 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const transformed = (point, transform, { width, height }) => ({
  x: width / 2 + transform.x + (point.x - width / 2) * transform.scaleX,
  y: height / 2 + transform.y + (point.y - height / 2) * transform.scaleY,
});

test('off-center pinch preview keeps the anchored point under the moving midpoint', () => {
  const start = { x: 310, y: 190 }, current = { x: 390, y: 230 };
  const target = gestureView(base, start, current, 2.5, viewport);
  const transform = previewTransform(base, target, viewport);
  const point = transformed(start, transform, viewport);
  close(point.x, current.x); close(point.y, current.y);
  close(transform.scaleX, 2.5); close(transform.scaleY, 2.5);
});

test('stationary pinch and pure two-finger pan do not accidentally pan by the anchor', () => {
  const start = { x: 220, y: 170 };
  assert.equal(gestureView(base, start, start, 1, viewport), base);
  const current = { x: 280, y: 110 };
  const target = gestureView(base, start, current, 1, viewport);
  const transform = previewTransform(base, target, viewport);
  close(transform.x, 60); close(transform.y, -60);
  close(transform.scaleX, 1); close(transform.scaleY, 1);
});

test('scroll and double-click previews preserve an off-center cursor coordinate', () => {
  const anchor = { x: 947, y: 621 };
  for (const factor of [3, .4, Math.exp(.24)]) {
    const target = navigate({ view: base, ...screenPoint(anchor.x, anchor.y, viewport), factor });
    const point = transformed(anchor, previewTransform(base, target, viewport), viewport);
    close(point.x, anchor.x); close(point.y, anchor.y);
  }
});

test('successive gestures transform the displayed field to the accumulated target', () => {
  const first = gestureView(base, { x: 250, y: 170 }, { x: 300, y: 220 }, 2, viewport);
  const target = gestureView(first, { x: 850, y: 610 }, { x: 800, y: 560 }, 1.5, viewport);
  const a = previewTransform(base, first, viewport), b = previewTransform(first, target, viewport);
  const combined = previewTransform(base, target, viewport);
  const feature = { x: 743, y: 352 };
  const sequential = transformed(transformed(feature, a, viewport), b, viewport);
  const accumulated = transformed(feature, combined, viewport);
  close(accumulated.x, sequential.x); close(accumulated.y, sequential.y);
  // If the first render arrives mid-gesture, rebasing the same target is continuous.
  const rebased = transformed(transformed(feature, a, viewport), previewTransform(first, target, viewport), viewport);
  close(rebased.x, accumulated.x); close(rebased.y, accumulated.y);
  assert.deepEqual(previewTransform(target, target, viewport), { scaleX: 1, scaleY: 1, x: 0, y: 0 });
});

test('preview follows actual clamped spans at maximum zoom and maximum view width', () => {
  const anchor = { x: 310, y: 190 };
  for (const [view, factor, expectedScale] of [
    [{ ...base, x: '0', y: '1', span: '2e-10000' }, 10, 2],
    [{ ...base, span: '8' }, .1, .5],
  ]) {
    const target = gestureView(view, anchor, anchor, factor, viewport);
    const transform = previewTransform(view, target, viewport);
    close(transform.scaleX, expectedScale);
    const point = transformed(anchor, transform, viewport);
    close(point.x, anchor.x); close(point.y, anchor.y);
  }
});

test('deep preview offsets retain precision with centers that collapse to the same double', () => {
  const view = { ...base, x: '-0.' + '7'.repeat(1050), y: '1', span: '1e-1000' };
  const target = navigate({ view, dx: .125, dy: -.25 });
  assert.equal(Number(view.x), Number(target.x));
  assert.equal(Number(view.span), 0);
  const transform = previewTransform(view, target, viewport);
  close(transform.x, -150); close(transform.y, -300);
  close(transform.scaleX, 1);
});

test('preview and pointer mapping respect the rounded render aspect ratio', () => {
  const dimensions = { width: 997, height: 673, aspect: 337 / 500 };
  const sourceAspect = 333 / 497;
  const anchor = { x: 713, y: 439 };
  const target = gestureView(base, anchor, anchor, 2, dimensions);
  const transform = previewTransform(base, target, dimensions, sourceAspect);
  // Check a source pixel against the final view's coordinate projection independently.
  const coordinate = pixelView(base, 350, 210, 497, 333);
  const sourcePixel = { x: 350.5 / 497 * dimensions.width, y: 210.5 / 333 * dimensions.height };
  const projected = transformed(sourcePixel, transform, dimensions);
  const expectedX = (Number(coordinate.x) - Number(target.x)) / Number(target.span);
  const expectedY = (Number(target.y) - Number(coordinate.y)) / Number(target.span);
  close(projected.x, (.5 + expectedX) * dimensions.width);
  close(projected.y, (.5 + expectedY / dimensions.aspect) * dimensions.height);
  const stationary = gestureView(base, anchor, anchor, 1, dimensions);
  assert.equal(compare(decimal(stationary.x), decimal(base.x)), 0);
});

test('an unrepresentable jump does not produce a non-finite CSS transform', () => {
  assert.equal(previewTransform(base, { ...base, span: '1e-10000' }, viewport), null);
});
