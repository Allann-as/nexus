/**
 * A celebração dourada quando uma caixinha fecha (§2.1).
 *
 * CSS puro, transform/opacity apenas, uma passada e some (a §6 proíbe animação
 * em idle — esta se auto-desmonta). Um clique em qualquer lugar a dispensa.
 *
 * A conquista já foi para o ledger no backend; isto é só o "uau" do momento.
 */

import { useEffect } from "react";
import { Trophy } from "lucide-react";

export function Celebration({ title, onDone }: { title: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      onClick={onDone}
      className="fixed inset-0 z-[60] grid place-items-center bg-[color-mix(in_srgb,black_45%,transparent)]"
    >
      <div className="relative grid place-items-center">
        {/* O halo que explode e some. */}
        <div
          aria-hidden
          className="absolute size-48 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--sphere) 55%, transparent), transparent 65%)",
            animation: "nexus-burst 1200ms var(--ease) forwards",
          }}
        />
        <div
          className="relative flex flex-col items-center gap-3"
          style={{ animation: "nexus-celebrate 700ms var(--ease) forwards" }}
        >
          <Trophy size={72} strokeWidth={1.5} className="text-[var(--sphere)]" aria-hidden />

          <div className="text-center">
            <p className="text-[18px] font-bold tracking-[-0.02em] text-[var(--text-primary)]">
              Objetivo alcançado!
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--sphere)]">{title}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
