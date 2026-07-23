/**
 * A RAIL do Cockpit (v1.3, §2.1) — a navegação que fica à vista.
 *
 * O M4.6 matou a sidebar de 240px e pôs tudo no NEXO (o overlay do hambúrguer).
 * O NEXO continua sendo o mapa GLOBAL e a busca, mas ele é um gesto: some quando
 * você solta. O dia a dia precisava de uma superfície PARADA — e é ela que diz,
 * sem que você peça, como cada Esfera está agora.
 *
 * Três faixas, de cima para baixo:
 *   1. A MARCA — o SINAL-N leva ao Hub. É o botão "voltar para casa".
 *   2. AS ESFERAS, vivas — LED na cor da Esfera + nome + SegBar do progresso de
 *      HOJE. Não é uma lista de links: é telemetria. Olhar a rail já responde
 *      "o que está no vermelho?" antes de qualquer clique.
 *   3. OS DESTINOS DE SISTEMA — Timeline, Insights, Metas Anuais, Conquistas,
 *      Configurações. O que não pertence a Esfera nenhuma porque pertence a todas.
 *
 * COLAPSÁVEL: recolhida, sobra a coluna de LEDs e ícones (a `--rail-w` de 56px) —
 * a telemetria sobrevive ao colapso, que é o ponto. O estado persiste no
 * `useUi.sidebarCollapsed` (preferência de chrome, localStorage).
 *
 * Custo: UMA query (`sphere_overview`), a MESMA que o Hub já faz — o TanStack
 * Query dedupa pela chave, então a rail não acrescenta viagem nenhuma ao boot.
 */

import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
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
  const navigate = useNavigate();

  const spheres = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview });
  const rows = (spheres.data ?? []).filter((s) => !s.archivedAt);

  return (
    <aside
      className={cx(
        // Translúcida + blur (fase 9 §4): a poeira estelar corre atrás dela, e a
        // rail deixa de ser um bloco de cor destoante para virar parte do
        // ambiente. Um só backdrop-filter aqui (não por linha) — barato.
        "flex shrink-0 flex-col border-r border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)]",
        "bg-[color-mix(in_srgb,var(--bg-surface)_72%,transparent)] backdrop-blur-[8px]",
        "transition-[width] duration-[var(--dur-base)] ease-[var(--ease)]",
        collapsed ? "w-[var(--rail-w)]" : "w-[228px]",
      )}
    >
      {/* ===== 1. A marca ===== */}
      <button
        onClick={() => navigate("/")}
        title="Hub"
        className={cx(
          "flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 transition-colors hover:bg-[var(--bg-raised)]",
          collapsed && "justify-center px-0",
        )}
      >
        <NexusMark size={24} />
        {!collapsed && (
          <span className="font-mono text-[13px] font-bold tracking-[0.22em] text-[var(--text-primary)]">
            NEXUS
          </span>
        )}
      </button>

      {/* ===== 2. As Esferas, vivas ===== */}
      <nav className="min-h-0 flex-1 overflow-y-auto py-2">
        {!collapsed && (
          <p className="px-3.5 pt-1 pb-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
            Esferas
          </p>
        )}

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
              title={collapsed ? `${s.name} — ${done}/${total} hoje` : undefined}
              style={{ ["--sphere" as string]: s.color }}
              className={({ isActive }) =>
                cx(
                  "group relative flex items-center gap-2.5 px-3.5 py-2 transition-colors",
                  collapsed && "justify-center px-0",
                  isActive ? "bg-[color-mix(in_srgb,var(--sphere)_12%,transparent)]" : "hover:bg-[var(--bg-raised)]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* A barra de seleção, na cor da Esfera. */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[2px]"
                      style={{ background: s.color }}
                    />
                  )}

                  {collapsed ? (
                    <span className="relative">
                      <SphereIcon name={s.icon} size={18} style={{ color: s.color }} />
                      <span
                        aria-hidden
                        className="absolute -top-0.5 -right-1 size-[6px] rounded-full"
                        style={{ background: led }}
                      />
                    </span>
                  ) : (
                    <>
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
                              "truncate text-[13px]",
                              isActive
                                ? "font-medium text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]",
                            )}
                          >
                            {s.name}
                          </span>
                          <span className="tabular shrink-0 text-[10px] text-[var(--text-tertiary)]">
                            {total > 0 ? `${done}/${total}` : "—"}
                          </span>
                        </div>
                        {/* A telemetria: o progresso de hoje. Some quando não há
                            o que medir — uma barra vazia afirmaria um zero que
                            não aconteceu. */}
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
                </>
              )}
            </NavLink>
          );
        })}

        {/* ===== 3. Os destinos de sistema ===== */}
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          {!collapsed && (
            <p className="px-3.5 pb-2 font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase">
              Sistema
            </p>
          )}
          {SYSTEM.map((d) => (
            <NavLink
              key={d.path}
              to={d.path}
              title={collapsed ? d.label : undefined}
              className={({ isActive }) =>
                cx(
                  "relative flex items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 w-[2px] bg-[var(--accent)]"
                    />
                  )}
                  <d.icon
                    size={16}
                    strokeWidth={2}
                    style={{ color: isActive ? "var(--accent)" : undefined }}
                  />
                  {!collapsed && <span className="truncate">{d.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ===== O colapso ===== */}
      <button
        onClick={toggle}
        title={collapsed ? "Expandir a rail" : "Recolher a rail"}
        aria-label={collapsed ? "Expandir a rail" : "Recolher a rail"}
        className={cx(
          "flex h-9 shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] px-3.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        {!collapsed && <span className="text-[12px]">Recolher</span>}
      </button>
    </aside>
  );
}
