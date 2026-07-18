/**
 * O MOTOR da paleta de comandos, extraído para uma única fonte.
 *
 * Duas superfícies o consomem — o overlay `Ctrl+K` (CommandPalette) e o campo de
 * busca do menu "O NEXO" (§3.3). O plano do NEXO exige "o MESMO motor do Ctrl+K,
 * uma superfície e não duas": é literalmente este hook. Quem digita 'cal' no
 * NEXO acha o Calendário pela mesma lógica de quem digita no Ctrl+K — porque é a
 * mesma função, não uma cópia que um dia diverge.
 *
 * O que fica AQUI: a montagem das linhas (ações fuzzy + resultados FTS + o aporte
 * paramétrico), o debounce da busca e a ordem. O que fica na SUPERFÍCIE: o campo,
 * a seleção com teclado e o desenho — porque o overlay e o menu os desenham
 * diferente.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  CheckSquare,
  FolderKanban,
  Target,
  Repeat,
  Calendar as CalendarIcon,
  Flag,
  Paperclip,
  Inbox as InboxIcon,
  PiggyBank,
  BookOpen,
  CalendarRange,
  Trophy,
  Award,
  GraduationCap,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { NAV_ITEMS, SECONDARY_ROUTES } from "../../app/navigation";
import { listAccounts, listAreas, search, type Kind } from "../../lib/ipc";
import { SPHERE_SECTIONS } from "../spheres/sections";
import { sphereIcon } from "../hub/SphereIcon";
import { parseAporte } from "../finance/parseAporte";
import { useAporte } from "../../stores/aporte";
import { useFocus } from "../../stores/focus";
import { fuzzyScore } from "./fuzzy";

/** Espera o suficiente para não consultar a cada tecla, curto o bastante para
 *  a busca ainda parecer instantânea. */
const DEBOUNCE_MS = 120;

export interface CommandRow {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

export const KIND_ICON: Record<Kind, LucideIcon> = {
  note: FileText,
  task: CheckSquare,
  project: FolderKanban,
  goal: Target,
  habit: Repeat,
  routine: Repeat,
  event: CalendarIcon,
  file: Paperclip,
  inbox_item: InboxIcon,
  milestone: Flag,
  fin_goal: PiggyBank,
  book: BookOpen,
  annual_goal: CalendarRange,
  challenge: Trophy,
  skill: Award,
  subject: GraduationCap,
};

export const KIND_LABEL: Record<Kind, string> = {
  note: "Nota",
  task: "Tarefa",
  project: "Projeto",
  goal: "Meta",
  habit: "Hábito",
  routine: "Rotina",
  event: "Evento",
  file: "Arquivo",
  inbox_item: "Inbox",
  milestone: "Sub-desafio",
  fin_goal: "Caixinha",
  book: "Livro",
  annual_goal: "Meta anual",
  challenge: "Temporada",
  skill: "Competência",
  subject: "Matéria",
};

export interface CommandRows {
  rows: CommandRow[];
  /** Quantas das primeiras linhas são ações (o resto são resultados FTS). */
  actionCount: number;
  /** Quantos resultados FTS há (para desenhar o rótulo "Resultados"). */
  resultCount: number;
}

/**
 * Monta a lista de linhas para uma query. `enabled` deve seguir a abertura da
 * superfície — fechada, as queries dormem.
 */
export function useCommandRows(query: string, enabled: boolean): CommandRows {
  const navigate = useNavigate();
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data: hits = [] } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => search(debounced, 8),
    enabled: enabled && debounced.trim().length > 0,
    staleTime: 5_000,
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
    enabled,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
    enabled,
    staleTime: 5 * 60_000,
  });

  const actions = useMemo<CommandRow[]>(
    () => [
      {
        id: "focus:start",
        label: "Iniciar foco",
        hint: "Modo Foco",
        icon: Timer,
        run: () => useFocus.getState().start(),
      },
      ...NAV_ITEMS.map((item) => ({
        id: `nav:${item.path}`,
        label: `Ir para ${item.label}`,
        hint: `G ${item.jumpKey.toUpperCase()}`,
        icon: item.icon,
        run: () => navigate(item.path),
      })),
      ...SECONDARY_ROUTES.map((item) => ({
        id: `nav:${item.path}`,
        label: `Ir para ${item.label}`,
        hint: `G ${item.jumpKey.toUpperCase()}`,
        icon: item.icon,
        run: () => navigate(item.path),
      })),
      ...areas.map((area) => ({
        id: `sphere:${area.id}`,
        label: `Ir para ${area.name}`,
        hint: "Esfera",
        icon: sphereIcon(area.icon),
        run: () => navigate(`/sphere/${area.id}`),
      })),
      ...areas.flatMap((area) =>
        SPHERE_SECTIONS[area.template].map((section) => ({
          id: `section:${area.id}:${section.key}`,
          label: `${area.name} · ${section.label}`,
          hint: "Seção",
          icon: section.icon,
          run: () => navigate(`/sphere/${area.id}?s=${section.key}`),
        })),
      ),
    ],
    [areas, navigate],
  );

  const matchedActions = useMemo(() => {
    return actions
      .map((a) => ({ a, score: fuzzyScore(query, a.label) }))
      .filter((r): r is { a: CommandRow; score: number } => r.score !== null)
      .sort((x, y) => x.score - y.score)
      .slice(0, 6)
      .map((r) => r.a);
  }, [actions, query]);

  // "aportar 500 no btg" — o comando em linguagem natural. Uma linha só, no topo,
  // quando a query casa: valor + banco viram os defaults do modal.
  const aporteRow = useMemo<CommandRow | null>(() => {
    const parsed = parseAporte(query, accounts);
    if (!parsed) return null;
    return {
      id: "aporte:quick",
      label: parsed.label,
      hint: "Aporte",
      icon: PiggyBank,
      run: () =>
        useAporte
          .getState()
          .openAporte({ amountCents: parsed.amountCents, accountId: parsed.accountId }),
    };
  }, [query, accounts]);

  const resultRows = useMemo<CommandRow[]>(
    () =>
      hits.map((h) => ({
        id: `node:${h.nodeId}`,
        label: h.title,
        hint: KIND_LABEL[h.kind] ?? h.kind,
        icon: KIND_ICON[h.kind] ?? FileText,
        run: () => navigate(pathForKind(h.kind)),
      })),
    [hits, navigate],
  );

  return useMemo(() => {
    const rows = [...(aporteRow ? [aporteRow] : []), ...matchedActions, ...resultRows];
    return {
      rows,
      actionCount: matchedActions.length,
      resultCount: resultRows.length,
    };
  }, [aporteRow, matchedActions, resultRows]);
}

export function pathForKind(kind: Kind): string {
  switch (kind) {
    case "inbox_item":
      return "/inbox";
    case "task":
    case "project":
    case "goal":
      return "/goals";
    case "habit":
    case "routine":
      return "/habits";
    case "event":
      return "/calendar";
    default:
      return "/notes";
  }
}
