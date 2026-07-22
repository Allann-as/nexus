/**
 * O catálogo de seções de cada Esfera — a fonte única da navegação interna.
 *
 * Assim como `app/navigation.ts` é a fonte da navegação GLOBAL, este arquivo é a
 * da navegação CONTEXTUAL: o SphereNav desenha a partir daqui, o SphereScreen
 * resolve o conteúdo a partir daqui, e a Command Palette registra cada seção como
 * um destino (Ctrl+K alcança qualquer seção direto — regra da constituição).
 *
 * A anatomia é ÚNICA para todas as Esferas (ADR-0044): o que muda por Esfera é a
 * cor, os ícones e as seções — nunca o desenho. Uma seção = ícone Lucide + rótulo
 * + um micro-indicador de estado REAL (vindo de dados; omitido quando não há dado,
 * nunca inventado).
 */

import {
  LayoutDashboard,
  Target,
  ListChecks,
  Dumbbell,
  Stethoscope,
  Banknote,
  PiggyBank,
  FolderKanban,
  Award,
  Languages,
  GraduationCap,
  MonitorPlay,
  BookOpen,
  Brain,
  CalendarDays,
  Flame,
  Milestone,
  type LucideIcon,
} from "lucide-react";

import type { SphereCard, Template } from "../../lib/ipc";

/**
 * De onde um micro-indicador tira o número. `card` = já vem no overview do Hub
 * (custo zero). `*_count` = uma contagem barata por `count_nodes`. Uma seção sem
 * `indicator` simplesmente não mostra nada — é o caso honesto, não um zero falso.
 */
export type IndicatorKind =
  | "streak" // maior streak vivo da Esfera (card)
  | "habits_today" // checkpoints de hoje (card)
  | "open_projects" // projetos em aberto (card)
  | "active_goals" // metas ativas (count_nodes)
  | "active_boxes" // caixinhas ativas (count_nodes)
  | "reading" // livros em leitura/fila (count_nodes)
  | "subjects"; // matérias ativas (count_nodes)

export interface SphereSection {
  key: string;
  label: string;
  icon: LucideIcon;
  indicator?: IndicatorKind;
}

export const SPHERE_SECTIONS: Record<Template, SphereSection[]> = {
  health: [
    { key: "dashboard", label: "Painel", icon: LayoutDashboard, indicator: "streak" },
    { key: "goals", label: "Metas", icon: Target, indicator: "active_goals" },
    { key: "checkpoints", label: "Checkpoints", icon: ListChecks, indicator: "habits_today" },
    { key: "training", label: "Treino", icon: Dumbbell },
    { key: "exams", label: "Exames", icon: Stethoscope },
  ],
  finance: [
    { key: "dashboard", label: "Painel", icon: LayoutDashboard },
    { key: "goals", label: "Metas", icon: Target, indicator: "active_goals" },
    { key: "contributions", label: "Aportes", icon: Banknote },
    // Os objetivos financeiros (caixinhas) moram junto do resto de Finanças
    // (REFINO R7) — dado financeiro no lugar do dinheiro.
    { key: "objetivos", label: "Objetivos", icon: PiggyBank, indicator: "active_boxes" },
  ],
  fin_goals: [
    { key: "boxes", label: "Caixinhas", icon: PiggyBank, indicator: "active_boxes" },
    { key: "goals", label: "Metas", icon: Target, indicator: "active_goals" },
  ],
  career: [
    { key: "dashboard", label: "Painel", icon: LayoutDashboard, indicator: "streak" },
    { key: "goals", label: "Metas", icon: Target, indicator: "active_goals" },
    { key: "projects", label: "Projetos", icon: FolderKanban, indicator: "open_projects" },
    { key: "skills", label: "Habilidades", icon: Award },
    // Os marcos moravam embutidos no Painel. Uma história profissional de dez
    // anos não é um rodapé de dashboard: ela é uma das coisas que a Esfera GUARDA,
    // e ganha a própria aba (ADR-0089).
    { key: "milestones", label: "Marcos", icon: Milestone },
  ],
  studies: [
    { key: "dashboard", label: "Painel", icon: LayoutDashboard, indicator: "streak" },
    { key: "subjects", label: "Matérias", icon: Brain, indicator: "subjects" },
    { key: "goals", label: "Metas", icon: Target, indicator: "active_goals" },
    { key: "languages", label: "Idiomas", icon: Languages },
    { key: "college", label: "Faculdade", icon: GraduationCap },
    { key: "courses", label: "Cursos", icon: MonitorPlay },
    { key: "library", label: "Biblioteca", icon: BookOpen, indicator: "reading" },
  ],
  simple: [
    { key: "dashboard", label: "Painel", icon: LayoutDashboard, indicator: "streak" },
    { key: "goals", label: "Metas", icon: Target, indicator: "active_goals" },
    { key: "agenda", label: "Agenda", icon: CalendarDays },
    { key: "checklists", label: "Checklists", icon: ListChecks },
  ],
};

/** O tom de um indicador: `good` tinge com a Esfera, `pending` alerta, `neutral` é discreto. */
export type IndicatorTone = "good" | "pending" | "neutral";

export interface IndicatorView {
  text: string;
  tone: IndicatorTone;
  icon?: LucideIcon;
}

/** Os números crus de onde os indicadores saem — reunidos pelo SphereScreen. */
export interface IndicatorData {
  card: SphereCard | undefined;
  activeGoals: number;
  activeBoxes: number;
  reading: number;
  activeSubjects: number;
}

/**
 * Traduz um `IndicatorKind` num rótulo exibível — ou `null` quando não há dado.
 * Função pura: o SphereScreen junta os números, isto decide o que mostrar.
 */
export function resolveIndicator(
  kind: IndicatorKind | undefined,
  data: IndicatorData,
): IndicatorView | null {
  if (!kind) return null;
  const card = data.card;
  switch (kind) {
    case "streak": {
      const n = card?.bestStreak ?? 0;
      return n > 0 ? { text: String(n), tone: "good", icon: Flame } : null;
    }
    case "habits_today": {
      const total = card?.habitsTodayTotal ?? 0;
      if (total === 0) return null;
      const done = card?.habitsTodayDone ?? 0;
      return { text: `${done}/${total}`, tone: done >= total ? "good" : "pending" };
    }
    case "open_projects": {
      const n = card?.openProjects ?? 0;
      return n > 0 ? { text: String(n), tone: "neutral" } : null;
    }
    case "active_goals":
      return data.activeGoals > 0 ? { text: String(data.activeGoals), tone: "neutral" } : null;
    case "active_boxes":
      return data.activeBoxes > 0 ? { text: String(data.activeBoxes), tone: "neutral" } : null;
    case "reading":
      return data.reading > 0 ? { text: String(data.reading), tone: "neutral" } : null;
    case "subjects":
      return data.activeSubjects > 0
        ? { text: String(data.activeSubjects), tone: "neutral" }
        : null;
  }
}
