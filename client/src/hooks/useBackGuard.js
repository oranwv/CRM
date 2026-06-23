import { useEffect, useRef } from 'react';

// Confirm message shown when a dirty overlay is about to be closed (back gesture or
// clicking outside the window). Exported so close buttons / backdrops use the same text.
export const DIRTY_MSG = 'האם אתה בטוח שאתה רוצה לסגור את החלון?';

// Module-level stack of currently-armed guards (LIFO). Only the topmost guard
// reacts to a real "back" gesture, so nested overlays close one at a time.
const stack = [];
// Counter of synthetic history.back() calls we issue ourselves (on programmatic
// close), so their popstate events are ignored instead of closing an outer overlay.
let suppress = 0;

/**
 * Intercepts a browser "back" gesture (Windows back button / Mac trackpad swipe →
 * popstate) so it closes the topmost open overlay instead of navigating the SPA.
 * If the overlay is dirty, it confirms before closing.
 *
 * @param {boolean}  isOpen   whether the overlay is currently open/mounted
 * @param {Function} onClose  programmatic close handler for this overlay
 * @param {Object}   [opts]
 * @param {boolean}  [opts.isDirty]  whether the overlay has unsaved edits
 */
export default function useBackGuard(isOpen, onClose, { isDirty = false } = {}) {
  // Keep latest values without re-arming the listener on every render.
  const dirtyRef = useRef(isDirty);
  const closeRef = useRef(onClose);
  dirtyRef.current = isDirty;
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const entry = { dirtyRef, closeRef };
    stack.push(entry);
    window.history.pushState({ backGuard: true }, '');
    let armed = true;

    const onPop = () => {
      // Ignore popstate events caused by our own synthetic history.back().
      if (suppress > 0) { suppress -= 1; return; }
      // Only the topmost guard handles a real back gesture.
      if (stack[stack.length - 1] !== entry) return;

      armed = false;
      stack.pop();
      if (dirtyRef.current && !window.confirm(DIRTY_MSG)) {
        // User canceled: re-arm so the overlay stays open.
        window.history.pushState({ backGuard: true }, '');
        armed = true;
        stack.push(entry);
        return;
      }
      closeRef.current();
    };

    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      const idx = stack.indexOf(entry);
      if (idx !== -1) stack.splice(idx, 1);
      // Programmatic close (× / button): remove the guard entry we added.
      if (armed) {
        armed = false;
        suppress += 1;
        window.history.back();
      }
    };
  }, [isOpen]);
}
