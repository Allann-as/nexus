/**
 * O "ⓘ como calculamos" reutilizável.
 *
 * A constituição (§2, zero IA) manda: todo número responde "como você calculou
 * isso?". Este é o disclosure padrão — um `<details>` acessível, teclado-primeiro,
 * que revela a fórmula pronta que vem do backend. O frontend nunca recalcula; ele
 * só mostra o que o Rust já explicou.
 */

import { Info } from "lucide-react";

export function Formula({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]">
        <Info size={12} aria-hidden />
        <span>como calculamos</span>
      </summary>
      <p
        data-selectable
        className="mt-2 border-l-2 border-[var(--border-subtle)] pl-3 font-mono text-[10px] leading-[15px] break-words text-[var(--text-tertiary)]"
      >
        {children}
      </p>
    </details>
  );
}
