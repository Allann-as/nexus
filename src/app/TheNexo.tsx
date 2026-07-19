/**
 * O NEXO — o menu central do NEXUS (M5.5 §3.3).
 *
 * Substitui o painel-lista lateral do hambúrguer (NavDrawer). Aquele era uma
 * gaveta de links; este é o mapa da sua vida num olhar. Três faixas, de cima
 * para baixo:
 *
 *   1. A FAIXA ORBITAL — o NexusMark ao centro e as suas Esferas orbitando num
 *      arco, cada uma com o anel de progresso de HOJE e o nível. É a resposta
 *      visual a "para onde vou?" antes de qualquer texto.
 *   2. A BUSCA + DESTINOS — o campo usa o MESMO motor do Ctrl+K (`useCommandRows`,
 *      uma superfície e não duas): vazio, mostra os destinos curados agrupados
 *      com micro-dado vivo; digitando, vira a busca da paleta.
 *   3. O RODAPÉ DE ESTADO — último backup, nível geral com barra de XP, e o
 *      Nexus Score de hoje.
 *
 * Teclado total: digitar filtra; 1–9 saltam para a Esfera daquela posição (só com
 * a busca vazia — senão o dígito é texto); setas + Enter percorrem a lista viva;
 * Esc fecha. Zero item morto: micro-dado só aparece quando é real.
 *
 * O fundo escurece e desfoca (UM backdrop-filter, na cortina); o painel é uma
 * superfície sólida — dois backdrop-filter empilhados são o que a §6 proíbe.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CalendarCheck,
  CalendarHeart,
  CalendarRange,
  Medal,
  FileText,
  History,
  Inbox,
  LayoutGrid,
  Search as SearchIcon,
  Settings,
  Sparkles,
  Target,
  Timer,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import {
  backupStatus,
  countNodes,
  dashboardToday,
  gamificationOverview,
  sphereOverview,
  weeklyReviewState,
  type Level,
  type SphereCard,
} from "../lib/ipc";
import { useCommandRows, type CommandRow } from "../features/command-palette/useCommandRows";
import { SphereIcon } from "../features/hub/SphereIcon";
import { ProgressRing } from "../design-system/charts";
import { NexusMark } from "../design-system/NexusMark";
import { cx, Kbd } from "../design-system/primitives";

interface Dest {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  jumpKey: string;
  /** Micro-dado vivo à direita. Só existe quando é real (zero item morto). */
  micro?: { text: string; tone?: "accent" | "warning" };
}

export function TheNexo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // As fontes só acordam com o menu aberto; fechado, dormem.
  const spheres = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview, enabled: open });
  const gami = useQuery({ queryKey: ["gamification"], queryFn: gamificationOverview, enabled: open });
  const today = useQuery({ queryKey: ["dashboard", "today"], queryFn: dashboardToday, enabled: open });
  const backup = useQuery({ queryKey: ["backup", "status"], queryFn: backupStatus, enabled: open });
  const review = useQuery({ queryKey: ["weekly-review", "state"], queryFn: weeklyReviewState, enabled: open });
  const inboxCount = useQuery({
    queryKey: ["nodes", "count", { kind: "inbox_item", status: "active" }],
    queryFn: () => countNodes({ kind: "inbox_item", status: "active" }),
    enabled: open,
  });

  const { rows, actionCount, resultCount } = useCommandRows(query, open);
  const searching = query.trim().length > 0;

  const levelByArea = useMemo(
    () => new Map<string, Level>((gami.data?.spheres ?? []).map((s) => [s.areaId, s.level])),
    [gami.data],
  );

  const sphereList = spheres.data ?? [];

  // Os destinos curados, agrupados por intenção. Micro-dado só quando real.
  const groups = useMemo(() => {
    const inbox = inboxCount.data ?? 0;
    const reviewOpen = review.data ? !review.data.completedThisWeek : false;
    return [
      {
        label: "Executar",
        items: [
          { id: "/", label: "Hub", icon: LayoutGrid, path: "/", jumpKey: "h" },
          { id: "/calendar", label: "Calendário", icon: Calendar, path: "/calendar", jumpKey: "c" },
          {
            id: "/inbox",
            label: "Inbox",
            icon: Inbox,
            path: "/inbox",
            jumpKey: "i",
            micro: inbox > 0 ? { text: String(inbox), tone: "accent" as const } : undefined,
          },
          { id: "/focus", label: "Foco", icon: Timer, path: "/focus", jumpKey: "f" },
        ] as Dest[],
      },
      {
        label: "Memória",
        items: [
          { id: "/notes", label: "Notas", icon: FileText, path: "/notes", jumpKey: "n" },
          { id: "/timeline", label: "Timeline", icon: History, path: "/timeline", jumpKey: "t" },
        ] as Dest[],
      },
      {
        label: "Análise",
        items: [
          { id: "/objectives", label: "Objetivos", icon: Target, path: "/objectives", jumpKey: "o" },
          { id: "/insights", label: "Insights", icon: Sparkles, path: "/insights", jumpKey: "s" },
          { id: "/game", label: "Conquistas", icon: Trophy, path: "/game", jumpKey: "q" },
          { id: "/annual-goals", label: "Metas Anuais", icon: CalendarRange, path: "/annual-goals", jumpKey: "a" },
          { id: "/perfect-weeks", label: "Semana Perfeita", icon: CalendarHeart, path: "/perfect-weeks", jumpKey: "w" },
          { id: "/records", label: "Recordes", icon: Medal, path: "/records", jumpKey: "k" },
          {
            id: "/review",
            label: "Revisão Semanal",
            icon: CalendarCheck,
            path: "/review",
            jumpKey: "r",
            micro: reviewOpen ? { text: "semana aberta", tone: "warning" as const } : undefined,
          },
        ] as Dest[],
      },
    ];
  }, [inboxCount.data, review.data]);

  const flatDests = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // A lista VIVA que setas + Enter percorrem: os resultados quando se digita,
  // os destinos curados quando não.
  const navCount = searching ? rows.length : flatDests.length;

  const go = (path: string) => {
    navigate(path);
    onClose();
  };
  const commitRow = (row: CommandRow | undefined) => {
    if (!row) return;
    row.run();
    onClose();
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setMounted(false);
      inputRef.current?.focus();
      // Dispara o alinhamento dos anéis no próximo frame (a transição precisa de
      // um estado inicial pintado antes de mudar).
      const r = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(r);
    }
  }, [open]);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, navCount - 1)));
  }, [navCount]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 1–9 saltam para a Esfera daquela posição — mas só com a busca vazia, senão
    // o dígito faz parte do que se digita.
    if (!query && /^[1-9]$/.test(e.key)) {
      const sphere = sphereList[Number(e.key) - 1];
      if (sphere) {
        e.preventDefault();
        go(`/sphere/${sphere.id}`);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % Math.max(1, navCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + navCount) % Math.max(1, navCount));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searching) commitRow(rows[selected]);
      else {
        const d = flatDests[selected];
        if (d) go(d.path);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto" onMouseDown={onClose}>
      {/* A cortina: escurece e desfoca o app atrás. UM backdrop-filter — o painel
          abaixo é sólido de propósito (a §6 proíbe dois empilhados). */}
      <div
        aria-hidden
        className="fixed inset-0 bg-[color-mix(in_srgb,var(--bg-void)_72%,transparent)] backdrop-blur-md"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="O Nexo"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="nx-enter relative z-10 my-auto flex max-h-[92vh] w-[760px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-[var(--shadow-float)]"
      >
        {/* ===== 1. O MAPA RADIAL ===== */}
        <RadialMap
          spheres={sphereList}
          levelByArea={levelByArea}
          mounted={mounted}
          onPick={(id) => go(`/sphere/${id}`)}
          onHub={() => go("/")}
        />

        {/* ===== 2. BUSCA + DESTINOS ===== */}
        <div className="flex items-center gap-2.5 border-y border-[var(--border-subtle)] px-5">
          <SearchIcon size={15} className="shrink-0 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Buscar em tudo, ou ir para…"
            aria-label="Buscar ou navegar"
            className="w-full bg-transparent py-3.5 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {searching ? (
            <SearchResults
              rows={rows}
              selected={selected}
              actionCount={actionCount}
              resultCount={resultCount}
              onHover={setSelected}
              onCommit={commitRow}
              query={query}
            />
          ) : (
            <DestGroups
              groups={groups}
              selected={selected}
              onHover={setSelected}
              onPick={go}
            />
          )}
        </div>

        {/* ===== 3. O RODAPÉ DE ESTADO ===== */}
        <StateFooter
          backupMs={backup.data?.lastBackupMs ?? null}
          overall={gami.data?.overall}
          score={today.data?.score.value ?? null}
          onSettings={() => go("/settings")}
        />
      </div>
    </div>
  );
}

/* ===================== O mapa radial ===================== */

/**
 * O NexusMark no centro e as Esferas num CÍRCULO COMPLETO à volta (REFINO R1) —
 * um mapa mental da vida, não um arco. Linhas finas de constelação ligam o centro
 * a cada Esfera; o centro leva ao Hub, cada Esfera à sua tela. Na abertura, os
 * anéis se alinham num gesto sutil (200ms); estático em reduced-motion.
 */
function RadialMap({
  spheres,
  levelByArea,
  mounted,
  onPick,
  onHub,
}: {
  spheres: SphereCard[];
  levelByArea: Map<string, Level>;
  mounted: boolean;
  onPick: (id: string) => void;
  onHub: () => void;
}) {
  const W = 760;
  const H = 320;
  const cx0 = W / 2;
  const cy0 = 150;
  const R = 112;
  const n = spheres.length;

  // Posição de cada Esfera no círculo: começa no topo (−90°) e distribui igual.
  const pos = (i: number) => {
    const deg = -90 + (i * 360) / Math.max(1, n);
    const rad = (deg * Math.PI) / 180;
    return [cx0 + R * Math.cos(rad), cy0 + R * Math.sin(rad)] as const;
  };

  return (
    <div className="relative shrink-0 overflow-hidden" style={{ height: H }}>
      {/* o anel da órbita + as linhas de constelação do centro a cada Esfera */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        fill="none"
        aria-hidden
      >
        <circle
          cx={cx0}
          cy={cy0}
          r={R}
          stroke="var(--border-strong)"
          strokeWidth="1"
          strokeDasharray="2 5"
          opacity="0.5"
        />
        {spheres.map((s, i) => {
          const [x, y] = pos(i);
          return (
            <line
              key={s.id}
              x1={cx0}
              y1={cy0}
              x2={x}
              y2={y}
              stroke="var(--border-strong)"
              strokeWidth="1"
              opacity={mounted ? 0.4 : 0}
              style={{ transition: "opacity 200ms var(--ease)", transitionDelay: `${i * 28}ms` }}
            />
          );
        })}
      </svg>

      {/* o NexusMark ao centro — clicar leva ao Hub */}
      <button
        onClick={onHub}
        title="Hub"
        aria-label="Ir para o Hub"
        className="group absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-[var(--dur-fast)] hover:scale-105"
        style={{ left: cx0, top: cy0 }}
      >
        <span
          className="grid place-items-center rounded-full p-1.5"
          style={{ boxShadow: "0 0 32px color-mix(in srgb, var(--accent) 22%, transparent)" }}
        >
          <NexusMark size={52} />
        </span>
      </button>

      {n === 0 ? (
        <p className="absolute inset-x-0 bottom-5 text-center text-[12px] text-[var(--text-tertiary)]">
          Nenhuma Esfera ativa.
        </p>
      ) : (
        spheres.map((s, i) => {
          const [x, y] = pos(i);
          const total = s.habitsTodayTotal;
          const ratio = total > 0 ? s.habitsTodayDone / total : 0;
          const level = levelByArea.get(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              title={`${s.name}${total > 0 ? ` · ${s.habitsTodayDone}/${total} hoje` : ""}`}
              style={
                {
                  left: x,
                  top: y,
                  "--sphere": s.color,
                  // o alinhamento dos anéis: partem do centro e assentam no lugar.
                  transform: mounted
                    ? "translate(-50%, -50%) scale(1)"
                    : `translate(-50%, -50%) translate(${(cx0 - x) * 0.5}px, ${(cy0 - y) * 0.5}px) scale(0.7)`,
                  opacity: mounted ? 1 : 0,
                  transition: "transform 200ms var(--ease), opacity 200ms var(--ease)",
                  transitionDelay: `${i * 28}ms`,
                } as React.CSSProperties
              }
              className="group absolute flex flex-col items-center gap-1"
            >
              <span className="relative grid place-items-center">
                <ProgressRing value={ratio} size={52} thickness={3}>
                  <span
                    className="grid size-9 place-items-center rounded-full transition-transform duration-[var(--dur-fast)] group-hover:scale-110"
                    style={{ background: "color-mix(in srgb, var(--sphere) 16%, var(--bg-raised))" }}
                  >
                    <SphereIcon name={s.icon} size={18} style={{ color: "var(--sphere)" }} />
                  </span>
                </ProgressRing>
                {level && level.xp > 0 && (
                  <span
                    className="tabular absolute -right-1 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-[var(--bg-void)]"
                    style={{ background: "var(--sphere)" }}
                    title={`${level.xp.toLocaleString("pt-BR")} XP`}
                  >
                    {level.level}
                  </span>
                )}
              </span>
              <span className="max-w-[84px] truncate text-[10px] font-medium text-[var(--text-secondary)]">
                {s.name}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

/* ===================== Os destinos curados ===================== */

function DestGroups({
  groups,
  selected,
  onHover,
  onPick,
}: {
  groups: { label: string; items: Dest[] }[];
  selected: number;
  onHover: (i: number) => void;
  onPick: (path: string) => void;
}) {
  let idx = -1;
  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="mb-1">
          <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
            {g.label}
          </div>
          {g.items.map((d) => {
            idx += 1;
            const i = idx;
            return (
              <button
                key={d.id}
                data-index={i}
                onMouseMove={() => onHover(i)}
                onClick={() => onPick(d.path)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left",
                  i === selected ? "bg-[var(--bg-hover)]" : "bg-transparent",
                )}
                style={{ height: "var(--row-list)" }}
              >
                <d.icon
                  size={16}
                  strokeWidth={1.9}
                  className={cx(
                    "shrink-0",
                    i === selected ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]",
                  )}
                />
                <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
                  {d.label}
                </span>
                {d.micro && (
                  <span
                    className={cx(
                      "tabular shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      d.micro.tone === "warning"
                        ? "text-[var(--warning)]"
                        : "text-[var(--accent)]",
                    )}
                    style={{
                      background:
                        d.micro.tone === "warning"
                          ? "color-mix(in srgb, var(--warning) 14%, transparent)"
                          : "color-mix(in srgb, var(--accent) 14%, transparent)",
                    }}
                  >
                    {d.micro.text}
                  </span>
                )}
                <Kbd>G {d.jumpKey.toUpperCase()}</Kbd>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

/* ===================== A busca (motor do Ctrl+K) ===================== */

function SearchResults({
  rows,
  selected,
  actionCount,
  resultCount,
  onHover,
  onCommit,
  query,
}: {
  rows: CommandRow[];
  selected: number;
  actionCount: number;
  resultCount: number;
  onHover: (i: number) => void;
  onCommit: (row: CommandRow) => void;
  query: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        Nada encontrado para “{query}”.
      </p>
    );
  }
  return (
    <>
      {rows.map((row, i) => (
        <div key={row.id}>
          {i === actionCount && actionCount > 0 && resultCount > 0 && (
            <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
              Resultados
            </div>
          )}
          <button
            data-index={i}
            onMouseMove={() => onHover(i)}
            onClick={() => onCommit(row)}
            className={cx(
              "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left",
              i === selected ? "bg-[var(--bg-hover)]" : "bg-transparent",
            )}
            style={{ height: "var(--row-list)" }}
          >
            <row.icon
              size={15}
              strokeWidth={1.9}
              className={cx(
                "shrink-0",
                i === selected ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]",
              )}
            />
            <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
              {row.label}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
              {row.hint}
            </span>
          </button>
        </div>
      ))}
    </>
  );
}

/* ===================== O rodapé de estado ===================== */

function StateFooter({
  backupMs,
  overall,
  score,
  onSettings,
}: {
  backupMs: number | null;
  overall: Level | undefined;
  score: number | null;
  onSettings: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 py-3 text-[11px]">
      <span className="text-[var(--text-tertiary)]">
        {backupMs != null ? (
          <>
            Último backup{" "}
            <span className="text-[var(--text-secondary)]">{relTime(backupMs)}</span>
          </>
        ) : (
          "Backup ainda não configurado"
        )}
      </span>

      {overall && (
        <span className="flex items-center gap-2 text-[var(--text-tertiary)]">
          <span>
            Nível <strong className="tabular text-[var(--text-secondary)]">{overall.level}</strong>
          </span>
          <span className="h-1 w-20 overflow-hidden rounded-full bg-[var(--bg-surface)]">
            <span
              className="block h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${overall.span > 0 ? (overall.intoLevel / overall.span) * 100 : 0}%` }}
            />
          </span>
          <span className="tabular">{overall.xp.toLocaleString("pt-BR")} XP</span>
        </span>
      )}

      <span className="flex items-center gap-3">
        <span className="text-[var(--text-tertiary)]">
          Score{" "}
          <strong className="tabular text-[var(--text-secondary)]">
            {score != null ? score : "—"}
          </strong>
        </span>
        <button
          onClick={onSettings}
          aria-label="Configurações"
          className="grid size-6 place-items-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
        >
          <Settings size={14} />
        </button>
      </span>
    </div>
  );
}

/** Tempo relativo curto, em pt-BR: "há 2 h", "há 3 dias", "agora". */
function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}
