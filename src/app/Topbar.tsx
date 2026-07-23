import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Menu, Search, Plus, Moon, Sun } from "lucide-react";

import { NAV_ITEMS, SECONDARY_ROUTES } from "./navigation";
import { listAreas, sphereOverview, type SphereCard } from "../lib/ipc";
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
      // TINGIDA NA COR DA SEÇÃO (fase 9 §4): translúcida sobre a poeira estelar,
      // com um sopro do `--tint` e a borda inferior na cor da seção. A troca
      // transiciona suave (400ms) — a barra deixa de ser um bloco de cor à parte
      // e passa a fazer parte do ambiente. Um só backdrop-filter aqui.
      className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 backdrop-blur-[8px] transition-[background-color,border-color] duration-[var(--dur-slow)] ease-[var(--ease)]"
      style={{
        height: "var(--topbar-h)",
        backgroundColor:
          "color-mix(in srgb, var(--tint) 12%, color-mix(in srgb, var(--bg-void) 55%, transparent))",
        borderBottomColor: "color-mix(in srgb, var(--tint) 28%, transparent)",
      }}
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

      {/* As métricas REAIS da seção (§4.3) — só numa Esfera, e só o que há dado
          para dizer. Estado vazio é honesto: nada inventado. */}
      <SectionMeters pathname={pathname} />

      <div className="flex-1" />

      <LocalClock />

      <button
        onClick={onOpenPalette}
        className="group flex h-8 w-[280px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_60%,transparent)] px-2.5 text-[var(--text-tertiary)] transition-[border-color,color,box-shadow] duration-[var(--dur-fast)] hover:border-[var(--border-glow)] hover:text-[var(--text-secondary)] hover:shadow-[var(--glow-accent)]"
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
 * Numa Esfera, o rótulo vem tingido com a cor dela — a mesma pista que a poeira
 * estelar e a barra dão, repetida no chrome.
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

/**
 * 1–2 métricas reais da Esfera ativa, do card que o Hub já calculou (cache
 * quente, custo zero). Só aparece o que TEM dado: sem checkpoints hoje, some a
 * fração; sem streak vivo, some o streak. Fora de uma Esfera, não mostra nada —
 * a barra global não tem métrica que não seja de uma seção.
 */
function SectionMeters({ pathname }: { pathname: string }) {
  const sphereId = pathname.startsWith("/sphere/") ? pathname.slice(8) : null;
  const { data } = useQuery({
    queryKey: ["spheres", "overview"],
    queryFn: sphereOverview,
    enabled: !!sphereId,
  });
  if (!sphereId) return null;
  const card: SphereCard | undefined = data?.find((s) => s.id === sphereId);
  if (!card) return null;

  const parts: string[] = [];
  if (card.habitsTodayTotal > 0) {
    parts.push(`${card.habitsTodayDone}/${card.habitsTodayTotal} checkpoints hoje`);
  }
  if (card.bestStreak > 0) parts.push(`streak ${card.bestStreak}`);
  if (parts.length === 0) return null;

  return (
    <span className="hidden items-center gap-2 font-mono text-[10.5px] tracking-[0.04em] text-[var(--text-secondary)] md:flex">
      <span className="text-[var(--text-tertiary)]">·</span>
      {parts.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && <span className="text-[var(--text-tertiary)]">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

/** O relógio local `● local · HH:MM:SS`, vivo. Reforça o offline no chrome. */
function LocalClock() {
  const [now, setNow] = useState(() => clockText());
  useEffect(() => {
    const t = window.setInterval(() => setNow(clockText()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="hidden items-center gap-1.5 font-mono text-[10.5px] tracking-[0.04em] text-[var(--text-tertiary)] lg:flex">
      <span className="size-[5px] rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
      local · <span className="tabular">{now}</span>
    </span>
  );
}

function clockText(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
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
