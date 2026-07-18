/**
 * A tradução do ledger para a tela: cada evento vira um ícone, uma cor e um
 * rótulo, e cada `payload` vira uma frase.
 *
 * O ledger é auto-suficiente por decisão de arquitetura (ADR-0023/0027): o
 * `titleSnapshot` é o texto que o evento tinha QUANDO aconteceu, e a Timeline o
 * mostra verbatim — nunca faz JOIN nem refetch para "corrigir" um título que já
 * mudou. Este módulo só escolhe COMO desenhar o que já está gravado.
 *
 * A cor aqui é sempre uma CSS var. A Timeline é uma tela global (não é de uma
 * Esfera), então o padrão é `--accent`; conquistas e marcos puxam o dourado do
 * `--warning`, e o que fecha um ciclo puxa o `--success`.
 */

import {
  Archive,
  Award,
  BookOpen,
  CalendarCheck,
  Check,
  CheckCircle2,
  Circle,
  CircleSlash,
  Coins,
  FolderInput,
  PencilLine,
  PiggyBank,
  Plus,
  RefreshCw,
  Flag,
  Trash2,
  TrendingUp,
  Trophy,
  Type,
  type LucideIcon,
} from "lucide-react";

import { formatMoney } from "../../lib/format";
import type { LedgerEntry } from "../../lib/ipc";

export interface LedgerMeta {
  icon: LucideIcon;
  /** Uma CSS var — nunca um hex. */
  tint: string;
  /** O nome do gesto, em pt-BR curto: "Concluído", "Aporte", "Check". */
  label: string;
}

/** Rótulo humano de cada `entityKind` — usado nos filtros e no fallback. */
export const KIND_LABEL: Record<string, string> = {
  note: "Nota",
  task: "Tarefa",
  project: "Projeto",
  goal: "Meta",
  habit: "Hábito",
  routine: "Rotina",
  event: "Evento",
  file: "Arquivo",
  inbox_item: "Entrada",
  milestone: "Sub-desafio",
  fin_goal: "Caixinha",
  book: "Livro",
  contribution: "Aporte",
  career_milestone: "Marco",
};

const ASSET_CLASS_LABEL: Record<string, string> = {
  renda_fixa: "Renda fixa",
  acoes: "Ações",
  fiis: "FIIs",
  etf_exterior: "ETF exterior",
  cripto: "Cripto",
  reserva: "Reserva",
  outros: "Outros",
};

/** O desenho de cada `eventType`, quando o `entityKind` não pede algo especial. */
const EVENT_META: Record<string, LedgerMeta> = {
  created: { icon: Plus, tint: "var(--accent)", label: "Criado" },
  completed: { icon: CheckCircle2, tint: "var(--success)", label: "Concluído" },
  checked: { icon: Check, tint: "var(--accent)", label: "Check" },
  skipped: { icon: CircleSlash, tint: "var(--text-tertiary)", label: "Pulado" },
  value_recorded: { icon: TrendingUp, tint: "var(--accent)", label: "Medição" },
  status_changed: { icon: RefreshCw, tint: "var(--accent)", label: "Status" },
  archived: { icon: Archive, tint: "var(--text-tertiary)", label: "Arquivado" },
  goal_checkpoint: { icon: Flag, tint: "var(--warning)", label: "Checkpoint" },
  note_edited: { icon: PencilLine, tint: "var(--accent)", label: "Nota" },
  triaged: { icon: FolderInput, tint: "var(--accent)", label: "Triado" },
  renamed: { icon: Type, tint: "var(--text-tertiary)", label: "Renomeado" },
  deleted: { icon: Trash2, tint: "var(--danger)", label: "Excluído" },
  weekly_review_completed: {
    icon: CalendarCheck,
    tint: "var(--success)",
    label: "Revisão",
  },
};

/** Parser defensivo: um payload ilegível nunca derruba uma linha do feed. */
export function parsePayload(entry: LedgerEntry): Record<string, unknown> {
  try {
    const p: unknown = JSON.parse(entry.payload);
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function prettify(eventType: string): string {
  const s = eventType.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ícone + cor + rótulo de uma linha. */
export function meta(entry: LedgerEntry): LedgerMeta {
  if (entry.entityKind === "contribution") {
    const cents = asNumber(parsePayload(entry).amountCents);
    if (cents != null && cents < 0) {
      return { icon: Coins, tint: "var(--warning)", label: "Resgate" };
    }
    return { icon: PiggyBank, tint: "var(--accent)", label: "Aporte" };
  }

  if (entry.entityKind === "career_milestone") {
    return { icon: Award, tint: "var(--warning)", label: "Marco" };
  }

  if (entry.eventType === "completed") {
    const p = parsePayload(entry);
    // Uma meta fechada e uma conquista carregam o troféu dourado; um livro
    // terminado, o seu próprio ícone.
    if (asString(p.achievement) || entry.entityKind === "goal") {
      return { icon: Trophy, tint: "var(--warning)", label: "Conquista" };
    }
    if (entry.entityKind === "book") {
      return { icon: BookOpen, tint: "var(--success)", label: "Livro lido" };
    }
  }

  return (
    EVENT_META[entry.eventType] ?? {
      icon: Circle,
      tint: "var(--accent)",
      label: prettify(entry.eventType),
    }
  );
}

/**
 * A linha principal de um evento.
 *
 * Quase sempre é o `titleSnapshot` verbatim. As exceções são os fatos cujo herói
 * é um número: um aporte é "Aporte de R$ 500,00", não o nome da conta.
 */
export function describe(entry: LedgerEntry): string {
  const p = parsePayload(entry);
  const title = entry.titleSnapshot?.trim();

  if (entry.entityKind === "contribution") {
    const cents = asNumber(p.amountCents);
    if (cents != null) {
      const money = formatMoney(Math.abs(cents));
      return cents < 0 ? `Resgate de ${money}` : `Aporte de ${money}`;
    }
  }

  // Uma conquista (`completed` com `achievement`) já tem `titleSnapshot` humano
  // — "Terminou 'X' (5/5)", "Objetivo alcançado — Y". A chave crua do
  // payload ('book_finished') é vocabulário interno, não texto de tela.
  return title || KIND_LABEL[entry.entityKind] || prettify(entry.eventType);
}

/**
 * A segunda linha opcional — o contexto que não cabe no título.
 *
 * O aporte revela a conta e a classe; o marco de carreira, a nota; o checkpoint,
 * o valor medido. `null` quando não há nada a acrescentar.
 */
export function detail(entry: LedgerEntry): string | null {
  const p = parsePayload(entry);

  if (entry.entityKind === "contribution") {
    const parts: string[] = [];
    const title = entry.titleSnapshot?.trim();
    if (title) parts.push(title);
    const cls = asString(p.assetClass);
    if (cls) parts.push(ASSET_CLASS_LABEL[cls] ?? cls);
    return parts.length ? parts.join(" · ") : null;
  }

  if (entry.eventType === "goal_checkpoint") {
    const value = asNumber(p.value);
    if (value != null) return `mediu ${value}`;
  }

  return asString(p.note);
}

/**
 * O texto que os filtros vasculham: título, descrição e detalhe juntos, para a
 * busca por "nubank" achar um aporte cujo título é só o banco.
 */
export function searchHaystack(entry: LedgerEntry): string {
  return `${entry.titleSnapshot} ${describe(entry)} ${detail(entry) ?? ""} ${
    KIND_LABEL[entry.entityKind] ?? ""
  }`.toLowerCase();
}
