/**
 * Client-only UI state. Server-ish state (anything from SQLite) belongs to
 * TanStack Query, not here.
 *
 * Persisted to localStorage: these are chrome preferences, not user data, so
 * they never touch the database. Losing them is a cosmetic reset, not data loss.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark", // dark is the app's default, not a fallback
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "nexus.ui" },
  ),
);

/** Reflects the theme onto <html data-theme> so tokens.css can switch. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}
