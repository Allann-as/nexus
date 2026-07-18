/**
 * O estado da tela de bloqueio (M5.5 §3.5).
 *
 * `enabled` reflete o backend (há um PIN ativo?); `locked` é o estado da sessão —
 * o app está bloqueado AGORA? No boot, `LockGate` lê `lock_status` e, se ligado,
 * abre bloqueado. `Ctrl+L` bloqueia à mão (só faz sentido com um PIN ativo).
 *
 * É estado de CHROME (um overlay), não dado do usuário — Zustand, como o tema, o
 * foco e o aporte. O veredito do PIN mora no backend; aqui só guardamos se a
 * cortina está no ar.
 */

import { create } from "zustand";

interface LockState {
  /** Há um PIN ativo (vindo do backend). */
  enabled: boolean;
  /** A tela está bloqueada agora? */
  locked: boolean;
  setEnabled: (v: boolean) => void;
  /** Bloqueia — no-op se não há PIN ativo. */
  lock: () => void;
  unlock: () => void;
}

export const useLock = create<LockState>((set, get) => ({
  enabled: false,
  locked: false,
  setEnabled: (enabled) => set({ enabled }),
  lock: () => {
    if (get().enabled) set({ locked: true });
  },
  unlock: () => set({ locked: false }),
}));
