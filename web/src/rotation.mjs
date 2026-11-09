// Positive angles rotate the image clockwise. Exact quarter turns and shared
// diagonal constants avoid tiny false offsets along symmetry axes at deep zoom.
export function normalizeRotation(angle = 0) {
  if (!Number.isFinite(angle) || Math.abs(angle) > 360000) throw new Error('Enter a finite rotation angle between −360000° and 360000°.');
  const value = angle % 360;
  return value < 0 ? value + 360 : value === 0 ? 0 : value;
}
export function rotationBasis(angle = 0) {
  const degrees = normalizeRotation(angle);
  if (degrees % 45 === 0) {
    const q = Math.SQRT1_2;
    return [[1,0],[q,q],[0,1],[-q,q],[-1,0],[-q,-q],[0,-1],[q,-q]][degrees / 45];
  }
  const radians = degrees * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians)];
}
export function rotateOffset(x, y, angle = 0) {
  const [c,s] = rotationBasis(angle);
  return [x*c-y*s, x*s+y*c];
}
export function rotationDelta(from = 0, to = 0) {
  const difference = normalizeRotation(normalizeRotation(to)-normalizeRotation(from));
  return difference > 180 ? difference-360 : difference;
}
