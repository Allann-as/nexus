/**
 * A EXCLUSÃO ARMADA — o gesto destrutivo do NEXUS, num lugar só (v1.2, fase B).
 *
 * O padrão já era o do app e estava escrito em prosa em cinco arquivos: *"um
 * clique pergunta, o segundo confirma"*. O problema é que ele estava escrito
 * cinco vezes — cada tela com o seu `useState<string | null>`, o seu par de
 * botões e o seu texto. Cinco cópias divergem no dia em que só uma é corrigida,
 * e a fase B precisa espalhar esse gesto por mais de uma dezena de entidades que
 * hoje não têm como ser apagadas. Uma dúzia de cópias novas seria a hora errada
 * de continuar copiando.
 *
 * O QUE ELE GARANTE, e é por isso que ele é um componente e não uma receita:
 *
 *   * **O primeiro clique nunca apaga.** Ele arma e pergunta.
 *   * **Desarma sozinho.** Se a confirmação não vem em `DISARM_MS`, volta ao
 *     repouso — um botão que fica armado para sempre é uma armadilha esperando o
 *     clique errado. (O `SkillsTrack` já tinha descoberto isso sozinho e era o
 *     único lugar com timeout; aqui vira a regra.)
 *   * **Desarma ao perder o foco / com Esc.** As mesmas saídas de um popover.
 *   * **Não dispara duas vezes.** Enquanto `pending`, os dois botões travam.
 *
 * O que ele NÃO decide: se a exclusão apaga estado ou arquiva. Isso é da tela.
 * Aqui só mora a pergunta.
 *
 * A regra do app continua valendo por baixo (ADR-0056): apagar corrige o ESTADO;
 * o ledger guarda a história, e ninguém reescreve o passado.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, type LucideIcon } from "lucide-react";

import { Button, cx } from "./primitives";

/** Quanto tempo um botão armado espera antes de desistir. */
const DISARM_MS = 4000;

export function ArmedDelete({
  onConfirm,
  pending = false,
  question = "Excluir?",
  confirmLabel = "Sim, excluir",
  cancelLabel = "Não",
  label,
  icon: Icon = Trash2,
  size = "sm",
  ariaLabel = "Excluir",
  className,
}: {
  onConfirm: () => void;
  /** A mutação está em voo — trava os dois botões. */
  pending?: boolean;
  /** A pergunta mostrada quando armado. Seja específico: "Excluir este aporte?" */
  question?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Texto ao lado do ícone em repouso. Sem ele, o botão é só o ícone. */
  label?: string;
  icon?: LucideIcon;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const disarm = useCallback(() => setArmed(false), []);

  /* Desarme automático. O timer é refeito a cada rearme, e some se o componente
     sair da tela no meio — um setState depois do unmount é vazamento. */
  useEffect(() => {
    if (!armed || pending) return;
    const t = window.setTimeout(disarm, DISARM_MS);
    return () => window.clearTimeout(t);
  }, [armed, pending, disarm]);

  /* Esc e clique fora desarmam, como num popover: armado é um estado modal em
     miniatura, e todo estado modal precisa de uma saída que não seja o "sim". */
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        disarm();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) disarm();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [armed, disarm]);

  if (armed) {
    return (
      <div ref={root} className={cx("flex shrink-0 items-center gap-1.5", className)}>
        <span className="text-[11.5px] text-[var(--text-secondary)]">{question}</span>
        <Button
          variant="danger"
          size={size}
          onClick={() => onConfirm()}
          disabled={pending}
          autoFocus
        >
          {pending ? "…" : confirmLabel}
        </Button>
        <Button variant="ghost" size={size} onClick={disarm} disabled={pending}>
          {cancelLabel}
        </Button>
      </div>
    );
  }

  return (
    <div ref={root} className={cx("shrink-0", className)}>
      <Button
        variant="ghost"
        size={size}
        icon={Icon}
        onClick={() => setArmed(true)}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="text-[var(--text-tertiary)] hover:text-[var(--danger)]"
      >
        {label}
      </Button>
    </div>
  );
}
