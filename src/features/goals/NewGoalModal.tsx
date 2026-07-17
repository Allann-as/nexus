/**
 * Nova meta.
 *
 * Uma meta precisa de mais do que um título — métrica, ponto de partida, alvo,
 * unidade e direção —, e nenhum desses tem padrão honesto: "perder peso" começa
 * em 82 e mira 72; "ler livros" começa em 0 e mira 12. Inventar o começo faria a
 * primeira barra mentir, e a projeção depois dela.
 *
 * A direção é derivada, não perguntada: quem parte de 82 rumo a 72 está
 * diminuindo. Um campo a menos, e um a menos para errar.
 */

import { useState } from "react";
import { X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { createGoal, type Area } from "../../lib/ipc";
import { SphereIcon } from "../hub/SphereIcon";

export function NewGoalModal({
  areas,
  defaultAreaId,
  onClose,
  onCreated,
}: {
  areas: Area[];
  defaultAreaId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const [title, setTitle] = useState("");
  const [metricName, setMetricName] = useState("");
  const [unit, setUnit] = useState("");
  const [startValue, setStartValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [areaId, setAreaId] = useState<string | null>(defaultAreaId);
  const [saving, setSaving] = useState(false);

  const start = Number(startValue.replace(",", "."));
  const target = Number(targetValue.replace(",", "."));
  const valid =
    title.trim() !== "" &&
    metricName.trim() !== "" &&
    unit.trim() !== "" &&
    Number.isFinite(start) &&
    Number.isFinite(target) &&
    start !== target;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createGoal({
        title: title.trim(),
        areaId,
        metricName: metricName.trim(),
        startValue: start,
        targetValue: target,
        unit: unit.trim(),
        // Derivada do próprio par de números: 82 → 72 é 'decrease'.
        direction: target < start ? "decrease" : "increase",
      });
      onCreated();
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
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Nova meta</h2>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-3">
            <Input autoFocus value={title} onChange={setTitle} placeholder="Perder 10 kg" label="Meta" />
            <Input value={metricName} onChange={setMetricName} placeholder="Peso" label="Métrica" />

            <div className="grid grid-cols-3 gap-2">
              <Input value={startValue} onChange={setStartValue} placeholder="82" label="Hoje" />
              <Input value={targetValue} onChange={setTargetValue} placeholder="72" label="Alvo" />
              <Input value={unit} onChange={setUnit} placeholder="kg" label="Unidade" />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                Esfera
              </span>
              <div className="flex flex-wrap gap-1">
                <Chip active={areaId === null} onClick={() => setAreaId(null)}>
                  Nenhuma
                </Chip>
                {areas.map((a) => (
                  <Chip
                    key={a.id}
                    active={areaId === a.id}
                    colour={a.color}
                    onClick={() => setAreaId(a.id)}
                  >
                    <SphereIcon name={a.icon} size={12} />
                    {a.name}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                Criar meta
              </Button>
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
      />
    </label>
  );
}

function Chip({
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
      style={colour ? ({ "--sphere": colour } as React.CSSProperties) : undefined}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        "transition-colors duration-[var(--dur-fast)]",
        active
          ? colour
            ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_20%,transparent)] text-[var(--text-primary)]"
            : "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
      )}
    >
      {children}
    </button>
  );
}
