import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Menu, Search, Plus, Moon, Sun } from "lucide-react";

import { NAV_ITEMS, SECONDARY_ROUTES } from "./navigation";
import { listAreas } from "../lib/ipc";
import { Kbd } from "../design-system/primitives";
import { useUi } from "../stores/ui";

/** Rotas que não estão na rail e ainda precisam de rótulo. */
const EXTRA_CRUMBS: Record<string, string> = {
  "/settings": "Configurações",
  "/areas": "Esferas",
  "/notes": "Notas",
};

export function Topbar({
  onOpenNav,
  onOpenPalette,
  onQuickCapture,
}: {
  onOpenNav: () => void;
  onOpenPalette: () => void;
  onQuickCapture: () => void;
}) {
  const { pathname } = useLocation();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);

  // As Esferas vêm do banco, então o rótulo de `/sphere/:id` não pode sair de
  // uma tabela em código. A query já está em cache (a rail e o Hub a usam), logo
  // isto não custa uma ida a mais ao backend.
  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
  });

  return (
    <header
      className="z-10 flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-void)] px-4"
      style={{ height: "var(--topbar-h)" }}
    >
      <button
        onClick={onOpenNav}
        title="O Nexo"
        aria-label="Abrir O Nexo"
        className="-ml-1 flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
      >
        <Menu size={18} strokeWidth={2} />
      </button>

      <Crumb pathname={pathname} areas={areas} />

      <div className="flex-1" />

      <button
        onClick={onOpenPalette}
        className="group flex h-8 w-[300px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[var(--text-tertiary)] transition-[border-color,color,box-shadow] duration-[var(--dur-fast)] hover:border-[var(--border-glow)] hover:text-[var(--text-secondary)] hover:shadow-[var(--glow-accent)]"
      >
        <Search size={14} strokeWidth={2} />
        <span className="flex-1 text-left text-[12px]">Buscar ou executar…</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>

      <IconButton
        onClick={onQuickCapture}
        label="Captura rápida (Ctrl+Shift+N)"
        icon={<Plus size={16} strokeWidth={2} />}
      />
      <IconButton
        onClick={toggleTheme}
        label="Alternar tema"
        icon={
          theme === "dark" ? (
            <Sun size={15} strokeWidth={1.9} />
          ) : (
            <Moon size={15} strokeWidth={1.9} />
          )
        }
      />
    </header>
  );
}

/**
 * Onde você está.
 *
 * Numa Esfera, o rótulo vem tingido com a cor dela — a mesma pista que o header
 * e a aurora da página dão, repetida no chrome. A navegação tem dois níveis
 * agora, e a barra de cima é o único lugar do chrome que sabe qual é o segundo.
 */
function Crumb({
  pathname,
  areas,
}: {
  pathname: string;
  areas: Array<{ id: string; name: string; color: string }>;
}) {
  const sphereId = pathname.startsWith("/sphere/") ? pathname.slice(8) : null;
  const sphere = sphereId ? areas.find((a) => a.id === sphereId) : undefined;

  if (sphere) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: sphere.color, boxShadow: `0 0 8px ${sphere.color}` }}
          aria-hidden
        />
        <span className="text-[13px] font-medium text-[var(--text-primary)]">
          {sphere.name}
        </span>
      </div>
    );
  }

  const route = [...NAV_ITEMS, ...SECONDARY_ROUTES].find((i) =>
    i.path === "/" ? pathname === "/" : pathname.startsWith(i.path),
  );
  const label = route?.label ?? EXTRA_CRUMBS[pathname] ?? "NEXUS";

  return <span className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</span>;
}

function IconButton({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
    >
      {icon}
    </button>
  );
}
