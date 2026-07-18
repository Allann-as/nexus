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
  | "milestone"
  | "fin_goal"
  | "book"
  | "annual_goal"
  | "challenge"
  | "skill"
  | "subject";

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
  /** "A terceira terça do mês": `week` 1–5, `weekday` 0=domingo…6=sábado. */
  | { type: "monthly_by_weekday"; interval: number; week: number; weekday: number }
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

/* ===== Objetivos Financeiros: as "caixinhas" ===== */

/** Uma caixinha. Espelha `ports::FinGoal`. */
export interface FinGoal {
  id: string;
  title: string;
  areaId: string | null;
  status: Status;
  targetCents: number;
  accountId: string | null;
  /** O nome do banco onde o dinheiro está guardado, se houver conta. */
  accountName: string | null;
  deadline: string | null;
  emoji: string;
  /** Somado dos depósitos — nunca um número à mão. */
  savedCents: number;
  createdAt: number;
}

/** A projeção de conclusão — espelha `domain::savings::SavingsProjection`. */
export interface SavingsProjection {
  /** 'YYYY-MM' de conclusão, ou `null` (já fechou, ou sem ritmo). */
  etaMonth: string | null;
  monthsRemaining: number | null;
  monthlyRateCents: number;
  formula: string;
}

/** Uma caixinha com a projeção — o que o card mostra. */
export interface FinGoalCard extends FinGoal {
  projection: SavingsProjection;
}

export interface FinGoalDeposit {
  id: string;
  goalId: string;
  amountCents: number;
  happenedOn: string;
  note: string | null;
  createdAt: number;
}

/** O resultado de um depósito: se ele FECHOU a caixinha (dispara a celebração). */
export interface DepositOutcome {
  deposit: FinGoalDeposit;
  completed: boolean;
}

export const createFinGoal = (goal: {
  title: string;
  areaId?: string | null;
  targetCents: number;
  accountId?: string | null;
  deadline?: string | null;
  emoji?: string | null;
}) =>
  call<FinGoal>("create_fin_goal", {
    goal: {
      title: goal.title,
      areaId: goal.areaId ?? null,
      targetCents: goal.targetCents,
      accountId: goal.accountId ?? null,
      deadline: goal.deadline ?? null,
      emoji: goal.emoji ?? null,
    },
  });

/** As caixinhas de uma Esfera (ou todas, com `areaId` ausente), com projeção. */
export const listFinGoals = (areaId?: string | null) =>
  call<FinGoalCard[]>("list_fin_goals", { areaId: areaId ?? null });

/** Deposita (ou saca, com `amountCents` negativo) numa caixinha. */
export const depositFinGoal = (deposit: {
  goalId: string;
  amountCents: number;
  happenedOn?: string | null;
  note?: string | null;
}) =>
  call<DepositOutcome>("deposit_fin_goal", {
    deposit: {
      goalId: deposit.goalId,
      amountCents: deposit.amountCents,
      happenedOn: deposit.happenedOn ?? null,
      note: deposit.note ?? null,
    },
  });

export const finGoalDeposits = (goalId: string) =>
  call<FinGoalDeposit[]>("fin_goal_deposits", { goalId });

/* ===== Biblioteca: os livros ===== */

/** O ciclo de vida de um livro. Espelha `domain::entities::BookStatus`. */
export type BookStatus = "fila" | "lendo" | "lido" | "abandonado";

export interface Book {
  id: string;
  title: string;
  areaId: string | null;
  author: string | null;
  totalPages: number | null;
  currentPage: number;
  status: BookStatus;
  /** 0–5 estrelas, ou `null` se não avaliado. */
  rating: number | null;
  shelf: string | null;
  startedOn: string | null;
  finishedOn: string | null;
  createdAt: number;
}

/** O painel de Estudos — mirrors `use_cases::books::StudiesOverview`. */
export interface StudiesOverview {
  year: string;
  readingGoal: number | null;
  finishedThisYear: number;
  readingNow: Book[];
  totalBooks: number;
}

export const createBook = (book: {
  title: string;
  areaId?: string | null;
  author?: string | null;
  totalPages?: number | null;
  shelf?: string | null;
}) =>
  call<Book>("create_book", {
    book: {
      title: book.title,
      areaId: book.areaId ?? null,
      author: book.author ?? null,
      totalPages: book.totalPages ?? null,
      shelf: book.shelf ?? null,
    },
  });

export const listBooks = (areaId?: string | null) =>
  call<Book[]>("list_books", { areaId: areaId ?? null });

export const setBookProgress = (id: string, currentPage: number) =>
  call<Book>("set_book_progress", { id, currentPage });

export const setBookStatus = (id: string, status: BookStatus) =>
  call<Book>("set_book_status", { id, status });

export const setBookShelf = (id: string, shelf: string | null) =>
  call<Book>("set_book_shelf", { id, shelf });

export const setBookRating = (id: string, rating: number | null) =>
  call<Book>("set_book_rating", { id, rating });

/** Termina o livro: 'lido', conquista no ledger, e a resenha vira nota linkada. */
export const finishBook = (id: string, rating: number | null, review: string | null) =>
  call<Book>("finish_book", { id, rating, review });

export const studiesOverview = (areaId?: string | null) =>
  call<StudiesOverview>("studies_overview", { areaId: areaId ?? null });

export const setReadingGoal = (target: number) =>
  call<void>("set_reading_goal", { target });

/** As estatísticas de leitura (item 7) — ritmo e tempo médio, com fórmula. */
export interface ReadingStats {
  year: string;
  booksFinishedYear: number;
  pagesThisYear: number;
  pagesPerDay: number | null;
  avgDaysToFinish: number | null;
  sampleSize: number;
  formula: string;
}

export const readingStats = (areaId?: string | null) =>
  call<ReadingStats>("reading_stats", { areaId: areaId ?? null });

/* ===== Estudos: matérias e sessões (item 7) ===== */

/** Uma matéria (`subject`). O progresso é COMPUTADO das sessões (ver SubjectProgress). */
export interface Subject {
  id: string;
  title: string;
  areaId: string | null;
  status: Status;
  category: string | null;
  targetMinutes: number | null;
  createdAt: number;
}

/** Uma sessão de estudo — um LOG (não node). `subjectTitle` já vem resolvido. */
export interface StudySession {
  id: string;
  subjectId: string | null;
  subjectTitle: string | null;
  bookId: string | null;
  skillId: string | null;
  topic: string | null;
  minutes: number;
  day: string;
  ts: number;
}

/** O progresso agregado de uma matéria — tudo computado das sessões. */
export interface SubjectProgress {
  subject: Subject;
  totalMinutes: number;
  sessionCount: number;
  lastDay: string | null;
  booksTouched: number;
  linkedCount: number;
  /** `totalMinutes / targetMinutes`, saturado em 1 — `null` se não há meta. */
  targetProgress: number | null;
  recent: StudySession[];
}

export interface HourBucket {
  hour: number;
  minutes: number;
}

/** As estatísticas de estudo (item 7) — determinísticas, com fórmula. */
export interface StudyStats {
  minutesLast7: number;
  minutesPrev7: number;
  activeDays30: number;
  bestHour: number | null;
  bestHourMinutes: number;
  byHour: HourBucket[];
  totalMinutes: number;
  totalSessions: number;
  formula: string;
}

export const createSubject = (s: {
  title: string;
  areaId?: string | null;
  category?: string | null;
  targetMinutes?: number | null;
}) =>
  call<Subject>("create_subject", {
    subject: {
      title: s.title,
      areaId: s.areaId ?? null,
      category: s.category ?? null,
      targetMinutes: s.targetMinutes ?? null,
    },
  });

export const listSubjects = (areaId: string | null) =>
  call<Subject[]>("list_subjects", { areaId });

export const setSubjectTarget = (id: string, targetMinutes: number | null) =>
  call<Subject>("set_subject_target", { id, targetMinutes });

export const archiveSubject = (id: string) => call<void>("archive_subject", { id });

export const subjectProgress = (id: string) =>
  call<SubjectProgress>("subject_progress", { id });

/** Registra uma sessão de estudo — um fato no ledger que vale XP (ADR-0047). */
export const logStudySession = (s: {
  subjectId?: string | null;
  bookId?: string | null;
  skillId?: string | null;
  topic?: string | null;
  minutes: number;
  day?: string | null;
}) =>
  call<StudySession>("log_study_session", {
    session: {
      subjectId: s.subjectId ?? null,
      bookId: s.bookId ?? null,
      skillId: s.skillId ?? null,
      topic: s.topic ?? null,
      minutes: s.minutes,
      day: s.day ?? null,
    },
  });

export const recentStudySessions = (areaId?: string | null) =>
  call<StudySession[]>("recent_study_sessions", { areaId: areaId ?? null });

export const studyStats = (areaId?: string | null) =>
  call<StudyStats>("study_stats", { areaId: areaId ?? null });

/* ===== Carreira: os marcos profissionais ===== */

/** O tipo de um marco. Espelha `domain::entities::CareerMilestoneKind`. */
export type CareerMilestoneKind =
  | "promotion"
  | "certification"
  | "new_job"
  | "raise"
  | "award"
  | "other";

/** Registra um marco de carreira no ledger (§2.3). */
export const recordCareerMilestone = (m: {
  title: string;
  kind: CareerMilestoneKind;
  happenedOn?: string | null;
  note?: string | null;
}) =>
  call<LedgerEntry>("record_career_milestone", {
    milestone: {
      title: m.title,
      kind: m.kind,
      happenedOn: m.happenedOn ?? null,
      note: m.note ?? null,
    },
  });

/** Os marcos de carreira, do mais recente ao mais antigo. */
export const careerMilestones = () => call<LedgerEntry[]>("career_milestones");

/** Uma competência da Carreira (§2.6). `level` é o estado atual; a trilha vem de `skillTrack`. */
export interface Skill {
  id: string;
  title: string;
  areaId: string | null;
  status: Status;
  level: number;
  category: string | null;
  maxLevel: number | null;
  createdAt: number;
}

/** Um ponto da trilha de evolução de uma competência. */
export interface SkillPoint {
  day: string;
  level: number;
}

export const createSkill = (skill: {
  title: string;
  areaId?: string | null;
  category?: string | null;
  maxLevel?: number | null;
}) =>
  call<Skill>("create_skill", {
    skill: {
      title: skill.title,
      areaId: skill.areaId ?? null,
      category: skill.category ?? null,
      maxLevel: skill.maxLevel ?? null,
    },
  });

/** Sobe uma competência de nível — um fato no ledger que vale XP (ADR-0045). */
export const levelUpSkill = (id: string) => call<Skill>("level_up_skill", { id });

export const listSkills = (areaId: string | null) =>
  call<Skill[]>("list_skills", { areaId });

/** A trilha de evolução: (dia, nível). Um ponto só = competência nova. */
export const skillTrack = (id: string) => call<SkillPoint[]>("skill_track", { id });

/** As competências que subiram de nível nos últimos 90 dias — "em evolução". */
export const skillsEvolving = (areaId: string) =>
  call<Skill[]>("skills_evolving", { areaId });

/* ===== Links entre nodes (M4.6) ===== */

export type LinkType =
  | "related"
  | "blocks"
  | "references"
  | "attached_to"
  | "contributes_to";

/** Uma ponta de link resolvida — o node do OUTRO lado + o tipo. */
export interface LinkEnd {
  nodeId: string;
  kind: Kind;
  title: string;
  areaId: string | null;
  linkType: LinkType;
}

/** Os links de um node nos dois sentidos — o backlink aparece dos dois lados. */
export interface NodeLinks {
  outgoing: LinkEnd[];
  incoming: LinkEnd[];
}

export const linkNodes = (sourceId: string, targetId: string, linkType: LinkType) =>
  call<NodeLinks>("link_nodes", { sourceId, targetId, linkType });

export const unlinkNodes = (sourceId: string, targetId: string, linkType: LinkType) =>
  call<NodeLinks>("unlink_nodes", { sourceId, targetId, linkType });

export const nodeLinks = (nodeId: string) => call<NodeLinks>("node_links", { nodeId });

/* ===== Timeline: a Máquina do Tempo ===== */

/** Um mês congelado da visão ANO — mirrors `ports::MonthRollup`. */
export interface MonthRollup {
  /** 'YYYY-MM'. */
  month: string;
  events: number;
  completed: number;
  checked: number;
}

/** A visão MÊS: os eventos entre dois dias 'YYYY-MM-DD', paginados. */
export const timelineRange = (
  fromDay: string,
  toDay: string,
  limit = 500,
  offset = 0,
) => call<LedgerEntry[]>("timeline_range", { fromDay, toDay, limit, offset });

/** A visão ANO: um resumo por mês de um ano 'YYYY'. */
export const timelineYear = (year: string) =>
  call<MonthRollup[]>("timeline_year", { year });

/** "Neste dia": o que aconteceu no mesmo dia de anos anteriores. */
export const onThisDay = () => call<LedgerEntry[]>("on_this_day");

/** Congela os meses completos ainda pendentes. Chamado ao abrir a Timeline. */
export const ensureTimelineRollups = () =>
  call<number>("ensure_timeline_rollups");

/* ===== Notas: corpo, wiki-links e anexos ===== */

export interface NoteSummary {
  id: string;
  title: string;
  areaId: string | null;
  isPinned: boolean;
  updatedAt: number;
}

/** Um elo de/para uma nota. */
export interface NoteLink {
  nodeId: string;
  kind: Kind;
  title: string;
  linkType: "related" | "blocks" | "references" | "attached_to";
}

export interface Attachment {
  nodeId: string;
  title: string;
  /** Relativo à raiz de dados: 'media/AAAA/MM/<sha>.<ext>'. */
  relativePath: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/** Uma nota inteira — mirrors `ports::NoteFull`. */
export interface NoteFull {
  id: string;
  title: string;
  areaId: string | null;
  bodyMd: string;
  isPinned: boolean;
  updatedAt: number;
  /** Wiki-links resolvidos que esta nota emite. */
  outgoing: NoteLink[];
  /** Quem aponta para esta nota. */
  backlinks: NoteLink[];
  attachments: Attachment[];
}

/** A raiz de dados (`%APPDATA%/Nexus`) — para montar a URL de um anexo. */
export const dataRoot = () => call<string>("data_root");

export const listNotes = (areaId?: string | null) =>
  call<NoteSummary[]>("list_notes", { areaId: areaId ?? null });

export const getNote = (id: string) => call<NoteFull>("get_note", { id });

export const createNote = (title: string, areaId?: string | null) =>
  call<NoteFull>("create_note", { title, areaId: areaId ?? null });

/** Salva o corpo e resincroniza os wiki-links. Chamar debounced. */
export const saveNoteBody = (id: string, bodyMd: string) =>
  call<NoteFull>("save_note_body", { id, bodyMd });

export const pinNote = (id: string, pinned: boolean) =>
  call<void>("pin_note", { id, pinned });

/** Anexa um arquivo (ou imagem colada) à nota. `bytes` = bytes crus. */
export const attachToNote = (noteId: string, filename: string, bytes: Uint8Array) =>
  call<Attachment>("attach_to_note", {
    noteId,
    filename,
    bytes: Array.from(bytes),
  });

/* ===== M4.5 — bi_engine (insights) ===== */

export interface HabitRef {
  id: string;
  title: string;
}

export interface CorrelationCard {
  habitA: HabitRef;
  habitB: HabitRef;
  direction: "helps" | "hurts";
  lift: number;
  phi: number;
  sampleSize: number;
  sentence: string;
  formula: string;
}

export interface Workload {
  current: number;
  baseline: number;
  ratio: number;
  alert: boolean;
  baselineWeeks: number;
  formula: string;
}

export interface Insights {
  correlations: CorrelationCard[];
  burnout: Workload | null;
  computedAt: number;
}

/** Lê o pacote de insights do cache (instantâneo). `null` no primeiro boot. */
export const getInsights = () => call<Insights | null>("get_insights");

/** Recomputa se as fontes mudaram e devolve o pacote fresco. */
export const recomputeInsights = () => call<Insights>("recompute_insights");

/* ===== M4.5 — gamificação ===== */

export interface Level {
  level: number;
  xp: number;
  floor: number;
  nextAt: number;
  intoLevel: number;
  span: number;
}

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export interface SphereXp {
  areaId: string;
  level: Level;
}

export interface GalleryEntry {
  key: string;
  title: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  unlocked: boolean;
  unlockedAt: number | null;
}

export interface GamificationOverview {
  spheres: SphereXp[];
  overall: Level;
  achievements: GalleryEntry[];
}

export interface Unlocked {
  key: string;
  title: string;
  icon: string;
  tier: AchievementTier;
}

export const gamificationOverview = () =>
  call<GamificationOverview>("gamification_overview");

/** Desbloqueia o que os contadores satisfazem; devolve o que caiu agora. */
export const syncAchievements = () => call<Unlocked[]>("sync_achievements");

/* ===== M4.5 — temporadas / desafios ===== */

export type ChallengeMetric = "habit_days" | "manual";
export type ChallengeState = "active" | "done" | "dropped" | "expired";

export interface Challenge {
  id: string;
  title: string;
  areaId: string | null;
  status: string;
  startsOn: string;
  endsOn: string;
  metric: string;
  habitId: string | null;
  habitTitle: string | null;
  targetCount: number;
  manualCount: number;
  progressCount: number;
  createdAt: number;
  state: ChallengeState;
  progressRatio: number;
  daysLeft: number;
}

export interface CompletedChallenge {
  id: string;
  title: string;
}

export const createChallenge = (c: {
  title: string;
  areaId?: string | null;
  startsOn: string;
  endsOn: string;
  metric: ChallengeMetric;
  habitId?: string | null;
  targetCount: number;
}) =>
  call<Challenge>("create_challenge", {
    title: c.title,
    areaId: c.areaId ?? null,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    metric: c.metric,
    habitId: c.habitId ?? null,
    targetCount: c.targetCount,
  });

export const listChallenges = (areaId?: string | null) =>
  call<Challenge[]>("list_challenges", { areaId: areaId ?? null });

export const incrementChallenge = (id: string, delta: number) =>
  call<Challenge>("increment_challenge", { id, delta });

export const abandonChallenge = (id: string) =>
  call<Challenge>("abandon_challenge", { id });

export const syncChallenges = () =>
  call<CompletedChallenge[]>("sync_challenges");

/* ===== M4.5 — metas anuais ===== */

export type AnnualGoalKind = "binary" | "quantitative";

export interface AnnualGoal {
  id: string;
  title: string;
  areaId: string | null;
  status: string;
  year: number;
  goalKind: string;
  metricName: string | null;
  targetValue: number | null;
  currentValue: number;
  unit: string | null;
  createdAt: number;
  progressRatio: number;
}

export interface YearOverview {
  year: number;
  goals: AnnualGoal[];
  yearElapsedRatio: number;
  aggregateProgress: number;
  activeCount: number;
  doneCount: number;
}

export const createAnnualGoal = (g: {
  title: string;
  areaId?: string | null;
  year: number;
  goalKind: AnnualGoalKind;
  metricName?: string | null;
  targetValue?: number | null;
  unit?: string | null;
}) =>
  call<AnnualGoal>("create_annual_goal", {
    title: g.title,
    areaId: g.areaId ?? null,
    year: g.year,
    goalKind: g.goalKind,
    metricName: g.metricName ?? null,
    targetValue: g.targetValue ?? null,
    unit: g.unit ?? null,
  });

export const annualGoalYear = (year: number) =>
  call<YearOverview>("annual_goal_year", { year });

export const annualGoalYears = () => call<number[]>("annual_goal_years");

export const updateAnnualGoalProgress = (id: string, currentValue: number) =>
  call<AnnualGoal>("update_annual_goal_progress", { id, currentValue });

export const completeAnnualGoal = (id: string) =>
  call<AnnualGoal>("complete_annual_goal", { id });

export const abandonAnnualGoal = (id: string) =>
  call<AnnualGoal>("abandon_annual_goal", { id });

export const archiveAnnualGoal = (id: string) =>
  call<AnnualGoal>("archive_annual_goal", { id });

export const deleteAnnualGoal = (id: string) =>
  call<void>("delete_annual_goal", { id });

/* ===== M4.5 — Nexus Score congelado ===== */

export interface ScorePoint {
  day: string;
  value: number;
}

/** Congela os dias fechados ainda sem linha. Chamar na abertura do app. */
export const freezeDailyScores = () => call<number>("freeze_daily_scores");

export const scoreHistory = (days: number) =>
  call<ScorePoint[]>("score_history", { days });
