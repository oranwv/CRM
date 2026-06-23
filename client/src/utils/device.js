// True on a desktop/laptop browser (mouse-driven), false on touch devices.
// Used to decide whether a lead card opens in a new browser tab (desktop) or as
// an in-page full-screen overlay (mobile).
export function isDesktop() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
