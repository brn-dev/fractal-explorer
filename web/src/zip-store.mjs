const table = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0);
  return i >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
export async function wallpaperZip(entries) {
  const parts = [], directory = []; let offset = 0;
  if (entries.length > 16) throw new Error('Too many wallpaper files.');
  for (const [name, blob] of entries) {
    if (!/^[a-z0-9-]+\.(mp4|png|json)$/.test(name)) throw new Error('Invalid wallpaper filename.');
    const filename = new TextEncoder().encode(name), bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > 150 * 1024 ** 2) throw new Error('A wallpaper clip exceeds 150 MB.');
    const crc = crc32(bytes), header = new Uint8Array(30 + filename.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true); view.setUint16(26, filename.length, true); header.set(filename, 30);
    const central = new Uint8Array(46 + filename.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, filename.length, true); cv.setUint32(42, offset, true); central.set(filename, 46);
    parts.push(header, blob); directory.push(central); offset += header.length + bytes.length;
  }
  const directorySize = directory.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
