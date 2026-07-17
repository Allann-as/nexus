/**
 * Typed wrappers over the Tauri command surface.
 *
 * This module is the ONLY place the frontend calls `invoke`. Features import
 * these functions, never `@tauri-apps/api` directly — so the whole backend
 * contract is one file wide, and a Rust signature change breaks the build here
 * instead of at runtime somewhere else.
 *
 * Every exported function mirrors exactly one `#[tauri::command]`.
 */

import { invoke } from "@tauri-apps/api/core";

/** Mirrors `domain::errors::ErrorPayload`. */
export interface NexusError {
  kind:
    | "storage"
    | "integrity"
    | "migration"
    | "path"
    | "not_found"
    | "validation";
  message: string;
}

export function isNexusError(e: unknown): e is NexusError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    "message" in e &&
    typeof (e as NexusError).message === "string"
  );
}

/**
 * Normalises anything thrown across the IPC boundary into a NexusError.
 *
 * Toasts must never swallow the cause, so an unrecognised failure is preserved
 * verbatim rather than replaced with a generic "something went wrong".
 */
export function toNexusError(e: unknown): NexusError {
  if (isNexusError(e)) return e;
  return { kind: "storage", message: String(e) };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toNexusError(e);
  }
}

/* ===== Domain types (mirror `domain::entities`) ===== */

export type Kind =
  | "note"
  | "task"
  | "project"
  | "goal"
  | "habit"
  | "routine"
  | "event"
  | "file"
  | "inbox_item"
  | "milestone";

export type Status = "active" | "done" | "archived" | "dropped";

/**
 * O template de uma Esfera: QUE tela ela abre.
 *
 * Espelha `domain::entities::Template` e o CHECK de `areas.template` (0005).
 */
export type Template =
  | "health"
  | "finance"
  | "fin_goals"
  | "career"
  | "studies"
  | "simple";

/**
 * Uma Esfera da vida.
 *
 * Chamada `Area` porque é isso que o banco e o backend chamam — `areas` está
 * gravado em cinco migrations imutáveis. "Esfera" é o nome na UI. Ver ADR-0005.
 */
export interface Area {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  template: Template;
  /** Uma das 5 que o NEXUS instala. Editável; só não é duplicável. */
  isSystem: boolean;
  archivedAt: number | null;
}

export interface Node {
  id: string;
  kind: Kind;
  title: string;
  areaId: string | null;
  parentId: string | null;
  status: Status;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface SearchHit {
  nodeId: string;
  kind: Kind;
  title: string;
  snippet: string;
  /** bm25: lower is more relevant (it is a distance, not a score). */
  rank: number;
}

export interface LedgerEntry {
  seq: number;
  ts: number;
  day: string;
  entityId: string;
  entityKind: string;
  eventType: string;
  payload: string;
  titleSnapshot: string;
}

/* ===== system ===== */

export interface SystemInfo {
  schemaVersion: number;
  dbSizeBytes: number;
  nodeCount: number;
  areaCount: number;
  ledgerCount: number;
  dataDir: string;
  appVersion: string;
}

export const systemInfo = () => call<SystemInfo>("system_info");

/* ===== areas ===== */

/**
 * Cria uma Esfera.
 *
 * `template` aceita só 'simple' hoje: os cinco templates especializados são
 * instalados pela migration, não criados à mão. O backend recusa o resto — esta
 * assinatura documenta a regra, ela não a implementa.
 */
export const createArea = (
  name: string,
  icon: string,
  color: string,
  template: Template = "simple",
) => call<Area>("create_area", { name, icon, color, template });

export const listAreas = (includeArchived = false) =>
  call<Area[]>("list_areas", { includeArchived });

export const getArea = (id: string) => call<Area>("get_area", { id });

export const updateArea = (
  id: string,
  patch: {
    name?: string;
    icon?: string;
    color?: string;
    sortOrder?: number;
  },
) =>
  call<Area>("update_area", {
    id,
    name: patch.name ?? null,
    icon: patch.icon ?? null,
    color: patch.color ?? null,
    sortOrder: patch.sortOrder ?? null,
  });

export const archiveArea = (id: string) => call<void>("archive_area", { id });

/* ===== nodes ===== */

export const createNode = (
  kind: Kind,
  title: string,
  areaId?: string | null,
  parentId?: string | null,
) =>
  call<Node>("create_node", {
    kind,
    title,
    areaId: areaId ?? null,
    parentId: parentId ?? null,
  });

/** Quick Capture: the lowest-friction path in the app. */
export const captureInbox = (title: string) =>
  call<Node>("capture_inbox", { title });

/** Triage: an inbox item becomes what it actually is. */
export const triageInboxItem = (
  id: string,
  into: Kind,
  areaId?: string | null,
) => call<Node>("triage_inbox_item", { id, into, areaId: areaId ?? null });

export const getNode = (id: string) => call<Node>("get_node", { id });

export interface NodeQuery {
  kind?: Kind;
  status?: Status;
  areaId?: string;
  parentId?: string;
  limit?: number;
  offset?: number;
}

export const listNodes = (q: NodeQuery = {}) =>
  call<Node[]>("list_nodes", {
    kind: q.kind ?? null,
    status: q.status ?? null,
    areaId: q.areaId ?? null,
    parentId: q.parentId ?? null,
    limit: q.limit ?? null,
    offset: q.offset ?? null,
  });

export const countNodes = (q: Omit<NodeQuery, "limit" | "offset"> = {}) =>
  call<number>("count_nodes", {
    kind: q.kind ?? null,
    status: q.status ?? null,
    areaId: q.areaId ?? null,
    parentId: q.parentId ?? null,
  });

export const renameNode = (id: string, title: string) =>
  call<Node>("rename_node", { id, title });

export const setNodeStatus = (id: string, status: Status) =>
  call<Node>("set_node_status", { id, status });

export const deleteNode = (id: string) => call<void>("delete_node", { id });

/* ===== search & timeline ===== */

export const search = (query: string, limit = 20, offset = 0) =>
  call<SearchHit[]>("search", { query, limit, offset });

export const rebuildSearchIndex = () => call<void>("rebuild_search_index");

export const ledgerRange = (
  fromDay: string,
  toDay: string,
  limit = 100,
  offset = 0,
) => call<LedgerEntry[]>("ledger_range", { fromDay, toDay, limit, offset });

export const ledgerForEntity = (entityId: string, limit = 50) =>
  call<LedgerEntry[]>("ledger_for_entity", { entityId, limit });

/* ===== habits ===== */

/** Mirrors `domain::schedule::Schedule`. `days`: 0=Sunday … 6=Saturday. */
export type Schedule =
  | { type: "daily" }
  | { type: "weekdays"; days: number[] }
  | { type: "times_per_week"; n: number };

export type TickStatus = "done" | "skipped" | "failed";

export interface Streaks {
  current: number;
  record: number;
  isRecord: boolean;
}

export interface Habit {
  id: string;
  title: string;
  areaId: string | null;
  status: string;
  schedule: Schedule;
  targetValue: number | null;
  unit: string | null;
  routineId: string | null;
  routineOrder: number | null;
  reminderTime: string | null;
}

/** `Habit` flattened together with today's state — mirrors `HabitWithStats`. */
export interface HabitWithStats extends Habit {
  streaks: Streaks;
  today: TickStatus | null;
  todayValue: number | null;
}

export interface HeatmapCell {
  day: string;
  status: TickStatus | null;
  value: number | null;
  scheduled: boolean;
}

export interface WeekdayStat {
  weekday: number;
  label: string;
  done: number;
  total: number;
  failureRate: number;
}

export const createHabit = (h: {
  title: string;
  areaId?: string | null;
  schedule: Schedule;
  targetValue?: number | null;
  unit?: string | null;
  routineId?: string | null;
  reminderTime?: string | null;
}) =>
  call<Habit>("create_habit", {
    title: h.title,
    areaId: h.areaId ?? null,
    // O backend valida o Schedule de novo ao desserializar: o front é
    // conveniência, não a autoridade.
    scheduleJson: JSON.stringify(h.schedule),
    targetValue: h.targetValue ?? null,
    unit: h.unit ?? null,
    routineId: h.routineId ?? null,
    reminderTime: h.reminderTime ?? null,
  });

export const createRoutine = (title: string, areaId?: string | null) =>
  call<string>("create_routine", { title, areaId: areaId ?? null });

export const listHabits = (areaId?: string | null) =>
  call<Habit[]>("list_habits", { areaId: areaId ?? null });

export const getHabit = (id: string) => call<Habit>("get_habit", { id });

export const tickHabit = (
  id: string,
  status: TickStatus,
  day?: string | null,
  value?: number | null,
) =>
  call<Streaks>("tick_habit", {
    id,
    status,
    day: day ?? null,
    value: value ?? null,
  });

export const untickHabit = (id: string, day?: string | null) =>
  call<Streaks>("untick_habit", { id, day: day ?? null });

export const completeRoutine = (id: string, day?: string | null) =>
  call<number>("complete_routine", { id, day: day ?? null });

export const habitStreaks = (id: string) => call<Streaks>("habit_streaks", { id });

export const habitsToday = () => call<HabitWithStats[]>("habits_today");

export const habitHeatmap = (id: string, days = 365) =>
  call<HeatmapCell[]>("habit_heatmap", { id, days });

export const habitWeekdayStats = (id: string, days = 180) =>
  call<WeekdayStat[]>("habit_weekday_stats", { id, days });

export const setHabitSchedule = (id: string, schedule: Schedule) =>
  call<void>("set_habit_schedule", { id, scheduleJson: JSON.stringify(schedule) });

/* ===== tasks & projects ===== */

export interface Task {
  id: string;
  title: string;
  areaId: string | null;
  parentId: string | null;
  status: string;
  dueAt: number | null;
  scheduledAt: number | null;
  durationMin: number | null;
  /** 1 = alta, 2 = média, 3 = baixa. */
  priority: number;
  energy: string | null;
  completedAt: number | null;
  sortOrder: number;
}

export interface Progress {
  done: number;
  total: number;
}

export const createTask = (t: {
  title: string;
  areaId?: string | null;
  projectId?: string | null;
  dueAt?: number | null;
  scheduledAt?: number | null;
  durationMin?: number | null;
  priority?: number;
  energy?: "deep" | "shallow" | null;
}) =>
  call<Task>("create_task", {
    title: t.title,
    areaId: t.areaId ?? null,
    projectId: t.projectId ?? null,
    dueAt: t.dueAt ?? null,
    scheduledAt: t.scheduledAt ?? null,
    durationMin: t.durationMin ?? null,
    priority: t.priority ?? 2,
    energy: t.energy ?? null,
  });

export const createProject = (title: string, areaId?: string | null) =>
  call<string>("create_project", { title, areaId: areaId ?? null });

export const listProjectTasks = (projectId: string, includeDone = false) =>
  call<Task[]>("list_project_tasks", { projectId, includeDone });

export const getTask = (id: string) => call<Task>("get_task", { id });

export const setTaskCompleted = (id: string, done: boolean) =>
  call<Task>("set_task_completed", { id, done });

/**
 * Patch parcial de tarefa.
 *
 * A chave AUSENTE significa "não mexer"; a chave presente valendo `null`
 * significa "limpar". São pedidos diferentes, e o backend os distingue
 * (`double_option`). Por isso o objeto é repassado como veio — montar os
 * campos aqui com `?? null` transformaria "não mexer" em "apagar".
 */
export const updateTask = (
  id: string,
  patch: {
    dueAt?: number | null;
    scheduledAt?: number | null;
    durationMin?: number | null;
    priority?: number;
    energy?: "deep" | "shallow" | null;
  },
) => call<Task>("update_task", { id, patch });

export const moveTask = (id: string, projectId: string, toIndex: number) =>
  call<void>("move_task", { id, projectId, toIndex });

export const projectProgress = (projectId: string) =>
  call<Progress>("project_progress", { projectId });

/* ===== dashboard ===== */

export interface ScoreComponent {
  label: string;
  /** Peso efetivo, já redistribuído. */
  weight: number;
  ratio: number;
  detail: string;
}

export interface Score {
  /** `null` quando não havia nada agendado — não é zero. */
  value: number | null;
  components: ScoreComponent[];
  formula: string;
}

export interface Today {
  day: string;
  habits: HabitWithStats[];
  tasks: Task[];
  score: Score;
  inboxOpen: number;
}

export const dashboardToday = () => call<Today>("dashboard_today");

/* ===== esferas (o Hub) ===== */

/** Um card do Hub. Espelha `use_cases::spheres::SphereCard` (que faz flatten da Area). */
export interface SphereCard extends Area {
  habitsTodayDone: number;
  habitsTodayTotal: number;
  /** O maior streak VIVO da Esfera. */
  bestStreak: number;
  bestStreakTitle: string | null;
  openTasks: number;
  openProjects: number;
  /** Razão de conclusão por dia, 30 dias, do mais antigo ao mais recente. */
  spark: number[];
  /** Nada ligado a esta Esfera ainda — a UI convida em vez de mostrar zeros. */
  isEmpty: boolean;
}

/** Todos os cards do Hub, com estatística real. Uma chamada para a tela toda. */
export const sphereOverview = () => call<SphereCard[]>("sphere_overview");

/* ===== calendário ===== */

/**
 * Mirrors `domain::recurrence::Recurrence` — um subconjunto deliberado da
 * RFC-5545. `days`: 0=domingo … 6=sábado, igual ao `Schedule` dos hábitos.
 */
export type Recurrence =
  | { type: "daily"; interval: number }
  | { type: "weekly"; interval: number; days: number[] }
  | { type: "monthly"; interval: number }
  | { type: "yearly"; interval: number };

/** A REGRA de um evento. O que o calendário desenha é a `Occurrence`. */
export interface CalendarEvent {
  id: string;
  title: string;
  areaId: string | null;
  status: string;
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  rrule: Recurrence | null;
  recurrenceEnd: number | null;
  location: string | null;
  category: string | null;
}

/**
 * Uma ocorrência materializada.
 *
 * O evento avulso também tem exatamente uma — por isso o calendário lê uma
 * lista só, nunca uma união de "avulsos" com "séries". A chave é
 * (eventId, startsAt): `eventId` sozinho não identifica uma das 78 terças.
 */
export interface Occurrence {
  eventId: string;
  title: string;
  areaId: string | null;
  startsAt: number;
  endsAt: number;
  /** 'YYYY-MM-DD' local — o dia que o usuário vê. */
  day: string;
  status: "scheduled" | "cancelled" | "moved";
  allDay: boolean;
  location: string | null;
  category: string | null;
  isRecurring: boolean;
}

/** Dois compromissos no mesmo intervalo. O backend avisa; nunca barra. */
export interface Conflict {
  a: Occurrence;
  b: Occurrence;
}

export const createEvent = (e: {
  title: string;
  areaId?: string | null;
  startsAt: number;
  endsAt: number;
  allDay?: boolean;
  rrule?: Recurrence | null;
  recurrenceEnd?: number | null;
  location?: string | null;
  category?: string | null;
}) => call<CalendarEvent>("create_event", { event: e });

export const getEvent = (id: string) => call<CalendarEvent>("get_event", { id });

/** A tela do calendário: tudo que cai entre dois dias locais, numa query. */
export const eventsRange = (fromDay: string, toDay: string) =>
  call<Occurrence[]>("events_range", { fromDay, toDay });

/**
 * Patch parcial de evento. Chave ausente = não mexer; `null` = limpar. Por isso
 * o objeto é repassado como veio — montar com `?? null` viraria "apagar".
 *
 * Sem `title`: renomear é o `renameNode`, que já grava no ledger.
 */
export const updateEvent = (
  id: string,
  patch: { location?: string | null; category?: string | null },
) => call<CalendarEvent>("update_event", { id, patch });

/**
 * Arrasta UMA ocorrência (timeblocking).
 *
 * Mover uma ocorrência de uma série marca só aquela como `moved` — a regra não
 * é reescrita. `occurrenceStart` é a metade da chave que diz qual delas.
 */
export const moveEvent = (
  id: string,
  occurrenceStart: number,
  newStart: number,
) => call<Occurrence>("move_event", { id, occurrenceStart, newStart });

/**
 * Estica/encolhe UMA ocorrência (a borda inferior do bloco).
 *
 * Como o arrasto, redimensionar uma ocorrência de série solta AQUELA da regra:
 * o usuário esticou a terapia desta terça, não todas as terças.
 */
export const resizeEvent = (
  id: string,
  occurrenceStart: number,
  newEnd: number,
) => call<Occurrence>("resize_event", { id, occurrenceStart, newEnd });

/** "Toda terça, MENOS a de 25/11." */
export const cancelOccurrence = (id: string, occurrenceStart: number) =>
  call<void>("cancel_occurrence", { id, occurrenceStart });

/** Apaga o evento inteiro, com série e tudo. */
export const deleteEvent = (id: string) => call<void>("delete_event", { id });

/**
 * Os choques de horário de uma janela (epoch ms).
 *
 * Detecção pura: o usuário PODE marcar duas coisas às 15h. Isto pinta o aviso,
 * não bloqueia o salvamento.
 */
export const eventConflicts = (fromMs: number, toMs: number) =>
  call<Conflict[]>("event_conflicts", { fromMs, toMs });

/**
 * Estende a janela materializada até o fim de `untilMonth` ('AAAA-MM').
 *
 * A série é materializada 18 meses à frente da âncora, e além disso ela não
 * existe: o mês 19 abriria vazio. Isto é o que a estende — e é a UI que o
 * dispara, ao navegar para perto da borda, porque materializar é ESCREVER e a
 * leitura do calendário roda num pool `query_only`.
 *
 * Idempotente: devolve quantas ocorrências nasceram, e 0 é a resposta normal.
 */
export const extendMaterialization = (untilMonth: string) =>
  call<number>("extend_materialization", { untilMonth });

/* ===== metas & sub-desafios ===== */

export type Direction = "increase" | "decrease";

/** Qual barra manda. Espelha o CHECK de `goal_details.progress_source` (0007). */
export type ProgressSource = "metric" | "milestones";

export type MilestoneKind = "simple" | "counter";

export interface Goal {
  id: string;
  title: string;
  areaId: string | null;
  status: string;
  metricName: string;
  startValue: number;
  targetValue: number;
  unit: string;
  direction: Direction;
  deadline: number | null;
  progressSource: ProgressSource;
}

export interface GoalCheckpoint {
  id: string;
  goalId: string;
  value: number;
  notedAt: number;
  note: string | null;
}

/** Um sub-desafio. `status === "done"` É o checkbox. */
export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  status: string;
  kind: MilestoneKind;
  habitId: string | null;
  targetCount: number | null;
  weight: number;
  sortOrder: number;
  /** 'YYYY-MM-DD': de quando o contador conta. `null` = desde sempre. */
  countsFrom: string | null;
  /**
   * Ticks 'done' do hábito ligado, a partir de `countsFrom`. `null` num
   * 'simple'. Vem de query — nunca é um número que o usuário digitou.
   */
  currentCount: number | null;
}

/** `Milestone` achatado com a fração dele — mirrors `MilestoneView`. */
export interface MilestoneView extends Milestone {
  /** 0..=1. Num 'counter', contador ÷ alvo; num 'simple', o checkbox. */
  ratio: number;
}

export interface GoalProgress {
  ratio: number;
  source: ProgressSource;
  /** A conta por extenso — o "ⓘ como calculamos". */
  formula: string;
}

/**
 * A projeção linear.
 *
 * `null` (o campo inteiro) com menos de 2 checkpoints: uma reta precisa de dois
 * pontos, e o NEXUS não chuta. `eta` null com 2+ pontos significa que o ritmo
 * medido não leva ao alvo — e isso é uma resposta, não uma falha.
 */
export interface Projection {
  ratePerDay: number;
  eta: string | null;
  sampleSize: number;
  formula: string;
}

/** `Goal` achatada com tudo que a tela precisa — mirrors `GoalWithProgress`. */
export interface GoalWithProgress extends Goal {
  progress: GoalProgress;
  /** `null` = nunca mediu. Não é o mesmo que ter medido o valor inicial. */
  currentValue: number | null;
  checkpoints: GoalCheckpoint[];
  milestones: MilestoneView[];
  projection: Projection | null;
}

export const createGoal = (g: {
  title: string;
  areaId?: string | null;
  metricName: string;
  startValue: number;
  targetValue: number;
  unit: string;
  direction: Direction;
  deadline?: number | null;
  progressSource?: ProgressSource;
}) => call<Goal>("create_goal", { goal: g });

export const listGoals = (areaId?: string | null) =>
  call<Goal[]>("list_goals", { areaId: areaId ?? null });

/** A tela de uma meta inteira: barra, série, sub-desafios e projeção. */
export const goalWithProgress = (id: string) =>
  call<GoalWithProgress>("goal_with_progress", { id });

/**
 * Registra uma medição da métrica.
 *
 * `notedAt` ausente = agora. O passado é aceito ("a pesagem de segunda, que
 * esqueci de anotar") e o futuro é recusado — a mesma regra do `day` de um tick
 * de hábito, e pelo mesmo motivo: a data é o x da reta da projeção.
 */
export const addGoalCheckpoint = (
  id: string,
  value: number,
  note?: string | null,
  notedAt?: number | null,
) =>
  call<GoalCheckpoint>("add_goal_checkpoint", {
    id,
    value,
    note: note ?? null,
    notedAt: notedAt ?? null,
  });

export const addMilestone = (m: {
  goalId: string;
  title: string;
  kind?: MilestoneKind;
  /** Obrigatório num 'counter': é ele que preenche o contador. */
  habitId?: string | null;
  targetCount?: number | null;
  weight?: number;
  /**
   * 'YYYY-MM-DD': de quando o contador conta. Ausente num 'counter' = hoje.
   *
   * Sem este piso, "30 dias de academia" criado hoje sobre um hábito com um ano
   * de histórico nasceria completo. O passado é aceito ("conte desde o início
   * do mês"); o futuro, não.
   */
  countsFrom?: string | null;
}) => call<Milestone>("add_milestone", { milestone: m });

/**
 * Marca/desmarca um sub-desafio.
 *
 * O backend recusa os 'counter': eles se preenchem pelos ticks do hábito
 * ligado, e um número manual discordaria do contado.
 */
export const setMilestoneDone = (id: string, done: boolean) =>
  call<Milestone>("set_milestone_done", { id, done });

/**
 * Qual barra manda: a métrica ou os sub-desafios.
 *
 * As duas discordam o tempo todo, e a escolha é do usuário — o app não adivinha
 * qual das duas medidas do progresso dele é a verdadeira.
 */
export const setGoalProgressSource = (id: string, source: ProgressSource) =>
  call<Goal>("set_goal_progress_source", { id, source });

/** Arrasta um sub-desafio para a posição `toIndex` da árvore. */
export const moveMilestone = (id: string, toIndex: number) =>
  call<void>("move_milestone", { id, toIndex });

/* ===== calendário: exames por categoria (M3.5) ===== */

/** Os próximos compromissos de uma categoria — os exames da Saúde (§3.1). */
export const eventsByCategory = (category: string, limit = 20) =>
  call<Occurrence[]>("events_by_category", { category, limit });

/* ===== finanças (M3.5) ===== */

/** Uma conta/banco. Espelha `ports::Account` e a tabela `accounts` (0005). */
export interface Account {
  id: string;
  name: string;
  /** 'banking' | 'investment'. */
  kind: string;
  color: string;
  sortOrder: number;
}

/**
 * A classe de um ativo. Espelha `domain::entities::AssetClass` e o CHECK de
 * `contributions.asset_class` (0010).
 */
export type AssetClass =
  | "renda_fixa"
  | "acoes"
  | "fiis"
  | "etf_exterior"
  | "cripto"
  | "reserva"
  | "outros";

export interface Contribution {
  id: string;
  accountId: string;
  assetClass: string;
  /** Centavos. Negativo é resgate. */
  amountCents: number;
  happenedOn: string;
  note: string | null;
  createdAt: number;
}

/** Um total por chave (classe ou banco) — as fatias do donut e das barras. */
export interface Bucket {
  key: string;
  label: string;
  cents: number;
}

/** O aporte de um mês — o ponto da área acumulada. */
export interface MonthTotal {
  month: string;
  cents: number;
}

/** Uma parcela da Saúde Financeira, com a conta que a produziu. */
export interface FinancialComponent {
  label: string;
  weight: number;
  ratio: number;
  detail: string;
}

/** A Saúde Financeira 0–100, com o breakdown e a fórmula. */
export interface FinancialHealth {
  /** `null` quando ainda não há aporte — não zero. */
  value: number | null;
  components: FinancialComponent[];
  formula: string;
}

/** O dashboard das Finanças — mirrors `use_cases::finance::FinanceOverview`. */
export interface FinanceOverview {
  totalContributedCents: number;
  /** `null` = patrimônio nunca informado à mão; a UI mostra o total aportado. */
  portfolioCents: number | null;
  byClass: Bucket[];
  byAccount: Bucket[];
  /** Aporte por mês, do mais antigo ao mais novo. */
  monthly: MonthTotal[];
  thisMonthCents: number;
  avg6mCents: number;
  streakMonths: number;
  health: FinancialHealth;
}

export const listAccounts = () => call<Account[]>("list_accounts");

/**
 * Registra um aporte (ou resgate, com `amountCents` negativo).
 *
 * Um aporte é um fato da vida do usuário: ele grava no ledger (ADR-0023/0027).
 */
export const addContribution = (c: {
  accountId: string;
  assetClass: AssetClass;
  amountCents: number;
  happenedOn: string;
  note?: string | null;
}) =>
  call<Contribution>("add_contribution", {
    contribution: {
      accountId: c.accountId,
      assetClass: c.assetClass,
      amountCents: c.amountCents,
      happenedOn: c.happenedOn,
      note: c.note ?? null,
    },
  });

export const recentContributions = (limit = 50) =>
  call<Contribution[]>("recent_contributions", { limit });

/** Todo o dashboard das Finanças, numa chamada. */
export const financeOverview = () => call<FinanceOverview>("finance_overview");

/** O patrimônio informado à mão para um mês ('AAAA-MM'). */
export const setPortfolioSnapshot = (month: string, totalCents: number) =>
  call<void>("set_portfolio_snapshot", { month, totalCents });
