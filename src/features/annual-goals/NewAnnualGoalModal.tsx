/**
 * Criar uma meta anual: binária ("fazer X") ou quantitativa ("ler 12 livros").
 * O ano vem da aba aberta; Esfera é opcional.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

import { createAnnualGoal, type AnnualGoalKind, type Area } from "../../lib/ipc";
import { Modal } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

export function NewAnnualGoalModal({
  year,
  areas,
  onClose,
}: {
  year: number;
  areas: Area[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const inputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<AnnualGoalKind>("binary");
  const [metric, setMetric] = useState("");
  const [target, setTarget] = useState(12);
  const [areaId, setAreaId] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const create = useMutation({
    mutationFn: () =>
      createAnnualGoal({
        title: title.trim(),
        year,
        goalKind: kind,
        areaId: areaId || null,
        metricName: kind === "quantitative" ? metric.trim() : null,
        targetValue: kind === "quantitative" ? target : null,
        unit: kind === "quantitative" ? metric.trim() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["annual-goal-year", year] });
      qc.invalidateQueries({ queryKey: ["annual-goal-years"] });
      push("success", "Meta anual criada");
      onClose();
    },
    onError: pushError,
  });

  const canSave =
    title.trim().length > 0 &&
    (kind === "binary" || (metric.trim().length > 0 && target > 0)) &&
    !create.isPending;

  const activeAreas = areas.filter((a) => a.archivedAt === null);

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            Nova meta para {year}
          </h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X size={18} aria-hidden />
          </button>
        </div>

        <label className="mt-4 block text-[12px] text-[var(--text-secondary)]">
          O que você quer alcançar
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ler 12 livros"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
          />
        </label>

        <div className="mt-4">
          <span className="text-[12px] text-[var(--text-secondary)]">Tipo</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Pill active={kind === "binary"} onClick={() => setKind("binary")}>
              Fazer / não fazer
            </Pill>
            <Pill active={kind === "quantitative"} onClick={() => setKind("quantitative")}>
              Com número-alvo
            </Pill>
          </div>
        </div>

        {kind === "quantitative" && (
          <div className="mt-3 flex gap-3">
            <label className="flex-1 text-[12px] text-[var(--text-secondary)]">
              Métrica
              <input
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                placeholder="livros"
                className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
              />
            </label>
            <label className="w-24 text-[12px] text-[var(--text-secondary)]">
              Alvo
              <input
                type="number"
                min={1}
                value={target}
                onChange={(e) => setTarget(Math.max(0, Number(e.target.value)))}
                className="tabular mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
              />
            </label>
          </div>
        )}

        <label className="mt-3 block text-[12px] text-[var(--text-secondary)]">
          Esfera (opcional)
          <select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
          >
            <option value="">Sem Esfera</option>
            {activeAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!canSave}>
            Criar meta
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded-[var(--radius-md)] border px-3 py-2 text-[12px] transition-colors",
        active
          ? "border-[var(--border-glow)] bg-[var(--bg-raised)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
      )}
    >
      {children}
    </button>
  );
}
