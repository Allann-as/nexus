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
/**
 * O MOVIMENTO DO FUNDO (fase 10, BUG B) — a galáxia ambiente (poeira estelar +
 * constelação + névoa) é a IDENTIDADE do produto, não um efeito chamativo. Ela tem
 * a própria preferência, DESACOPLADA do `prefers-reduced-motion` do SO: no Windows,
 * "Efeitos de animação" desligado fazia o WebView2 reportar `reduce` e o fundo
 * congelava contra a vontade do usuário. O default é LIGADO — o ambiente vive por
 * padrão, mesmo com o SO pedindo reduzir. Quem quer quietude escolhe "Reduzido".
 */
export type BackgroundMotion = "on" | "reduced";

interface UiState {
  theme: Theme;
  density: Density;
  /** Override manual do "reduzir movimento" (além do `prefers-reduced-motion` do SO). */
  reducedMotion: boolean;
  /** Movimento do fundo (galáxia). Ligado por padrão, independente do SO. */
  backgroundMotion: BackgroundMotion;
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setDensity: (d: Density) => void;
  setReducedMotion: (v: boolean) => void;
  setBackgroundMotion: (v: BackgroundMotion) => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark", // dark is the app's default, not a fallback
      density: "comfortable",
      reducedMotion: false,
      backgroundMotion: "on", // a galáxia vive por padrão (BUG B)
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setDensity: (density) => set({ density }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setBackgroundMotion: (backgroundMotion) => set({ backgroundMotion }),
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

/**
 * Espelha "Movimento do fundo" em `<html data-bg-motion>`. O `Starfield` e a poeira
 * da logo leem daqui (`backgroundMotionOn` em lib/motion) — o fundo anima por essa
 * preferência, NÃO pelo `prefers-reduced-motion` do SO. Ver [[BackgroundMotion]].
 */
export function applyBackgroundMotion(v: BackgroundMotion) {
  document.documentElement.dataset.bgMotion = v;
}
