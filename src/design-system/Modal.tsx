/**
 * O overlay compartilhado de TODA modal de formulário do app.
 *
 * POR QUE ELE EXISTE (ADR-0066): as modais eram, cada uma, um `fixed inset-0`
 * embrulhando um `GlassPanel` — e renderizavam INLINE, dentro do `.nx-page` da
 * tela. O `.nx-page` cria um contexto de empilhamento isolado (`isolation:
 * isolate`, styles.css §fundo). O `backdrop-filter` do `.nx-glass`, preso a esse
 * "backdrop root" isolado, não tem o conteúdo da página para amostrar: o blur de
 * um backdrop vazio é PRETO. Era o quadrado preto atrás de "Nova meta", "Nova
 * caixinha" e das telas de Estudos — em ambos os temas, e imune a spot-fix porque
 * a causa estava na ÁRVORE, não no CSS de cada modal.
 *
 * A correção é estrutural: a modal sai da árvore da página por um `createPortal`
 * para o `document.body`. Fora do `.nx-page`, o `backdrop-filter` amostra a
 * aplicação real por trás e o blur volta a ser blur. Um componente, e o app
 * inteiro para de ter o bug — a modal que usa este overlay não pode reintroduzi-lo.
 *
 * `--sphere` não atravessa o portal (o body está fora do `.nx-page` que a define),
 * então quem abre a modal de dentro de uma Esfera passa `sphereColor` para a modal
 * seguir tingida; sem ele, cai no índigo da marca, que é o neutro honesto.
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

import { Button, cx } from "./primitives";

const SIZE = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

export function Modal({
  onClose,
  children,
  size = "md",
  className,
  sphereColor,
  labelledBy,
}: {
  onClose: () => void;
  children: ReactNode;
  size?: keyof typeof SIZE;
  className?: string;
  /** A cor da Esfera de origem, para a modal seguir tingida fora do `.nx-page`. */
  sphereColor?: string;
  labelledBy?: string;
}) {
  // Esc fecha, em qualquer modal, sem cada uma reimplementar o listener. O
  // `stopPropagation` impede que o mesmo Esc chegue a um handler de tela por trás.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      // `onMouseDown` e não `onClick`: fechar no clique do backdrop dispararia
      // também quando um arraste de seleção começa dentro e termina fora. O
      // mousedown no backdrop é um gesto inequívoco de "fora".
      onMouseDown={onClose}
      className="nx-modal-scrim fixed inset-0 z-[80] grid place-items-center overflow-y-auto p-4"
      style={sphereColor ? ({ "--sphere": sphereColor } as React.CSSProperties) : undefined}
      role="presentation"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      // Limita a altura da modal à viewport e permite scroll interno para evitar
      // que conteúdos altos (ex.: o painel de Impacto do Aporte) explodam o layout.
      className={cx(
        "nx-glass nx-modal-panel w-full rounded-[var(--radius-xl)] max-h-[90vh] overflow-auto",
        SIZE[size],
        className,
      )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * O cabeçalho padrão de uma modal (B2): um chip do ícone da ação tingido pelo
 * contexto, o título com hierarquia e o X à direita. Opt-in — a modal que quer a
 * casca profissional troca o próprio `<header>` cru por este.
 */
export function ModalHeader({
  icon: Icon,
  title,
  subtitle,
  onClose,
  tone = "var(--accent)",
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** A cor do chip do ícone — `var(--sphere)` quando aberta de dentro de uma Esfera. */
  tone?: string;
}) {
  return (
    <header className="mb-4 flex items-start gap-3">
      {Icon && (
        <span
          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)]"
          style={{
            background: `color-mix(in srgb, ${tone} 14%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 24%, transparent)`,
          }}
        >
          <Icon size={17} strokeWidth={2} style={{ color: tone }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{subtitle}</p>
        )}
      </div>
      <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
    </header>
  );
}
