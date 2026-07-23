/**
 * A RAIL do Cockpit (v1.3 · §2.1 · fase 10) — a navegação que fica à vista, agora
 * em CÁPSULAS com o recolhimento "BORDA VIVA (peek)".
 *
 * O M4.6 matou a sidebar de 240px e pôs tudo no NEXO (o overlay do hambúrguer).
 * O NEXO continua sendo o mapa GLOBAL e a busca, mas ele é um gesto: some quando
 * você solta. O dia a dia precisava de uma superfície PARADA — e é ela que diz,
 * sem que você peça, como cada Esfera está agora.
 *
 * Três faixas, de cima para baixo:
 *   1. A MARCA — o núcleo orbital leva ao Hub. É o botão "voltar para casa".
 *   2. AS ESFERAS, vivas — cada uma uma CÁPSULA: LED na cor + ícone + nome + a
 *      SegBar do progresso de HOJE. Não é uma lista de links: é telemetria.
 *   3. OS DESTINOS DE SISTEMA — Timeline, Insights, Metas Anuais, Conquistas,
 *      Configurações. O que não pertence a Esfera nenhuma porque pertence a todas.
 *
 * RECOLHIMENTO — "borda viva (peek)" (fase 10 §6): recolhida, o painel SOME por
 * inteiro (`translateX(-100%)`) e resta um FIO de 5px na borda esquerda pulsando na
 * cor da seção ATIVA (`--tint`) — dá pra saber onde você está sem abrir. Aproximar
 * o mouse da borda (ou `Ctrl/⌘+B`) faz o painel DESLIZAR pra dentro sobre o
 * conteúdo; ao sair, ele se esconde de novo. O estado fixo/oculto persiste em
 * `useUi.sidebarCollapsed`. Em reduced-motion o fio fica aceso e parado.
 *
 * Custo: UMA query (`sphere_overview`), a MESMA que o Hub já faz — o TanStack
 * Query dedupa pela chave, então a rail não acrescenta viagem nenhuma ao boot.
 */

import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  History,
  PanelLeftClose,
  Settings,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import { sphereOverview } from "../lib/ipc";
import { cx } from "../design-system/primitives";
import { SegBar } from "../design-system/instruments";
import { NexusMark } from "../design-system/NexusMark";
import { SphereIcon } from "../features/hub/SphereIcon";
import { useUi } from "../stores/ui";

const RAIL_W = 228;

/** Os destinos que não pertencem a Esfera nenhuma. */
const SYSTEM: Array<{ path: string; label: string; icon: LucideIcon }> = [
  { path: "/timeline", label: "Timeline", icon: History },
  { path: "/insights", label: "Insights", icon: Sparkles },
  { path: "/annual-goals", label: "Metas Anuais", icon: CalendarRange },
  { path: "/game", label: "Conquistas", icon: Trophy },
  { path: "/settings", label: "Configurações", icon: Settings },
];

export function CockpitRail() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);

  // A revelação transitória do peek: verdadeira enquanto o mouse está na borda ou
  // sobre o painel. Só importa quando `collapsed` — fixa, o painel está sempre lá.
  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  // Ctrl/⌘+B alterna fixo/oculto. Sai do peek transitório ao fixar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setRevealed(false);
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const show = !collapsed || revealed;
  const openPeek = () => {
    window.clearTimeout(hideTimer.current);
    setRevealed(true);
  };
  // Um respiro antes de esconder — o mouse cruza a fronteira painel↔conteúdo sem
  // que ele feche na cara do usuário.
  const closePeek = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setRevealed(false), 160);
  };

  return (
    // Em modo FIXO a rail ocupa a coluna (o conteúdo fica ao lado); recolhida, ela
    // colapsa para 0 e o painel vira um OVERLAY que desliza sobre o conteúdo.
    <div
      // A largura da COLUNA e o transform do PAINEL animam com a MESMA curva e
      // duração (fase 11, BUG 6) — antes o width corria em 200ms e o painel em
      // 400ms, e o descompasso lia como "seco". Agora deslizam juntos, suave.
      className="relative z-30 shrink-0 transition-[width] duration-[380ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ width: collapsed ? 0 : RAIL_W }}
    >
      {/* O FIO DE BORDA VIVA — só recolhida. Pulsa na cor da seção ativa. */}
      {collapsed && (
        <span
          aria-hidden
          className="nx-loop pointer-events-none absolute inset-y-0 left-0 z-10 w-[5px]"
          style={{
            background: "var(--tint)",
            boxShadow: "0 0 16px var(--tint)",
            animation: "nexus-edge-pulse 1.8s ease-in-out infinite",
            opacity: show ? 0 : undefined,
            transition: "opacity var(--dur-fast) var(--ease)",
          }}
        />
      )}

      {/* A zona de gatilho: uma faixa fina na borda que revela o painel ao hover. */}
      {collapsed && (
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 z-20 w-[14px]"
          onMouseEnter={openPeek}
        />
      )}

      {/* O PAINEL. Fixo: preenche a coluna. Recolhido: overlay que desliza. */}
      <aside
        aria-label="Navegação"
        onMouseEnter={collapsed ? openPeek : undefined}
        onMouseLeave={collapsed ? closePeek : undefined}
        className={cx(
          "absolute inset-y-0 left-0 z-20 flex flex-col",
          "border-r border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)]",
          "bg-[color-mix(in_srgb,var(--bg-surface)_82%,transparent)] backdrop-blur-[8px]",
          "transition-[transform] duration-[380ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
          collapsed && "shadow-[var(--shadow-float)]",
        )}
        style={{ width: RAIL_W, transform: show ? "translateX(0)" : "translateX(-100%)" }}
      >
        <RailBody onToggle={toggle} collapsed={collapsed} />
      </aside>
    </div>
  );
}

/** O conteúdo do painel — igual fixo ou revelado. */
function RailBody({ onToggle, collapsed }: { onToggle: () => void; collapsed: boolean }) {
  const navigate = useNavigate();
  const spheres = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview });
  const rows = (spheres.data ?? []).filter((s) => !s.archivedAt);

  return (
    <>
      {/* ===== 1. A marca ===== */}
      <button
        onClick={() => navigate("/")}
        title="Hub"
        className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 transition-colors hover:bg-[var(--bg-raised)]"
      >
        <NexusMark size={24} />
        <span className="font-mono text-[13px] font-bold tracking-[0.22em] text-[var(--text-primary)]">
          NEXUS
        </span>
      </button>

      {/* ===== 2. As Esferas, em cápsulas ===== */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-1.5 pt-1 pb-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
          Esferas
        </p>

        {rows.map((s) => {
          const total = s.habitsTodayTotal;
          const done = s.habitsTodayDone;
          const ratio = total > 0 ? done / total : 0;
          // O LED só fica "apagado" quando NÃO havia nada a fazer — zero de zero
          // não é falha (a regra do Score, ADR-0014). Com o dia cumprido ele
          // acende na cor da Esfera; parcial, âmbar; nada feito havendo o que
          // fazer, vermelho.
          const led =
            total === 0
              ? "var(--text-tertiary)"
              : ratio >= 1
                ? s.color
                : ratio > 0
                  ? "var(--warning)"
                  : "var(--danger)";

          return (
            <NavLink
              key={s.id}
              to={`/sphere/${s.id}`}
              style={{ ["--sphere" as string]: s.color }}
              className={({ isActive }) =>
                cx(
                  // A CÁPSULA (fase 10 §6): pílula com margem, cantos macios; a ativa
                  // preenche de leve na cor + barra lateral de 3px.
                  "group relative mb-0.5 flex items-center gap-2.5 rounded-[11px] border px-3 py-2 transition-colors",
                  isActive
                    ? "border-[color-mix(in_srgb,var(--sphere)_34%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]"
                    : "border-transparent hover:bg-[var(--bg-raised)]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute top-2 bottom-2 left-0 w-[3px] rounded-[2px]"
                      style={{ background: s.color }}
                    />
                  )}
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background: led,
                      boxShadow: `0 0 6px color-mix(in srgb, ${led} 55%, transparent)`,
                    }}
                  />
                  <SphereIcon name={s.icon} size={15} style={{ color: s.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cx(
                          "truncate text-[12.5px]",
                          isActive
                            ? "font-medium text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]",
                        )}
                      >
                        {s.name}
                      </span>
                      <span className="tabular shrink-0 font-mono text-[9.5px] text-[var(--text-tertiary)]">
                        {total > 0 ? `${done}/${total}` : "—"}
                      </span>
                    </div>
                    {/* A telemetria: o progresso de hoje. Some quando não há o que
                        medir — uma barra vazia afirmaria um zero que não aconteceu. */}
                    {total > 0 && (
                      <SegBar
                        value={ratio}
                        color={s.color}
                        segments={12}
                        height={4}
                        gap={2}
                        className="mt-1"
                        animate={false}
                      />
                    )}
                  </div>
                </>
              )}
            </NavLink>
          );
        })}

        {/* ===== 3. Os destinos de sistema ===== */}
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <p className="px-1.5 pb-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
            Sistema
          </p>
          {SYSTEM.map((d) => (
            <NavLink
              key={d.path}
              to={d.path}
              className={({ isActive }) =>
                cx(
                  "relative mb-0.5 flex items-center gap-2.5 rounded-[11px] border px-3 py-2 text-[12.5px] transition-colors",
                  isActive
                    ? "border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute top-2 bottom-2 left-0 w-[3px] rounded-[2px] bg-[var(--accent)]"
                    />
                  )}
                  <d.icon
                    size={16}
                    strokeWidth={2}
                    style={{ color: isActive ? "var(--accent)" : undefined }}
                  />
                  <span className="truncate">{d.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ===== O colapso (Ctrl/⌘+B) ===== */}
      <button
        onClick={onToggle}
        title={collapsed ? "Fixar a rail (Ctrl+B)" : "Recolher a rail (Ctrl+B)"}
        aria-label={collapsed ? "Fixar a rail" : "Recolher a rail"}
        className="flex h-9 shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
      >
        <PanelLeftClose size={15} />
        <span className="text-[12px]">{collapsed ? "Fixar" : "Recolher"}</span>
      </button>
    </>
  );
}
