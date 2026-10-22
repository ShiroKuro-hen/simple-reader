// Where the lookup popup goes. Pure: numbers in, numbers out.

export interface Rect { x: number; y: number; width: number; height: number }

const GAP = 10;
const MARGIN = 12;
/** Below this viewport width the popup is a bottom sheet, not a floating card. */
const SHEET_MAX_WIDTH = 559;

export const usesSheet = (viewportWidth: number): boolean => viewportWidth <= SHEET_MAX_WIDTH;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Below the selection if it fits, else above, else the roomier side; always inside the viewport. */
export function placePopup(
  rect: Rect,
  size: { w: number; h: number },
  vp: { w: number; h: number },
): { x: number; y: number; side: 'above' | 'below' } {
  const room = { below: vp.h - (rect.y + rect.height), above: rect.y };
  const need = size.h + GAP + MARGIN;
  const side = room.below >= need ? 'below' : room.above >= need ? 'above' : room.above > room.below ? 'above' : 'below';
  const y = side === 'below' ? rect.y + rect.height + GAP : rect.y - size.h - GAP;
  return {
    x: clamp(rect.x + rect.width / 2 - size.w / 2, MARGIN, Math.max(MARGIN, vp.w - size.w - MARGIN)),
    y: clamp(y, MARGIN, Math.max(MARGIN, vp.h - size.h - MARGIN)),
    side,
  };
}
