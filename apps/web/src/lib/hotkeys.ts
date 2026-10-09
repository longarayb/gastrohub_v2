import { useEffect, useRef } from 'react';

type Handler = (event: KeyboardEvent) => void;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * One keyboard map for the whole panel (docs/DESIGN.md, "Mapa de atalhos"): each key means the
 * same thing on every screen. Sensitive actions (cash withdrawal, cancellations, refunds) have
 * no key. F1, F3, F5, F10, F11 and F12 are left to the browser.
 */
export const SHORTCUTS = [
  { key: 'F2', label: 'Buscar', where: 'novo pedido (produto), caixa (conta), pedidos' },
  { key: 'F4', label: 'Receber', where: 'detalhe do pedido; caixa (conta destacada)' },
  { key: 'F6', label: 'Dados do pedido', where: 'novo pedido: tipo (← →), depois Tab' },
  { key: 'F7', label: 'Observação', where: 'novo pedido e janela do item' },
  { key: 'F8', label: 'Imprimir', where: 'pré-conta (mesa); relatório parcial (caixa)' },
  {
    key: 'F9',
    label: 'Confirmar a ação principal',
    where: 'criar pedido, adicionar item, registrar pagamento, fechar conta paga',
  },
  { key: 'Enter', label: 'Abrir ou escolher o destacado', where: 'listas e buscas' },
  { key: 'Esc', label: 'Voltar / fechar', where: 'janelas' },
  { key: '1–7', label: 'Forma de pagamento', where: 'janela de pagamento' },
  { key: '+ −', label: 'Quantidade', where: 'janela do item' },
  { key: '?', label: 'Esta lista de atalhos', where: 'qualquer tela' },
] as const;

/**
 * F9 confirms; a second F9 within this time (a double press, or a press while the next screen
 * opens) is ignored, so it never confirms the next screen's action.
 */
export const CONFIRM_COOLDOWN_MS = 1000;
let confirmLockedUntil = 0;

/** Locks F9 for the cooldown (after a confirmation, or when a screen opens). */
export function lockConfirm(ms = CONFIRM_COOLDOWN_MS): void {
  confirmLockedUntil = Math.max(confirmLockedUntil, performance.now() + ms);
}

/**
 * Runs a confirmation (F9) unless F9 is in the cooldown; then starts a new cooldown. Use it in
 * every F9 handler, including the ones of dialogs that handle keys themselves.
 */
export function confirmOnce(run: () => void): boolean {
  if (performance.now() < confirmLockedUntil) return false;
  lockConfirm();
  run();
  return true;
}

/**
 * Screen shortcuts. Keys are `KeyboardEvent.key` values ("F2", "F4", "1"...). Function keys
 * always work; other keys are ignored while the user is typing in a field, so "1" types a digit
 * in the amount instead of choosing a method. F9 goes through `confirmOnce`.
 */
export function useHotkeys(map: Record<string, Handler>, enabled = true): void {
  const latest = useRef(map);
  latest.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const handler = latest.current[event.key];
      if (!handler) return;
      if (!/^F\d+$/.test(event.key) && isTyping(event.target)) return;
      event.preventDefault();
      if (event.key === 'F9') confirmOnce(() => handler(event));
      else handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Panel-wide guard (AppShell): F6 and F7 never reach the browser (address bar, caret browsing
 * prompt) on any screen, also where they have no action; F9 locks while a new screen opens.
 * Tested in real Edge and Chrome on Windows (docs/DESIGN.md).
 */
export function useBrowserKeyGuard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F6' || event.key === 'F7') event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
