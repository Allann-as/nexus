/**
 * The global keyboard layer. Keyboard-first is a constitutional rule, so the
 * shortcut table lives at the shell level rather than being sprinkled through
 * features.
 *
 * Handles `Ctrl+K` (palette) and the `G+<key>` jump chords.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { NAV_ITEMS } from "./navigation";

/** Chord window: long enough to be unhurried, short enough that a stray `G`
 *  followed by typing later never teleports you somewhere. */
const CHORD_MS = 800;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
}

export function useKeyboard({ onOpenPalette }: { onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K must work even from inside a field — it is the way out.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Everything below is a bare letter, so it must never fire while typing.
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (pendingG.current) {
        pendingG.current = false;
        window.clearTimeout(timer.current);
        const target = NAV_ITEMS.find((i) => i.jumpKey === key);
        if (target) {
          e.preventDefault();
          navigate(target.path);
        }
        return;
      }

      if (key === "g") {
        pendingG.current = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          pendingG.current = false;
        }, CHORD_MS);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer.current);
    };
  }, [navigate, onOpenPalette]);
}
