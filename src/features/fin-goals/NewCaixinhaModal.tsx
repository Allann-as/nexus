/**
 * Criar uma caixinha: ícone, nome, alvo, banco e (opcional) prazo.
 *
 * O nome e o valor são o essencial; o resto tem padrão. Uma caixinha nasce em
 * segundos, como um aporte.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { createFinGoal, type Account } from "../../lib/ipc";
import { GOAL_ICONS } from "./GoalIcon";


function parseToCents(raw: string): number | null {
  const cleaned = raw.replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function NewCaixinhaModal({
  areaId,
  accounts,
  onClose,
  onSaved,
}: {
  areaId: string;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [emoji, setEmoji] = useState("target");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [deadline, setDeadline] = useState("");
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

  const cents = parseToCents(target);
  const valid = cents !== null && title.trim().length > 0;

  const submit = async () => {
    if (!valid || saving || cents === null) return;
    setSaving(true);
    try {
      await createFinGoal({
        title: title.trim(),
        areaId,
        targetCents: cents,
        accountId,
        deadline: deadline || null,
        emoji,
      });
      push("success", "Caixinha criada");
      onSaved();
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
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Nova caixinha</h2>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            <Field label="Ícone">
              <div className="flex flex-wrap gap-1">
                {GOAL_ICONS.map(({ name, Icon }) => (
                  <button
                    key={name}
                    onClick={() => setEmoji(name)}
                    aria-label={name}
                    className={cx(
                      "grid size-9 place-items-center rounded-[var(--radius-md)] transition-colors",
                      emoji === name
                        ? "bg-[color-mix(in_srgb,var(--sphere)_22%,transparent)] text-[var(--sphere)] ring-1 ring-[var(--sphere)]"
                        : "bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]",
                    )}
                  >
                    <Icon size={18} aria-hidden />
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Nome">
              <input
                ref={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="PS5, Viagem ao Japão…"
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <Field label="Alvo">
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 focus-within:border-[var(--sphere)]">
                <span className="text-[16px] text-[var(--text-tertiary)]">R$</span>
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  inputMode="decimal"
                  placeholder="4.500,00"
                  className="tabular h-11 w-full bg-transparent text-[18px] font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                />
              </div>
            </Field>

            {accounts.length > 0 && (
              <Field label="Banco (onde o dinheiro fica)">
                <div className="flex flex-wrap gap-1">
                  {accounts.map((a) => (
                    <Pill
                      key={a.id}
                      active={accountId === a.id}
                      colour={a.color}
                      onClick={() => setAccountId(accountId === a.id ? null : a.id)}
                    >
                      {a.name}
                    </Pill>
                  ))}
                </div>
              </Field>
            )}

            <Field label="Prazo (opcional)">
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] [color-scheme:dark]"
              />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                Criar caixinha
              </Button>
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pill({
  active,
  colour,
  onClick,
  children,
}: {
  active: boolean;
  colour?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={colour ? ({ "--pill": colour } as React.CSSProperties) : undefined}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? colour
            ? "border-[var(--pill)] bg-[color-mix(in_srgb,var(--pill)_22%,transparent)] text-[var(--text-primary)]"
            : "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
      )}
    >
      {children}
    </button>
  );
}
