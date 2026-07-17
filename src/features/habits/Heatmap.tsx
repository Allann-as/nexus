/**
 * Heatmap anual, estilo GitHub.
 *
 * SVG puro em vez de ECharts: são ~365 retângulos estáticos. Carregar uma
 * biblioteca de gráficos para isso custaria mais bytes e mais tempo de parse do
 * que o desenho inteiro.
 */

import { useMemo } from "react";

import type { HeatmapCell } from "../../lib/ipc";

const CELL = 11;
const GAP = 3;
const WEEKDAY_LABELS = ["", "Seg", "", "Qua", "", "Sex", ""];

export function Heatmap({
  cells,
  unit,
}: {
  cells: HeatmapCell[];
  unit?: string | null;
}) {
  // Agrupa em colunas semanais começando no domingo — a leitura que todo mundo
  // já conhece do GitHub.
  const { columns, months } = useMemo(() => {
    const columns: HeatmapCell[][] = [];
    let current: HeatmapCell[] = [];

    for (const cell of cells) {
      const weekday = new Date(`${cell.day}T00:00:00`).getDay();
      if (weekday === 0 && current.length > 0) {
        columns.push(current);
        current = [];
      }
      // A primeira semana pode ser parcial: preenche o começo com buracos.
      if (columns.length === 0 && current.length === 0 && weekday > 0) {
        current = Array(weekday).fill(null as unknown as HeatmapCell);
      }
      current.push(cell);
    }
    if (current.length > 0) columns.push(current);

    // Rótulo do mês na primeira coluna em que ele aparece.
    const months: { x: number; label: string }[] = [];
    let lastMonth = -1;
    columns.forEach((col, i) => {
      const first = col.find(Boolean);
      if (!first) return;
      const m = new Date(`${first.day}T00:00:00`).getMonth();
      if (m !== lastMonth) {
        months.push({
          x: i * (CELL + GAP),
          label: new Date(`${first.day}T00:00:00`).toLocaleDateString("pt-BR", {
            month: "short",
          }),
        });
        lastMonth = m;
      }
    });

    return { columns, months };
  }, [cells]);

  const width = columns.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    // Rola dentro do próprio contêiner: a página nunca rola na horizontal.
    <div className="overflow-x-auto">
      <svg width={width + 32} height={height + 20} className="block">
        {months.map((m, i) => (
          <text
            key={i}
            x={m.x + 32}
            y={9}
            className="fill-[var(--text-tertiary)]"
            style={{ fontSize: 9 }}
          >
            {m.label}
          </text>
        ))}

        {WEEKDAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={i}
              x={0}
              y={20 + i * (CELL + GAP) + CELL - 2}
              className="fill-[var(--text-tertiary)]"
              style={{ fontSize: 9 }}
            >
              {label}
            </text>
          ) : null,
        )}

        {columns.map((col, ci) =>
          col.map((cell, ri) => {
            if (!cell) return null;
            return (
              <rect
                key={cell.day}
                x={ci * (CELL + GAP) + 32}
                y={20 + ri * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                fill={colourFor(cell)}
                stroke={cell.scheduled ? "var(--border-subtle)" : "none"}
                strokeWidth={0.5}
              >
                <title>{tooltip(cell, unit)}</title>
              </rect>
            );
          }),
        )}
      </svg>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
        <span>menos</span>
        <span className="size-[9px] rounded-[2px] bg-[var(--bg-raised)]" />
        <span className="size-[9px] rounded-[2px]" style={{ background: shade(0.35) }} />
        <span className="size-[9px] rounded-[2px]" style={{ background: shade(0.7) }} />
        <span className="size-[9px] rounded-[2px]" style={{ background: shade(1) }} />
        <span>mais</span>
      </div>
    </div>
  );
}

function shade(alpha: number): string {
  return `color-mix(in srgb, var(--success) ${alpha * 100}%, var(--bg-raised))`;
}

function colourFor(cell: HeatmapCell): string {
  if (cell.status === "done") return shade(1);
  if (cell.status === "failed") return "color-mix(in srgb, var(--danger) 55%, var(--bg-raised))";
  if (cell.status === "skipped") return "var(--bg-hover)";
  // Um dia sem tick E sem agendamento é mais apagado que uma falta de verdade:
  // não fazer o que não era para fazer não é uma falha.
  return cell.scheduled ? "var(--bg-raised)" : "transparent";
}

function tooltip(cell: HeatmapCell, unit?: string | null): string {
  const date = new Date(`${cell.day}T00:00:00`).toLocaleDateString("pt-BR");
  if (cell.status === "done") {
    const v = cell.value != null ? ` — ${cell.value}${unit ? ` ${unit}` : ""}` : "";
    return `${date}: feito${v}`;
  }
  if (cell.status === "failed") return `${date}: falhou`;
  if (cell.status === "skipped") return `${date}: pulado`;
  return cell.scheduled ? `${date}: sem registro` : `${date}: não agendado`;
}
