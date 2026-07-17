/**
 * Depositar numa caixinha em 1 clique (§2.1): o card abre isto já focado no
 * valor, e o Enter salva. Mesmo princípio de velocidade do aporte.
 *
 * Saque = valor negativo, pelo toggle — a mesma operação com o sinal trocado.
 */

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { ProgressBar } from "../../design-system/charts";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { formatMoney } from "../../lib/format";
import { depositFinGoal, type FinGoalCard } from "../../lib/ipc";

/** "1.234,56" (ou "500") → centavos. Aceita a vírgula decimal do português. */
function parseToCents(raw: string): number | null {
  const cleaned = raw.replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function DepositModal({
  goal,
  onClose,
  onSaved,
}: {
  goal: FinGoalCard;
  onClose: () => void;
  /** `completed` é `true` quando este depósito fechou a caixinha. */
  onSaved: (completed: boolean) => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [isWithdraw, setIsWithdraw] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cents = parseToCents(amount);
  const valid = cents !== null;
  // A pré-visualização do que a barra vira depois do depósito.
  const preview =
    cents !== null
      ? (goal.savedCents + (isWithdraw ? -cents : cents)) / goal.targetCents
      : goal.savedCents / goal.targetCents;

  const submit = async () => {
    if (!valid || saving || cents === null) return;
    setSaving(true);
    try {
      const outcome = await depositFinGoal({
        goalId: goal.id,
        amountCents: isWithdraw ? -cents : cents,
      });
      push("success", isWithdraw ? "Saque registrado" : "Depósito registrado");
      onSaved(outcome.completed);
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,black_55%,transparent)] p-4"
    >
      <GlassPanel className="w-full max-w-md">
        <div onClick={(e) => e.stopPropagation()} className="p-5">
          <header className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[20px]">{goal.emoji}</span>
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {goal.title}
                </h2>
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  {formatMoney(goal.savedCents)} de {formatMoney(goal.targetCents)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-0.5 self-start rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
              <ModeButton active={!isWithdraw} onClick={() => setIsWithdraw(false)} icon={Plus}>
                Depositar
              </ModeButton>
              <ModeButton active={isWithdraw} onClick={() => setIsWithdraw(true)} icon={Minus}>
                Sacar
              </ModeButton>
            </div>

            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 focus-within:border-[var(--sphere)]">
              <span className="text-[20px] text-[var(--text-tertiary)]">R$</span>
              <input
                ref={input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                inputMode="decimal"
                placeholder="0,00"
                className="tabular h-14 w-full bg-transparent text-[28px] font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
            </div>

            <ProgressBar value={preview} height={8} />

            <div className="flex items-center justify-end gap-2 pt-1">
              <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">Enter salva</span>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                {isWithdraw ? "Sacar" : "Depositar"}
              </Button>
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Plus;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "bg-[color-mix(in_srgb,var(--sphere)_22%,transparent)] text-[var(--text-primary)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
      )}
    >
      <Icon size={12} />
      {children}
    </button>
  );
}
