import { add, decimal, divide, navigate, text } from './decimal.mjs';
import { rotationBasis } from './rotation.mjs';

export function screenPoint(x, y, { width, height, left = 0, top = 0, aspect = height / width }) {
  return { dx: (x - left) / width - .5, dy: (.5 - (y - top) / height) * aspect };
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
  const dx = ratio(difference(source.x, target.x)), dy = ratio(difference(source.y, target.y));
  const [tc,ts] = rotationBasis(target.rotation);
  const translatedX = (dx*tc+dy*ts)*width, translatedY = (dx*ts-dy*tc)*height/aspect;
  if (![scaleX, scaleY, translatedX, translatedY].every(Number.isFinite)) return null;
  const x = translatedX || 0, y = translatedY || 0;
  const [c,s] = rotationBasis((source.rotation ?? 0)-(target.rotation ?? 0));
  if (c === 1 && s === 0) return { scaleX, scaleY, x, y };
  const matrix = { a:scaleX*c, b:-scaleX*s*height/(aspect*width), c:scaleX*s*sourceAspect*width/height, d:scaleY*c, x, y };
  return Object.values(matrix).every(Number.isFinite) ? matrix : null;
}
