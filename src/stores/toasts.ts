/**
 * Toasts.
 *
 * Regra da constituição: um toast de erro NUNCA engole a causa. `message`
 * carrega o texto que veio do Rust, verbatim — não um "algo deu errado".
 */

import { create } from "zustand";
import { toNexusError } from "../lib/ipc";

export type ToastKind = "error" | "success";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  pushError: (e: unknown) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    // Erros ficam mais tempo: têm mais texto para ler e mais consequência.
    window.setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      kind === "error" ? 6000 : 2500,
    );
  },
  pushError: (e) => {
    const err = toNexusError(e);
    const id = nextId++;
    set((s) => ({
      toasts: [...s.toasts, { id, kind: "error", message: err.message }],
    }));
    window.setTimeout(
      () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      6000,
    );
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
