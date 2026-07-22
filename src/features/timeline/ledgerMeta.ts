/**
 * A tradução do ledger para a tela: cada evento vira um ícone, uma cor e um
 * rótulo, e cada `payload` vira uma frase.
 *
 * O ledger é auto-suficiente por decisão de arquitetura (ADR-0023/0027): o
 * `titleSnapshot` é o texto que o evento tinha QUANDO aconteceu, e a Timeline o
 * mostra verbatim — nunca faz JOIN nem refetch para "corrigir" um título que já
 * mudou. Este módulo só escolhe COMO desenhar o que já está gravado.
 *
 * **O vocabulário é FECHADO e tem que estar inteiro aqui.** `EventType` tem 22
 * variantes e `LedgerEntityKind` tem 10; este arquivo conhecia 14 e 15, e as
 * outras caíam num `prettify()` que escrevia a chave interna na tela — a Máquina
 * do Tempo dizia "Achievement unlocked" e "Focus session logged" em inglês, no
 * meio de um feed em português. `ledgerMeta.test.ts` guarda a lista contra o
 * enum do Rust. Ver ADR-0104.
 *
 * A cor aqui é sempre uma CSS var (a exceção é o metal de um tier, que vem de
 * `design-system/tiers`). A Timeline é uma tela global (não é de uma Esfera),
 * então o padrão é `--accent`; conquistas e marcos puxam o dourado do
 * `--warning`, e o que fecha um ciclo puxa o `--success`.
 */

import {
  Archive,
  Award,
  BookOpen,
  Brain,
  CalendarCheck,
  Check,
  CheckCircle2,
  Circle,
  CircleSlash,
  Coins,
  Flag,
  FolderInput,
  Gauge,
  GraduationCap,
  Medal,
  PencilLine,
  PiggyBank,
  Plus,
  RefreshCw,
  Swords,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  Type,
  type LucideIcon,
} from "lucide-react";

import { bankName } from "../../design-system/bankBrand";
import { lucideByName } from "../../design-system/DynamicIcon";
import { tierColor } from "../../design-system/tiers";
import { formatMoney } from "../../lib/format";
import type { LedgerEntry } from "../../lib/ipc";

export interface LedgerMeta {
  icon: LucideIcon;
  /** Uma CSS var — ou o metal de um tier, que é um hex por ser metal. */
  tint: string;
  /** O nome do gesto, em pt-BR curto: "Concluído", "Aporte", "Check". */
  label: string;
}

/**
 * O vocabulário do backend, por extenso.
 *
 * Copiado de `domain::ledger` de propósito: o teste desta lista falha quando o
 * Rust ganha uma variante que ninguém traduziu, que é exatamente o momento em
 * que se quer ser avisado. As strings estão gravadas no banco do usuário para
 * sempre — mudar uma aqui não muda nada lá.
 */
export const ALL_EVENT_TYPES = [
  "created",
  "completed",
  "checked",
  "skipped",
  "value_recorded",
  "status_changed",
  "archived",
  "goal_checkpoint",
  "note_edited",
  "triaged",
  "renamed",
  "deleted",
  "weekly_review_completed",
  "nexus_score",
  "achievement_unlocked",
  "challenge_started",
  "challenge_completed",
  "skill_level_up",
  "study_session_logged",
  "focus_session_logged",
  "record_broken",
  "skill_checkin",
] as const;

/** Os `entity_kind` que não são nodes, mais os `Kind` de node. */
export const ALL_ENTITY_KINDS = [
  // Node(Kind)
  "note",
  "task",
  "project",
  "goal",
  "habit",
  "routine",
  "event",
  "file",
  "inbox_item",
  "milestone",
  "fin_goal",
  "book",
  "subject",
  "challenge",
  "annual_goal",
  "skill",
  // fatos sem node
  "contribution",
  "career_milestone",
  "achievement",
  "daily_score",
  "study_session",
  "focus_session",
  "weekly_review",
  "personal_record",
  "skill_checkin",
] as const;

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
  subject: "Matéria",
  challenge: "Temporada",
  annual_goal: "Meta anual",
  skill: "Competência",
  contribution: "Aporte",
  career_milestone: "Marco",
  achievement: "Conquista",
  daily_score: "Score",
  study_session: "Estudo",
  focus_session: "Foco",
  weekly_review: "Revisão",
  personal_record: "Recorde",
  skill_checkin: "Check-in",
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
  record_broken: { icon: Medal, tint: "var(--warning)", label: "Recorde" },
  // As oito que faltavam. Todas existem no banco desde o M4.5–v1.2 e todas
  // apareciam no feed com a chave crua em inglês.
  nexus_score: { icon: Gauge, tint: "var(--text-tertiary)", label: "Score" },
  achievement_unlocked: { icon: Trophy, tint: "var(--warning)", label: "Conquista" },
  challenge_started: { icon: Swords, tint: "var(--accent)", label: "Temporada" },
  challenge_completed: { icon: Trophy, tint: "var(--success)", label: "Temporada vencida" },
  skill_level_up: { icon: TrendingUp, tint: "var(--success)", label: "Nível" },
  study_session_logged: { icon: GraduationCap, tint: "var(--accent)", label: "Estudo" },
  focus_session_logged: { icon: Timer, tint: "var(--accent)", label: "Foco" },
  skill_checkin: { icon: Brain, tint: "var(--accent)", label: "Check-in" },
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
  const p = parsePayload(entry);

  if (entry.entityKind === "contribution") {
    const cents = asNumber(p.amountCents);
    if (cents != null && cents < 0) {
      return { icon: Coins, tint: "var(--warning)", label: "Resgate" };
    }
    return { icon: PiggyBank, tint: "var(--accent)", label: "Aporte" };
  }

  if (entry.entityKind === "career_milestone") {
    return { icon: Award, tint: "var(--warning)", label: "Marco" };
  }

  /* A conquista traz no payload o NOME do ícone Lucide e o TIER — os mesmos que
     a galeria usa. Desenhá-la com um troféu genérico dourado jogaria fora os
     dois: no feed, "Uma semana" (bronze, chama) e "Meio ano investindo" (prata,
     tendência) sairiam idênticas. O metal também é a única pista de raridade que
     cabe numa linha. */
  if (entry.eventType === "achievement_unlocked") {
    return {
      icon: lucideByName(asString(p.icon)),
      tint: tierColor(asString(p.tier)),
      label: "Conquista",
    };
  }

  if (entry.eventType === "completed") {
    // Um livro terminado carrega o próprio ícone; uma meta fechada, o troféu.
    if (entry.entityKind === "book") {
      return { icon: BookOpen, tint: "var(--success)", label: "Livro lido" };
    }
    if (entry.entityKind === "goal") {
      return { icon: Trophy, tint: "var(--warning)", label: "Meta batida" };
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
 *
 * Cada `if` daqui existe porque o payload TRAZIA aquilo e a tela descartava.
 */
export function detail(entry: LedgerEntry): string | null {
  const p = parsePayload(entry);

  /* O aporte revela a CONTA e a classe.

     A conta vem do `accountId` do payload, não do `titleSnapshot`: o título de
     uma contribuição é a própria frase que o backend montou — "Aporte de R$
     1200.00", com ponto decimal e sem separador de milhar — e a linha de cima
     JÁ a reescreve em pt-BR a partir dos centavos. Empurrá-lo para cá repetia a
     primeira linha embaixo dela, pior formatada ("Resgate de R$ -150.00"), e
     ainda por cima no lugar reservado à conta, que sumia. Achado dirigindo.

     Conta que o usuário criou não tem nome no ledger (só um id), e aí a linha
     mostra só a classe — omitir é honesto, inventar não seria. */
  if (entry.entityKind === "contribution") {
    const parts: string[] = [];
    const account = bankName(asString(p.accountId));
    if (account) parts.push(account);
    const cls = asString(p.assetClass);
    if (cls) parts.push(ASSET_CLASS_LABEL[cls] ?? cls);
    return parts.length ? parts.join(" · ") : null;
  }

  if (entry.eventType === "goal_checkpoint") {
    const value = asNumber(p.value);
    const target = asNumber(p.target);
    // A meta anual grava o alvo junto: "5 de 12" lê muito melhor que "mediu 5",
    // e o denominador já estava no payload.
    if (value != null && target != null) return `${fmt(value)} de ${fmt(target)}`;
    if (value != null) return `mediu ${fmt(value)}`;
  }

  // A temporada declara o alvo e o fim — sem eles, "90 dias de treino" não diz
  // do que é o desafio nem até quando ele vale.
  if (entry.eventType === "challenge_started") {
    const target = asNumber(p.targetCount);
    const ends = asString(p.endsOn);
    const parts: string[] = [];
    if (target != null) parts.push(`alvo ${fmt(target)}`);
    if (ends) parts.push(`até ${dayBr(ends)}`);
    if (parts.length) return parts.join(" · ");
  }

  /* O bloco de foco tem duração e (às vezes) a tarefa em que foi gasto; o
     `titleSnapshot` dele é só o rótulo do bloco. A sessão de ESTUDO não entra
     aqui de propósito: o backend já escreve "Estudou 45 min · Cálculo" no
     título, e repetir os minutos abaixo seria enfeite, não dado. */
  if (entry.eventType === "focus_session_logged") {
    const minutes = asNumber(p.minutes);
    if (minutes != null) return `${fmt(minutes)} min`;
  }

  // O check-in de competência grava as três respostas; a auto-avaliação é a que
  // move o nível (`domain::skill_level`), então é a que a linha mostra.
  if (entry.eventType === "skill_checkin") {
    const stars = asNumber(p.stars);
    const applied = asNumber(p.applied);
    const parts: string[] = [];
    if (stars != null) parts.push(`${fmt(stars)}/5`);
    if (applied != null) parts.push(`aplicou ${fmt(applied)}x`);
    if (parts.length) return parts.join(" · ");
  }

  /* `skill_level_up` NÃO ganha detalhe: o payload dele é `{}` — o nível é a
     POSIÇÃO na sequência de eventos, lida por query (skill_repo), e não há nada
     na linha para mostrar. Escrever "nível N" aqui seria inventar. */

  // O recorde traz o período que o alcançou ("semana de 06/07"); o número
  // formatado (dinheiro, horas) vive na tela de Recordes, não aqui.
  if (entry.entityKind === "personal_record") {
    return asString(p.context);
  }

  return asString(p.note);
}

/** Número sem casa decimal inútil: 12 e não "12.0"; 7,5 e não "7.5". */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

/** 'YYYY-MM-DD' → 'DD/MM'. Puro, sem `Date` (ADR-0098: datas por `fromDay`). */
function dayBr(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/**
 * O Nexus Score congelado de um dia, se esta linha for ele.
 *
 * Um `nexus_score` por dia é 1 em cada 10 linhas do feed, e ele não é um ATO do
 * usuário: é a medida do dia inteiro. Como linha, empurrava o que a pessoa fez
 * para baixo; como número no cabeçalho do dia, ele vira a régua que o plano
 * pedia. O dado não se perde — muda de lugar. Ver ADR-0104.
 */
export function dayScore(entry: LedgerEntry): number | null {
  if (entry.eventType !== "nexus_score") return null;
  return asNumber(parsePayload(entry).value);
}

/**
 * O texto que os filtros vasculham: título, descrição e detalhe juntos, para a
 * busca por "nubank" achar um aporte cujo título é só o banco.
 */
export function searchHaystack(entry: LedgerEntry): string {
  return `${entry.titleSnapshot} ${describe(entry)} ${detail(entry) ?? ""} ${
    KIND_LABEL[entry.entityKind] ?? ""
  } ${meta(entry).label}`.toLowerCase();
}
