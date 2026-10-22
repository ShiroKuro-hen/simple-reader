import { describe, expect, it } from 'vitest';
import { placePopup, usesSheet } from './placement';

const vp = { w: 1000, h: 800 };
const size = { w: 300, h: 200 };
const at = (x: number, y: number, width = 100, height = 20) => ({ x, y, width, height });

describe('placePopup', () => {
  it('sits below the selection, centred on it, when there is room', () => {
    expect(placePopup(at(400, 100), size, vp)).toEqual({ x: 300, y: 130, side: 'below' });
  });

  it('flips above when the selection is near the bottom edge', () => {
    // only 80px below the rect: not enough for 200px; 700px above.
    expect(placePopup(at(400, 700), size, vp)).toEqual({ x: 300, y: 490, side: 'above' });
  });

  it('keeps below when it fits exactly, flips one pixel later', () => {
    // needs 200 (height) + 10 (gap) + 12 (margin) = 222px under the rect
    expect(placePopup(at(400, 558), size, vp).side).toBe('below'); // 800 - 578 = 222
    expect(placePopup(at(400, 559), size, vp).side).toBe('above'); // 800 - 579 = 221
  });

  it('picks the roomier side and clamps inside the viewport when neither fits', () => {
    const tall = { w: 300, h: 700 };
    const p = placePopup(at(400, 300), tall, vp); // 480 below, 300 above
    expect(p.side).toBe('below');
    expect(p.y).toBe(88); // clamped so the bottom edge stays 12px inside: 800 - 700 - 12
  });

  it('clamps horizontally to the viewport with a margin', () => {
    expect(placePopup(at(0, 100, 10), size, vp).x).toBe(12);
    expect(placePopup(at(990, 100, 10), size, vp).x).toBe(688);
  });

  it('never leaves the top-left even when the popup is bigger than the viewport', () => {
    const p = placePopup(at(50, 50), { w: 900, h: 900 }, { w: 400, h: 400 });
    expect(p.x).toBe(12);
    expect(p.y).toBe(12);
  });
});

describe('usesSheet', () => {
  it('uses a bottom sheet on phones and a floating card from 560px', () => {
    expect(usesSheet(360)).toBe(true);
    expect(usesSheet(559)).toBe(true);
    expect(usesSheet(560)).toBe(false);
    expect(usesSheet(1280)).toBe(false);
  });
});
