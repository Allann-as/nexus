/**
 * Ano em Pixels (ARSENAL) — 365 células coloridas pelo Nexus Score do dia.
 *
 * O visual mais denso do app. Cada célula é um dia; a cor é o score (0–100) numa
 * rampa índigo da marca. Prefere o score CONGELADO (o que você viu); onde não há,
 * computa o comportamental na hora (ADR-0061). SVG puro — são ~365 retângulos,
 * não vale uma engine de gráfico (ADR-0018).
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";

import { yearInPixels, type ScoreCell } from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, EmptyState, cx } from "../../design-system/primitives";
import { Formula } from "../../design-system/Formula";

const CELL = 13;
const GAP = 3;
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function YearPixelsScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const q = useQuery({ queryKey: ["year-pixels", year], queryFn: () => yearInPixels(year) });
  const cells = q.data ?? [];
  const scored = cells.filter((c) => c.value != null);
  const avg =
    scored.length > 0
      ? Math.round(scored.reduce((s, c) => s + (c.value ?? 0), 0) / scored.length)
      : null;
  const best = scored.reduce<ScoreCell | null>(
    (b, c) => (b == null || (c.value ?? 0) > (b.value ?? 0) ? c : b),
    null,
  );

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Ano em Pixels"
        subtitle="Cada dia do ano, colorido pelo seu Nexus Score"
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setYear((y) => y - 1)}
              aria-label="Ano anterior"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="tabular w-14 text-center text-[14px] font-semibold text-[var(--text-primary)]">
              {year}
            </span>
            <button
              onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
              disabled={year >= currentYear}
              aria-label="Próximo ano"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      <div className={cx(PAGE_CONTAINER, "flex flex-col gap-4 pb-10")}>
        {q.isSuccess && cells.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon={LayoutGrid}
              title={`Nada em ${year} ainda`}
              hint="O ano em pixels desenha o Nexus Score de cada dia. Use o app — marque hábitos, feche tarefas — e os dias ganham cor conforme o dia rende."
            />
          </Card>
        ) : (
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-5">
                <Stat label="Média do ano" value={avg != null ? String(avg) : "—"} />
                <Stat
                  label="Melhor dia"
                  value={best?.value != null ? String(best.value) : "—"}
                  sub={best ? niceDay(best.day) : undefined}
                />
                <Stat label="Dias com nota" value={String(scored.length)} />
              </div>
              <Legend />
            </div>
            <div className="overflow-x-auto pb-1">
              <PixelGrid cells={cells} year={year} />
            </div>
            <Formula>
              Cor = Nexus Score comportamental do dia (40% hábitos agendados + 30%
              tarefas planejadas, redistribuído). Prefere o valor congelado; onde não
              há, computa a mesma fórmula sobre os ticks e tarefas do dia.
            </Formula>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[22px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
          {value}
        </span>
        {sub && <span className="text-[11px] text-[var(--text-tertiary)]">{sub}</span>}
      </div>
      <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{label}</p>
    </div>
  );
}

/** A cor de um score, numa rampa índigo de 5 passos (o "vazio" some no fundo). */
function colourFor(value: number | null): string {
  if (value == null) return "color-mix(in srgb, var(--text-tertiary) 12%, transparent)";
  const pct = value >= 80 ? 100 : value >= 60 ? 78 : value >= 40 ? 56 : value >= 20 ? 34 : 18;
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--bg-base))`;
}

function PixelGrid({ cells, year }: { cells: ScoreCell[]; year: number }) {
  const { columns, monthTicks } = useMemo(() => buildColumns(cells, year), [cells, year]);
  const width = columns.length * (CELL + GAP) + 30;
  const height = 7 * (CELL + GAP) + 22;

  return (
    <svg width={width} height={height} role="img" aria-label={`Nexus Score de cada dia de ${year}`}>
      {monthTicks.map((t) => (
        <text
          key={t.label + t.x}
          x={t.x + 30}
          y={10}
          className="fill-[var(--text-tertiary)]"
          style={{ fontSize: 10 }}
        >
          {t.label}
        </text>
      ))}
      {["", "Seg", "", "Qua", "", "Sex", ""].map((lbl, i) =>
        lbl ? (
          <text
            key={i}
            x={0}
            y={22 + i * (CELL + GAP) + CELL - 2}
            className="fill-[var(--text-tertiary)]"
            style={{ fontSize: 9 }}
          >
            {lbl}
          </text>
        ) : null,
      )}
      <g transform={`translate(30, 18)`}>
        {columns.map((col, ci) =>
          col.map((cell) =>
            cell ? (
              <rect
                key={cell.day}
                x={ci * (CELL + GAP)}
                y={cell.weekday * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={3}
                fill={colourFor(cell.value)}
              >
                <title>
                  {niceDay(cell.day)} · {cell.value != null ? `score ${cell.value}` : "sem nota"}
                </title>
              </rect>
            ) : null,
          ),
        )}
      </g>
    </svg>
  );
}

interface Placed {
  day: string;
  value: number | null;
  weekday: number;
}

/** Agrupa as células em colunas semanais (domingo no topo), com os rótulos de mês. */
function buildColumns(cells: ScoreCell[], year: number) {
  const byDay = new Map(cells.map((c) => [c.day, c]));
  const start = new Date(year, 0, 1);
  const end = cells.length ? new Date(`${cells[cells.length - 1].day}T00:00:00`) : start;

  const columns: (Placed | null)[][] = [];
  let col: (Placed | null)[] = new Array(start.getDay()).fill(null);
  const monthTicks: { label: string; x: number }[] = [];
  let lastMonth = -1;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    const weekday = d.getDay();
    const cell = byDay.get(iso);
    col.push({ day: iso, value: cell?.value ?? null, weekday });

    if (d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      monthTicks.push({ label: MONTHS[d.getMonth()], x: columns.length * (CELL + GAP) });
    }
    if (weekday === 6) {
      columns.push(col);
      col = [];
    }
  }
  if (col.length) columns.push(col);
  return { columns, monthTicks };
}

function Legend() {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
      <span>0</span>
      {[18, 34, 56, 78, 100].map((p) => (
        <span
          key={p}
          className="size-3 rounded-[3px]"
          style={{ background: `color-mix(in srgb, var(--accent) ${p}%, var(--bg-base))` }}
        />
      ))}
      <span>100</span>
    </div>
  );
}

function niceDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
