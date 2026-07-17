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

export interface Area {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
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

export const createArea = (name: string, icon: string, color: string) =>
  call<Area>("create_area", { name, icon, color });

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
