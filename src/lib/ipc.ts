/**
 * Typed wrappers over the Tauri command surface.
 *
 * This module is the ONLY place the frontend calls `invoke`. Features import
 * these functions, never `@tauri-apps/api` directly — so the whole backend
 * contract is one file wide, and a Rust signature change breaks the build here
 * instead of at runtime somewhere else.
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

/* ===== system ===== */

/** Mirrors `commands::system::SystemInfo`. */
export interface SystemInfo {
  schemaVersion: number;
  dbSizeBytes: number;
  nodeCount: number;
  areaCount: number;
  dataDir: string;
  appVersion: string;
}

export const systemInfo = () => call<SystemInfo>("system_info");
