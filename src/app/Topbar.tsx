import { useLocation } from "react-router-dom";
import { Search, Plus, Moon, Sun } from "lucide-react";

import { NAV_ITEMS } from "./navigation";
import { Kbd } from "../design-system/primitives";
import { useUi } from "../stores/ui";

/** Rotas que não vivem na sidebar principal e ainda precisam de breadcrumb. */
const EXTRA_CRUMBS: Record<string, string> = {
  "/settings": "Configurações",
  "/areas": "Áreas",
};

export function Topbar({
  onOpenPalette,
  onQuickCapture,
}: {
  onOpenPalette: () => void;
  onQuickCapture: () => void;
}) {
  const { pathname } = useLocation();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);

  const current = NAV_ITEMS.find((i) =>
    i.path === "/" ? pathname === "/" : pathname.startsWith(i.path),
  );
  const crumb = current?.label ?? EXTRA_CRUMBS[pathname] ?? "NEXUS";

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4"
      style={{ height: "var(--topbar-h)" }}
    >
      <span className="text-[13px] font-medium text-[var(--text-secondary)]">{crumb}</span>

      <div className="flex-1" />

      <button
        onClick={onOpenPalette}
        className="flex h-8 w-[280px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]"
      >
        <Search size={14} strokeWidth={2} />
        <span className="flex-1 text-left text-[12px]">Buscar ou executar…</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>

      <button
        onClick={onQuickCapture}
        title="Captura rápida (Ctrl+Shift+N)"
        aria-label="Captura rápida"
        className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <Plus size={16} strokeWidth={2} />
      </button>

      <button
        onClick={toggleTheme}
        title="Alternar tema"
        aria-label="Alternar tema"
        className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        {theme === "dark" ? (
          <Sun size={15} strokeWidth={1.9} />
        ) : (
          <Moon size={15} strokeWidth={1.9} />
        )}
      </button>
    </header>
  );
}
