// Fit the whole target screen above the scene editor toolbar. View.span still
// denotes this frame's width, just as it does in the exported wallpaper.
export function wallpaperFrame(width, height, target, toolbarHeight = 0) {
  const gap = 16, top = Math.min(88, height * .18);
  const bottom = Math.min(Math.max(28, toolbarHeight + 30), height * .6);
  const availableWidth = Math.max(16, width - gap * 2);
  const availableHeight = Math.max(16, height - top - bottom);
  const scale = Math.min(availableWidth / target.width, availableHeight / target.height);
  const frameWidth = target.width * scale, frameHeight = target.height * scale;
  return { left: (width - frameWidth) / 2, top: top + (availableHeight - frameHeight) / 2, width: frameWidth, height: frameHeight };
}
