/**
 * O HUB — o COMMAND DECK (v1.3 COCKPIT, §2.1).
 *
 * O Hub do Midnight respondia "como vai a vida?" com uma grade de Esferas grandes,
 * um velocímetro e uma faixa "hoje" no rodapé. Três coisas foram reprovadas em uso
 * real: o VELOCÍMETRO (ponteiro, imprecisão), os ESPAÇOS VAZIOS (cards soltos numa
 * página larga) e a LINHA DO DIA no rodapé. O Command Deck reorganiza em duas
 * colunas densas, e a rail à esquerda passa a carregar a telemetria das Esferas.
 *
 * A leitura, agora:
 *
 *   RAIL (fora daqui) → como cada Esfera está AGORA
 *   CENTRO            → você (saudação + nível), seu dia (Score), seus números
 *   DIREITA           → e agora? (agenda) e o que vem (marcos com D-dias)
 *
 * O Score perdeu o ponteiro e ganhou o que o plano pede: número mono grande +
 * SegBar horizontal + o delta contra ontem. Um medidor segmentado se lê com
 * precisão; um ponteiro pede que você estime o ângulo.
 *
 * Custo: sete queries, todas indexadas e nenhuma crescendo com o tamanho da
 * história. As três novas (finanças, semanas perfeitas, horizonte) alimentam
 * ladrilhos que o plano exige preenchidos — e o TanStack dedupa as que a rail e
 * as outras telas já pedem.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheck,
  Flame,
  Info,
  LayoutGrid,
  Plus,
  Trophy,
  Wallet,
} from "lucide-react";

import {
  dashboardToday,
  financeOverview,
  gamificationOverview,
  getInsights,
  perfectWeekView,
  scoreHistory,
  sphereOverview,
  toNexusError,
  type Level,
} from "../../lib/ipc";
import { Button, PageContainer, cx } from "../../design-system/primitives";
import { StatTile } from "../../design-system/cards";
import { Sparkline } from "../../design-system/charts";
import { SegBar, MonoLabel, Terminal } from "../../design-system/instruments";
import { ScoreDetail } from "./ScoreDetail";
import { SphereCard } from "./SphereCard";
import { DayAgenda } from "./DayAgenda";
import { NextMilestones } from "./NextMilestones";
import { OnThisDay } from "../timeline/OnThisDay";
import { greeting, useDisplayName } from "../../lib/greeting";
import { prefersReducedMotion } from "../../lib/motion";

export function HubScreen() {
  const navigate = useNavigate();
  const [showMath, setShowMath] = useState(false);
  const displayName = useDisplayName();
  const year = new Date().getFullYear();

  const spheres = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview });
  const today = useQuery({ queryKey: ["dashboard", "today"], queryFn: dashboardToday });
  const gami = useQuery({ queryKey: ["gamification"], queryFn: gamificationOverview });
  const scores = useQuery({ queryKey: ["score-history", 30], queryFn: () => scoreHistory(30) });
  const insights = useQuery({ queryKey: ["insights", "cache"], queryFn: getInsights });
  const fin = useQuery({ queryKey: ["finance", "overview"], queryFn: financeOverview });
  const pw = useQuery({ queryKey: ["perfect-weeks", year], queryFn: () => perfectWeekView(year) });

  const levelByArea = new Map<string, Level>(
    (gami.data?.spheres ?? []).map((s) => [s.areaId, s.level]),
  );

  // Atalhos 1–9: abre a Esfera daquela posição. O Hub é a tela mais aberta do
  // app, e teclado-primeiro é regra da constituição.
  const list = spheres.data ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const sphere = list[n - 1];
      if (sphere) navigate(`/sphere/${sphere.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, navigate]);

  const error = spheres.error ?? today.error;
  if (error) {
    return (
      <div className="nx-page h-full p-8">
        <div className="rounded-[var(--radius-lg)] border border-[var(--danger)] bg-[var(--bg-surface)] p-4">
          <p className="text-[13px] text-[var(--danger)]">{toNexusError(error).message}</p>
        </div>
      </div>
    );
  }

  const score = today.data?.score;
  const points = scores.data ?? [];

  // O delta contra ONTEM. Só existe com dois dias fechados — inventar "▲0" no
  // primeiro dia seria afirmar uma estabilidade que não foi medida.
  const delta = useMemo(() => {
    if (points.length < 2 || score?.value == null) return null;
    const prev = points[points.length - 2]?.value;
    if (prev == null) return null;
    return Math.round(score.value - prev);
  }, [points, score?.value]);

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <PageContainer className="pt-8 pb-12">
        {/* Duas colunas: o deck no centro, a coluna de "e agora?" à direita.
            `minmax(0,1fr)` e não `1fr`: o padrão de uma trilha de grid é
            `minmax(auto,1fr)`, e o `auto` faz a coluna respeitar o min-content
            dos filhos — uma SegBar de 40 segmentos ou um número mono grande
            empurrariam a coluna direita para fora. O zero explícito manda a
            coluna poder encolher. Abaixo de `lg` as duas empilham. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ==================== CENTRO ==================== */}
          <div className="min-w-0 space-y-5">
            {/* ===== saudação + nível ===== */}
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
                  <TypedGreeting text={`${greeting()}, ${displayName}`} />
                </h1>
                <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">
                  {today.data ? formatDay(today.data.day) : " "}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" icon={Plus} onClick={() => navigate("/areas")}>
                  Nova Esfera
                </Button>
              </div>
            </header>

            {/* O nível geral em SegBar — o XP deixa de ser uma barrinha de 96px
                perdida sob a saudação e vira uma linha de instrumento. */}
            {gami.data && (
              <button
                onClick={() => navigate("/game")}
                className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--border-glow)]"
              >
                <Trophy size={14} className="shrink-0 text-[var(--accent)]" aria-hidden />
                <MonoLabel>Nível {gami.data.overall.level}</MonoLabel>
                <SegBar
                  value={
                    gami.data.overall.span > 0
                      ? gami.data.overall.intoLevel / gami.data.overall.span
                      : 0
                  }
                  color="var(--accent)"
                  segments={28}
                  height={8}
                  className="min-w-0 flex-1"
                />
                <span className="tabular shrink-0 text-[11px] text-[var(--text-secondary)]">
                  {gami.data.overall.xp.toLocaleString("pt-BR")} XP
                </span>
              </button>
            )}

            {/* ===== alerta de carga (só quando dispara) ===== */}
            {insights.data?.burnout?.alert && (
              <button
                onClick={() => navigate("/insights")}
                className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border p-3.5 text-left"
                style={{
                  borderColor: "var(--warning)",
                  background: "color-mix(in srgb, var(--warning) 8%, var(--bg-surface))",
                }}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full"
                  style={{
                    background: "color-mix(in oklab, var(--warning) 18%, transparent)",
                    color: "var(--warning)",
                  }}
                >
                  <Flame size={17} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                    Sua carga está acima do normal
                  </span>
                  <span className="block text-[12px] text-[var(--text-secondary)]">
                    Esta semana está em{" "}
                    <strong className="tabular text-[var(--text-primary)]">
                      {insights.data.burnout.ratio.toFixed(2)}×
                    </strong>{" "}
                    a média das últimas {insights.data.burnout.baselineWeeks} semanas. Ver nos
                    Insights →
                  </span>
                </span>
              </button>
            )}

            {/* ===== o Nexus Score, sem velocímetro ===== */}
            <Terminal title="Nexus Score" icon={CalendarCheck} tone="phos">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                <div className="flex items-baseline gap-2">
                  {score?.value == null ? (
                    <span className="tabular text-[52px] leading-none font-bold text-[var(--text-tertiary)]">
                      —
                    </span>
                  ) : (
                    <span
                      className="tabular text-[52px] leading-none font-bold tracking-[-0.03em]"
                      style={{ color: scoreColor(score.value) }}
                    >
                      {Math.round(score.value)}
                    </span>
                  )}
                  <span className="text-[14px] text-[var(--text-tertiary)]">/100</span>
                  {delta != null && delta !== 0 && (
                    <span
                      className="tabular ml-1 text-[12px] font-semibold"
                      style={{ color: delta > 0 ? "var(--success)" : "var(--danger)" }}
                    >
                      {delta > 0 ? "▲" : "▼"}
                      {Math.abs(delta)} <span className="font-normal text-[var(--text-tertiary)]">vs ontem</span>
                    </span>
                  )}
                </div>

                {points.length >= 2 && (
                  <div className="flex flex-col gap-0.5">
                    <Sparkline
                      data={points.map((p) => p.value / 100)}
                      color={scoreColor(points[points.length - 1].value)}
                      width={150}
                      height={30}
                    />
                    <MonoLabel>últimos {points.length} dias</MonoLabel>
                  </div>
                )}
              </div>

              <SegBar
                value={(score?.value ?? 0) / 100}
                color={scoreColor(score?.value ?? null)}
                segments={40}
                height={12}
                className="mt-4"
              />

              {score && (
                <button
                  onClick={() => setShowMath((s) => !s)}
                  className={cx(
                    "mt-3 inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] transition-colors",
                    showMath
                      ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                  )}
                >
                  <Info size={10} />
                  como calculamos
                </button>
              )}
              {showMath && score && <ScoreDetail score={score} onClose={() => setShowMath(false)} />}
            </Terminal>

            {/* ===== a grade densa de ladrilhos ===== */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                icon={Flame}
                label="Sequência"
                value={bestStreak(list)}
                unit="dias"
                hint={bestStreakTitle(list) ?? undefined}
                tone="warning"
              />
              <StatTile
                icon={CalendarCheck}
                label="Hoje"
                value={`${habitsDone(list)}/${habitsTotal(list)}`}
                ring={habitsTotal(list) > 0 ? habitsDone(list) / habitsTotal(list) : 0}
              />
              <StatTile
                icon={Wallet}
                label="Patrimônio"
                value={fin.data ? formatMoney(fin.data.portfolioCents ?? fin.data.totalContributedCents) : "—"}
                spark={monthlySpark(fin.data?.monthly)}
                tone="cyan"
                onClick={() => navigate("/objectives")}
              />
              <StatTile
                icon={Trophy}
                label="Conquistas"
                value={unlockedCount(gami.data?.achievements)}
                seg={unlockedRatio(gami.data?.achievements)}
                tone="violet"
                onClick={() => navigate("/game")}
              />
            </div>

            {/* ===== as Esferas ===== */}
            <section>
              <MonoLabel>Suas Esferas</MonoLabel>
              {spheres.isPending ? (
                <SkeletonGrid />
              ) : list.length === 0 ? (
                <div className="mt-3 flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] p-10 text-center">
                  <span className="grid size-12 place-items-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <LayoutGrid
                      size={20}
                      className="text-[var(--text-tertiary)]"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </span>
                  <p className="text-[13px] text-[var(--text-tertiary)]">
                    Nenhuma Esfera ativa. Todas arquivadas?
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => navigate("/areas")}>
                    Gerenciar Esferas
                  </Button>
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {list.map((sphere, i) => (
                    <SphereCard
                      key={sphere.id}
                      sphere={sphere}
                      index={i}
                      level={levelByArea.get(sphere.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ==================== COLUNA DIREITA ==================== */}
          <aside className="min-w-0 space-y-4">
            <DayAgenda data={today.data} isPending={today.isPending} />
            <NextMilestones />
            {/* A semana perfeita é um número pequeno e orgulhoso: cabe na coluna,
                não merece um ladrilho da grade principal. */}
            {pw.data && (
              <button
                onClick={() => navigate("/perfect-weeks")}
                className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--border-glow)]"
              >
                <CalendarCheck size={14} className="shrink-0 text-[var(--accent)]" aria-hidden />
                <MonoLabel>Semanas perfeitas</MonoLabel>
                <span className="tabular ml-auto text-[15px] font-bold text-[var(--text-primary)]">
                  {pw.data.totalYear}
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">em {year}</span>
              </button>
            )}
            <OnThisDay compact />
          </aside>
        </div>
      </PageContainer>
    </div>
  );
}

/**
 * A SAUDAÇÃO DIGITADA (fase 10 §8) — datilografa letra a letra na ENTRADA do Hub,
 * com o cursor piscando. O cursor pisca por ~6s e some (um cursor eterno cansa). O
 * componente só datilografa ao MONTAR (a entrada do Hub), nunca a cada re-render:
 * navegar para fora e voltar remonta, e aí sim re-datilografa. Em reduced-motion,
 * o texto aparece pronto e sem cursor.
 */
function TypedGreeting({ text }: { text: string }) {
  const reduce = prefersReducedMotion();
  const [shown, setShown] = useState(reduce ? text.length : 0);
  const [caret, setCaret] = useState(!reduce);

  useEffect(() => {
    if (reduce) {
      setShown(text.length);
      setCaret(false);
      return;
    }
    let i = 0;
    let typeT = 0;
    let hideT = 0;
    const startT = window.setTimeout(function tk() {
      i += 1;
      setShown(i);
      if (i < text.length) {
        typeT = window.setTimeout(tk, 70);
      } else {
        hideT = window.setTimeout(() => setCaret(false), 6000);
      }
    }, 400);
    return () => {
      window.clearTimeout(startT);
      window.clearTimeout(typeT);
      window.clearTimeout(hideT);
    };
  }, [text, reduce]);

  return (
    <>
      {text.slice(0, shown)}
      {caret && (
        <span
          aria-hidden
          className="nx-loop ml-1 inline-block h-[0.82em] w-[3px] translate-y-[1px] bg-[var(--accent)] align-baseline"
          style={{ animation: "nexus-caret 1.06s steps(2, jump-none) infinite" }}
        />
      )}
    </>
  );
}

/* ===== derivações de ladrilho — puras, sobre o que já veio ===== */

type Sphere = { bestStreak: number; bestStreakTitle: string | null; habitsTodayDone: number; habitsTodayTotal: number };

function bestStreak(list: Sphere[]): number {
  return list.reduce((m, s) => Math.max(m, s.bestStreak), 0);
}
function bestStreakTitle(list: Sphere[]): string | null {
  return list.reduce<Sphere | null>((b, s) => (b == null || s.bestStreak > b.bestStreak ? s : b), null)
    ?.bestStreakTitle ?? null;
}
function habitsDone(list: Sphere[]): number {
  return list.reduce((n, s) => n + s.habitsTodayDone, 0);
}
function habitsTotal(list: Sphere[]): number {
  return list.reduce((n, s) => n + s.habitsTodayTotal, 0);
}

function unlockedCount(entries: Array<{ unlocked: boolean }> | undefined): number {
  return (entries ?? []).filter((e) => e.unlocked).length;
}
function unlockedRatio(entries: Array<{ unlocked: boolean }> | undefined): number {
  const all = entries ?? [];
  return all.length > 0 ? unlockedCount(all) / all.length : 0;
}

/** Os aportes mensais normalizados em 0..1 para a sparkline do ladrilho. */
function monthlySpark(monthly: Array<{ cents: number }> | undefined): number[] | undefined {
  const rows = monthly ?? [];
  if (rows.length < 2) return undefined;
  const max = rows.reduce((m, r) => Math.max(m, r.cents), 0);
  if (max <= 0) return undefined;
  return rows.map((r) => r.cents / max);
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** Placeholder com a forma final do card — o layout não pula quando os dados chegam. */
function SkeletonGrid() {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-[172px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

function formatDay(day: string): string {
  const s = new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreColor(v: number | null): string {
  if (v == null) return "var(--text-tertiary)";
  if (v >= 80) return "var(--success)";
  if (v >= 50) return "var(--warning)";
  return "var(--danger)";
}
