import { useEffect, useRef } from 'react';

type Handler = (event: KeyboardEvent) => void;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Keyboard shortcuts of the cash register (docs/DECISOES.md D025). Keys are `KeyboardEvent.key`
 * values ("F2", "F4", "1"...). Function keys always work; other keys are ignored while the user
 * is typing in a field, so "1" types a digit in the amount instead of choosing a method.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true): void {
  const latest = useRef(map);
  latest.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Already handled (e.g. by a dialog that just closed): never act twice on one key.
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const handler = latest.current[event.key];
      if (!handler) return;
      if (!/^F\d+$/.test(event.key) && isTyping(event.target)) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
