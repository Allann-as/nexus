/**
 * O mapa de navegação — a fonte única de rotas, ordem da rail e atalhos `G+<tecla>`.
 *
 * A navegação do NEXUS tem DOIS níveis, e a diferença entre eles é o que esta
 * lista significa:
 *
 *   * **A rail** (`NAV_ITEMS`) é GLOBAL: o Hub e as ferramentas que atravessam a
 *     vida inteira — calendário, inbox, timeline, insights. Elas não pertencem a
 *     Esfera nenhuma porque pertencem a todas.
 *   * **As Esferas** são CONTEXTUAIS: elas não moram aqui. Moram no banco, o
 *     usuário cria e arquiva as dele, e o Hub as lista. Uma lista fixa de
 *     módulos em código não conseguiria representar isso — era exatamente o que
 *     a sidebar antiga tentava fazer.
 *
 * Módulo novo na rail = uma entrada aqui; a rail, o router e o teclado leem
 * todos deste array.
 */

import {
  ArrowLeftRight,
  CalendarCheck,
  CalendarHeart,
  CalendarRange,
  Calendar,
  FileText,
  FolderKanban,
  Grid3x3,
  History,
  Inbox,
  LayoutGrid,
  Medal,
  Repeat,
  Sparkles,
  Target,
  Timer,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Segunda tecla da sequência `G+<tecla>`. */
  jumpKey: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Hub", icon: LayoutGrid, jumpKey: "h" },
  { path: "/calendar", label: "Calendário", icon: Calendar, jumpKey: "c" },
  { path: "/inbox", label: "Inbox", icon: Inbox, jumpKey: "i" },
  // Notas é global como o Inbox e a Timeline: uma nota atravessa Esferas (os
  // [[wiki-links]] ligam qualquer node), então ela mora na rail, não numa Esfera.
  { path: "/notes", label: "Notas", icon: FileText, jumpKey: "n" },
  { path: "/timeline", label: "Timeline", icon: History, jumpKey: "t" },
  // O Foco (M5) atravessa a vida inteira: um pomodoro parte de qualquer tarefa,
  // de qualquer Esfera. É da rail, como o Inbox e a Timeline.
  { path: "/focus", label: "Foco", icon: Timer, jumpKey: "f" },
  // A Revisão Semanal (M5) atravessa a vida inteira (inbox, tarefas, hábitos,
  // metas, agenda) — é da rail, não de uma Esfera. Um ritual, não uma tela de dado.
  { path: "/review", label: "Revisão Semanal", icon: CalendarCheck, jumpKey: "r" },
  { path: "/insights", label: "Insights", icon: Sparkles, jumpKey: "s" },
  // Metas Anuais e Conquistas atravessam todas as Esferas (o ano inteiro, o XP de
  // tudo), então moram na rail como o Insights — não numa Esfera.
  { path: "/annual-goals", label: "Metas Anuais", icon: CalendarRange, jumpKey: "a" },
  // Objetivos (REFINO R7): o hub que agrega objetivos de qualquer natureza —
  // caixinhas, metas anuais, constância. Global como os outros da rail.
  { path: "/objectives", label: "Objetivos", icon: Target, jumpKey: "o" },
  { path: "/game", label: "Conquistas", icon: Trophy, jumpKey: "q" },
];

/**
 * Rotas que existem mas não ganham ícone na rail.
 *
 * Hábitos, Metas e Projetos são o que sempre foram; o que mudou é o caminho até
 * eles —
 * chega-se pela Esfera dona, não por um item de menu global. As rotas
 * continuam de pé e o `G+b`/`G+m`/`G+p` e a Command Palette levam direto, mas a
 * rail não lista conteúdo de Esfera.
 *
 * Metas e Projetos moravam na MESMA rota até o M3, porque a tela de Metas não
 * existia ainda (`/goals` abria os Projetos com o nome dos dois). Agora que ela
 * existe, são duas telas: uma meta é uma métrica com projeção, um projeto é uma
 * lista de tarefas. Empilhá-las numa tela só era uma promessa, não um desenho. Era esse empilhamento de módulos soltos que fazia o app
 * parecer um menu em vez de um produto.
 */
export const SECONDARY_ROUTES: NavItem[] = [
  { path: "/habits", label: "Hábitos", icon: Repeat, jumpKey: "b" },
  { path: "/goals", label: "Metas", icon: Target, jumpKey: "m" },
  { path: "/projects", label: "Projetos", icon: FolderKanban, jumpKey: "p" },
  // As telas de análise do ARSENAL: alcançáveis por G+<tecla> e pela paleta, mas
  // descobertas mesmo é pelo NEXO (não lotam a rail).
  { path: "/perfect-weeks", label: "Semana Perfeita", icon: CalendarHeart, jumpKey: "w" },
  { path: "/records", label: "Recordes", icon: Medal, jumpKey: "k" },
  { path: "/year-pixels", label: "Ano em Pixels", icon: Grid3x3, jumpKey: "x" },
  { path: "/compare", label: "Comparativo", icon: ArrowLeftRight, jumpKey: "v" },
];

/** Tudo que o chord `G+<tecla>` alcança. */
export const JUMP_TARGETS: NavItem[] = [...NAV_ITEMS, ...SECONDARY_ROUTES];
