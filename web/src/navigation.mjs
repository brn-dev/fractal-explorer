import { add, decimal, divide, navigate, text } from './decimal.mjs';

export function screenPoint(x, y, { width, height, aspect = height / width }) {
  return { dx: x / width - .5, dy: (.5 - y / height) * aspect };
}

// A pinch keeps the point under the initial midpoint under the moving midpoint.
// Use decimal navigation here and on release so span limits affect both equally.
export function gestureView(view, start, current, factor, viewport) {
  const zoomed = factor === 1 ? view : navigate({ view, ...screenPoint(start.x, start.y, viewport), factor });
  const { width, height, aspect = height / width } = viewport;
  const dx = (start.x - current.x) / width, dy = (current.y - start.y) / height * aspect;
  return dx || dy ? navigate({ view: zoomed, dx, dy }) : zoomed;
}

// Subtract exact centers before converting their small relative offset to Number.
// Converting the centers or spans first loses navigation at extreme zoom depths.
export function previewTransform(source, target, { width, height, aspect = height / width }, sourceAspect = aspect) {
  const span = decimal(target.span);
  const ratio = value => value.n ? Number(text(divide(value, span, 24))) : 0;
  const difference = (a, b) => {
    const right = decimal(b);
    return add(decimal(a), { n: -right.n, e: right.e });
  };
  const scaleX = ratio(decimal(source.span));
  const scaleY = scaleX * sourceAspect / aspect;
  const x = ratio(difference(source.x, target.x)) * width;
  const y = ratio(difference(target.y, source.y)) * height / aspect;
  return [scaleX, scaleY, x, y].every(Number.isFinite) ? { scaleX, scaleY, x, y } : null;
}
