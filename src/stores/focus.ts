/**
 * O timer de foco — um pomodoro que atravessa qualquer rota.
 *
 * Como o aporte (`stores/aporte`), o Modo Foco é disparável de qualquer lugar: um
 * botão "Focar" numa tarefa, o Ctrl+K, a tela de Foco. Por isso o estado do timer
 * é um store global e o relógio mora no Shell (`FocusHost`), acima de toda rota —
 * navegar entre telas não pausa nem perde a contagem.
 *
 * É estado de CHROME (um overlay com um relógio correndo), não dado do usuário —
 * Zustand, como o tema e os toasts. O FATO só nasce quando o bloco ZERA: o
 * `FocusHost` chama `log_focus_session` na transição para `done`. Abandonar
 * (`cancel`) não grava nada — a semântica do pomodoro e o guard contra o farm
 * (ADR-0052).
 */

import { create } from "zustand";

export type FocusStatus = "idle" | "running" | "paused" | "done";

/** As durações oferecidas de bloco, em minutos. A do meio é o pomodoro clássico. */
export const FOCUS_PRESETS = [15, 25, 50] as const;

/** O que está sendo focado — uma tarefa resolvida, ou só um rótulo livre. */
export interface FocusContext {
  taskId: string | null;
  taskTitle: string | null;
  label: string | null;
}

interface FocusState {
  /** Se o overlay do timer está montado. `status` diz em que fase ele está. */
  open: boolean;
  status: FocusStatus;
  ctx: FocusContext;
  /** O bloco configurado, em minutos — o que será gravado ao concluir. */
  durationMin: number;
  /** A contagem regressiva, em segundos. */
  remainingSec: number;
  minimized: boolean;

  /** Abre o timer (ainda parado) com um contexto e uma duração inicial. */
  start: (opts?: {
    taskId?: string | null;
    taskTitle?: string | null;
    label?: string | null;
    durationMin?: number;
  }) => void;
  /** Troca a duração — só faz sentido antes de começar a correr. */
  setDuration: (min: number) => void;
  setLabel: (label: string) => void;
  /** Começa (ou recomeça) a contagem. */
  run: () => void;
  pause: () => void;
  /** Abandona o bloco — NÃO grava nada. */
  cancel: () => void;
  /** Um segundo passou (chamado pelo FocusHost); ao zerar, vira `done`. */
  tick: () => void;
  /** Fecha o estado de conclusão (depois de gravado e celebrado). */
  dismissDone: () => void;
  minimize: () => void;
  expand: () => void;
}

const DEFAULT_MIN = 25;

export const useFocus = create<FocusState>((set, get) => ({
  open: false,
  status: "idle",
  ctx: { taskId: null, taskTitle: null, label: null },
  durationMin: DEFAULT_MIN,
  remainingSec: DEFAULT_MIN * 60,
  minimized: false,

  start: (opts = {}) => {
    const durationMin = opts.durationMin ?? DEFAULT_MIN;
    set({
      open: true,
      status: "idle",
      ctx: {
        taskId: opts.taskId ?? null,
        taskTitle: opts.taskTitle ?? null,
        label: opts.label ?? null,
      },
      durationMin,
      remainingSec: durationMin * 60,
      minimized: false,
    });
  },

  setDuration: (min) => {
    // Só antes de correr: mudar o bloco no meio bagunçaria o que será gravado.
    if (get().status === "running") return;
    const clamped = Math.max(1, Math.min(180, Math.round(min)));
    set({ durationMin: clamped, remainingSec: clamped * 60, status: "idle" });
  },

  setLabel: (label) =>
    set((s) => ({ ctx: { ...s.ctx, label: label.trim() || null } })),

  run: () => set({ status: "running", minimized: false }),
  pause: () => set({ status: "paused" }),

  cancel: () =>
    set({
      open: false,
      status: "idle",
      ctx: { taskId: null, taskTitle: null, label: null },
      durationMin: DEFAULT_MIN,
      remainingSec: DEFAULT_MIN * 60,
      minimized: false,
    }),

  tick: () => {
    const { status, remainingSec } = get();
    if (status !== "running") return;
    if (remainingSec <= 1) {
      set({ remainingSec: 0, status: "done" });
    } else {
      set({ remainingSec: remainingSec - 1 });
    }
  },

  dismissDone: () =>
    set({
      open: false,
      status: "idle",
      ctx: { taskId: null, taskTitle: null, label: null },
      durationMin: DEFAULT_MIN,
      remainingSec: DEFAULT_MIN * 60,
      minimized: false,
    }),

  minimize: () => set({ minimized: true }),
  expand: () => set({ minimized: false }),
}));
