/**
 * O "ⓘ como calculamos" do Nexus Score.
 *
 * Não é enfeite e não é opcional: a constituição (§2, zero IA) diz que TODO
 * insight responde "como você calculou isso?". É a diferença entre um número em
 * que se confia e um número que se ignora — e, num app sem IA, a explicabilidade
 * é o produto, não um extra.
 *
 * Herdado do `NexusScoreCard` do M2, que morreu junto com o Dashboard v1. O que
 * mudou é a embalagem (agora um popover de vidro sobre o gauge do Hub); a
 * matemática exibida é a mesma, e ela continua vindo pronta do backend em
 * `score.components` / `score.formula` — o frontend não recalcula nada, senão
 * seriam duas fontes de verdade para o mesmo número.
 */

import { useEffect, useRef } from "react";

import type { Score } from "../../lib/ipc";
import { GlassPanel } from "../../design-system/cards";

export function ScoreDetail({ score, onClose }: { score: Score; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Fecha no Esc e no clique fora — o que qualquer popover faz, e a falta do que
  // faz um popover parecer um bug.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // `capture`, senão o clique no próprio botão que abriu o popover fecharia
    // e reabriria no mesmo gesto.
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="absolute top-full right-0 z-30 mt-2 w-[330px]">
      <GlassPanel className="p-4">
        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
          Como calculamos
        </h3>

        {score.components.length === 0 ? (
          // Nem zero nem 100: não havia nada a fazer. Zero diria "você falhou".
          <p className="mt-2 text-[12px] leading-[18px] text-[var(--text-secondary)]">
            {score.formula}
          </p>
        ) : (
          <>
            <div className="mt-3 space-y-2.5">
              {score.components.map((c) => (
                <div key={c.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-[var(--text-primary)]">{c.label}</span>
                    <span className="tabular text-[10px] text-[var(--text-tertiary)]">
                      {c.detail} · {Math.round(c.weight)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-base)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-[var(--dur-base)] ease-[var(--ease)]"
                      style={{
                        width: `${c.ratio * 100}%`,
                        background: c.ratio >= 1 ? "var(--success)" : "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-3 border-t border-[var(--border-subtle)] pt-3 text-[11px] leading-[17px] text-[var(--text-secondary)]">
              Os pesos são <strong className="text-[var(--text-primary)]">redistribuídos</strong>{" "}
              entre o que se aplica a você. Sem rotina matinal cadastrada, os 20% dela
              se diluem nas outras parcelas — você não perde pontos por não usar uma
              feature, nem ganha de graça.
            </p>
          </>
        )}

        <p
          data-selectable
          className="mt-3 border-t border-[var(--border-subtle)] pt-3 font-mono text-[10px] leading-[15px] break-words text-[var(--text-tertiary)]"
        >
          {score.formula}
        </p>
      </GlassPanel>
    </div>
  );
}
