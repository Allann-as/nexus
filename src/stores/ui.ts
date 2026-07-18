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
/** Densidade das linhas de dados: confortável (padrão) ou compacta. */
export type Density = "comfortable" | "compact";

interface UiState {
  theme: Theme;
  density: Density;
  /** Override manual do "reduzir movimento" (além do `prefers-reduced-motion` do SO). */
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setDensity: (d: Density) => void;
  setReducedMotion: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark", // dark is the app's default, not a fallback
      density: "comfortable",
      reducedMotion: false,
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setDensity: (density) => set({ density }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "nexus.ui" },
  ),
);

/** Reflects the theme onto <html data-theme> so tokens.css can switch. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/** Espelha a densidade em <html data-density> (tokens.css ajusta as linhas). */
export function applyDensity(density: Density) {
  document.documentElement.dataset.density = density;
}

/**
 * Espelha o "reduzir movimento" em <html data-reduced-motion>. O CSS mata as
 * animações; o `useCountUp` lê o mesmo atributo e salta direto para o valor.
 * Complementa o `@media (prefers-reduced-motion)` do SO — o usuário pode forçar
 * o desligamento mesmo com o SO em "movimento normal".
 */
export function applyReducedMotion(on: boolean) {
  if (on) document.documentElement.dataset.reducedMotion = "true";
  else delete document.documentElement.dataset.reducedMotion;
}
