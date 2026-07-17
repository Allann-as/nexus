/**
 * O Nexus Score — a assinatura do produto.
 *
 * Regra da constituição: todo insight responde "como você calculou isso?". O
 * "ⓘ como calculamos" não é enfeite — é a diferença entre um número em que se
 * confia e um número que se ignora.
 */

import { useState } from "react";
import { Info } from "lucide-react";

import { cx } from "../../design-system/primitives";
import type { Score } from "../../lib/ipc";

export function NexusScoreCard({ score }: { score: Score }) {
  const [showMath, setShowMath] = useState(false);

  const value = score.value;
  const ring = value ?? 0;
  const size = 96;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
          Nexus Score
        </h2>
        <button
          onClick={() => setShowMath((s) => !s)}
          className={cx(
            "flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] transition-colors",
            showMath
              ? "bg-[var(--accent-muted)] text-[var(--accent)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
          )}
        >
          <Info size={10} />
          como calculamos
        </button>
      </div>

      <div className="mt-4 flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--bg-base)"
              strokeWidth="6"
            />
            {value != null && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colourFor(ring)}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - ring / 100)}
                className="transition-[stroke-dashoffset] duration-[var(--dur-base)] ease-[var(--ease)]"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {value == null ? (
              <span className="text-[11px] text-[var(--text-tertiary)]">—</span>
            ) : (
              <span className="tabular text-[26px] leading-none font-medium">{value}</span>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {score.components.length === 0 ? (
            // Nem zero nem 100: não havia nada a fazer. Zero diria "você falhou".
            <p className="text-[12px] leading-[18px] text-[var(--text-tertiary)]">
              {score.formula}
            </p>
          ) : (
            score.components.map((comp) => (
              <div key={comp.label} className="flex items-center gap-2">
                <span className="w-[92px] shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
                  {comp.label}
                </span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-base)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-[var(--dur-base)]"
                    style={{
                      width: `${comp.ratio * 100}%`,
                      background: comp.ratio >= 1 ? "var(--success)" : "var(--accent)",
                    }}
                  />
                </div>
                <span className="tabular w-[34px] shrink-0 text-right text-[10px] text-[var(--text-tertiary)]">
                  {comp.weight}%
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {showMath && (
        <div className="mt-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <p className="text-[11px] leading-[17px] text-[var(--text-secondary)]">
            Os pesos são <strong>redistribuídos</strong> entre o que se aplica a
            você. Sem rotina matinal cadastrada, os 20% dela se diluem nas outras
            parcelas — você não perde pontos por não usar uma feature, nem ganha
            de graça.
          </p>
          {score.components.map((comp) => (
            <div key={comp.label} className="flex justify-between gap-3 text-[11px]">
              <span className="text-[var(--text-tertiary)]">{comp.label}</span>
              <span className="text-[var(--text-secondary)]">{comp.detail}</span>
            </div>
          ))}
          <p
            data-selectable
            className="border-t border-[var(--border-subtle)] pt-2 font-mono text-[10px] leading-[15px] break-words text-[var(--text-tertiary)]"
          >
            {score.formula}
          </p>
        </div>
      )}
    </div>
  );
}

function colourFor(v: number): string {
  if (v >= 80) return "var(--success)";
  if (v >= 50) return "var(--accent)";
  if (v >= 25) return "var(--warning)";
  return "var(--danger)";
}
