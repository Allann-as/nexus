/**
 * Registrar um aporte em 5 segundos (§3.2): valor → conta → classe → Enter.
 *
 * O requisito é a velocidade. O gesto mais repetido da Esfera Finanças é "botei
 * X no banco Y em Z", e um formulário de seis campos com data e observação
 * obrigatórias transformaria um lançamento diário numa cerimônia. Aqui o campo de
 * valor já vem focado, a data é hoje por padrão, e o Enter salva.
 *
 * Resgate = valor negativo. Um toggle "aporte/resgate" troca o sinal sem um
 * segundo fluxo: tirar dinheiro é a mesma operação de pôr, com o sinal trocado
 * (§ da 0010).
 */

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { Modal } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { toDay } from "../calendar/grid";
import { addContribution, type Account, type AssetClass } from "../../lib/ipc";

/** As classes na ordem em que a maioria dos aportes cai. */
const CLASSES: Array<{ value: AssetClass; label: string }> = [
  { value: "renda_fixa", label: "Renda fixa" },
  { value: "acoes", label: "Ações" },
  { value: "fiis", label: "FIIs" },
  { value: "etf_exterior", label: "ETF exterior" },
  { value: "cripto", label: "Cripto" },
  { value: "reserva", label: "Reserva" },
  { value: "outros", label: "Outros" },
];

/** "1.234,56" (ou "500") → centavos. Aceita a vírgula decimal do português. */
function parseToCents(raw: string): number | null {
  const cleaned = raw.replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function AporteModal({
  accounts,
  defaults,
  onClose,
  onSaved,
}: {
  accounts: Account[];
  /** Pré-seleção vinda do Ctrl+K ("aportar 500 no btg"). */
  defaults?: { amountCents?: number; accountId?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [isResgate, setIsResgate] = useState(false);
  const [amount, setAmount] = useState(
    defaults?.amountCents ? String(defaults.amountCents / 100) : "",
  );
  const [accountId, setAccountId] = useState<string | null>(
    defaults?.accountId ?? accounts[0]?.id ?? null,
  );
  const [assetClass, setAssetClass] = useState<AssetClass>("renda_fixa");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const cents = parseToCents(amount);
  const valid = cents !== null && accountId !== null;

  const submit = async () => {
    if (!valid || saving || cents === null || accountId === null) return;
    setSaving(true);
    try {
      await addContribution({
        accountId,
        assetClass,
        amountCents: isResgate ? -cents : cents,
        happenedOn: toDay(new Date()),
      });
      push("success", isResgate ? "Resgate registrado" : "Aporte registrado");
      onSaved();
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
          <header className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
              <ModeButton active={!isResgate} onClick={() => setIsResgate(false)} icon={Plus}>
                Aporte
              </ModeButton>
              <ModeButton active={isResgate} onClick={() => setIsResgate(true)} icon={Minus}>
                Resgate
              </ModeButton>
            </div>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            {/* O valor é o herói: campo grande, foco imediato, prefixo R$. */}
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

            <Field label="Conta">
              <div className="flex flex-wrap gap-1">
                {accounts.map((a) => (
                  <Pill
                    key={a.id}
                    active={accountId === a.id}
                    colour={a.color}
                    onClick={() => setAccountId(a.id)}
                  >
                    {a.name}
                  </Pill>
                ))}
              </div>
            </Field>

            <Field label="Classe">
              <div className="flex flex-wrap gap-1">
                {CLASSES.map((c) => (
                  <Pill key={c.value} active={assetClass === c.value} onClick={() => setAssetClass(c.value)}>
                    {c.label}
                  </Pill>
                ))}
              </div>
            </Field>

            <div className="flex items-center justify-end gap-2 pt-1">
              <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">Enter salva</span>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                {isResgate ? "Registrar resgate" : "Registrar aporte"}
              </Button>
            </div>
          </div>
      </div>
    </Modal>
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
