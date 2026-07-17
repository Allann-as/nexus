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
  | "inbox_item";

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
