import { defaultWallpaperDraft, wallpaperSnapshot } from '../src/wallpaper.mjs';

// Supported decimal inputs can exceed 1 MiB across four scenes and their targets.
export function largeWallpaperDraft() {
  const view = { fractal:'custom', custom_mode:'julia', custom_formula:'z^2+c', custom_constant_count:16,
    x:'0', y:'0', span:'3.6', julia_x:'-.8', julia_y:'.156', iterations:100, bailout:64 };
  const automation = {};
  for (let i = 1; i <= 16; i++) {
    view[`x${i}`] = '0.' + '1'.repeat(10000);
    automation[`x${i}`] = { enabled:true, target:'0.' + '2'.repeat(10000), speed:.25, shape:'sine' };
  }
  return defaultWallpaperDraft(wallpaperSnapshot({ view, automation, speed:.12,
    colors:{ definition:{name:'Large draft',colors:['#000000','#ffffff']},density:1,phase:0 } }, []));
}
