/**
 * O intento de registrar um aporte, vindo de qualquer lugar.
 *
 * O Ctrl+K ("aportar 500 no btg") tem que abrir o modal de aporte esteja o
 * usuário onde estiver — no Hub, no Calendário, em outra Esfera. Um modal preso
 * à tela das Finanças só funcionaria já dentro dela. Por isso o gatilho é um
 * store global e o modal mora no Shell (`AporteHost`), acima de toda rota.
 *
 * É estado de CHROME (um overlay aberto/fechado), não dado do usuário — Zustand,
 * como o tema e os toasts, não TanStack Query.
 */

import { create } from "zustand";

export interface AporteDefaults {
  amountCents?: number;
  accountId?: string;
}

interface AporteState {
  open: boolean;
  defaults: AporteDefaults;
  openAporte: (defaults?: AporteDefaults) => void;
  close: () => void;
}

export const useAporte = create<AporteState>((set) => ({
  open: false,
  defaults: {},
  openAporte: (defaults = {}) => set({ open: true, defaults }),
  close: () => set({ open: false, defaults: {} }),
}));
