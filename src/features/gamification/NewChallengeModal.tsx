/**
 * Criar uma temporada: nome, fonte do placar (um hábito ou contador manual),
 * ciclo (30/90 dias) e alvo. Nasce em segundos; o ciclo tem padrão.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

import { createChallenge, listHabits, type ChallengeMetric } from "../../lib/ipc";
import { Modal } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function NewChallengeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const inputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState<ChallengeMetric>("manual");
  const [habitId, setHabitId] = useState<string>("");
  const [days, setDays] = useState(90);
  const [target, setTarget] = useState(90);

  const habits = useQuery({ queryKey: ["habits"], queryFn: () => listHabits() });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const create = useMutation({
    mutationFn: () => {
      const startsOn = localToday();
      return createChallenge({
        title: title.trim(),
        startsOn,
        endsOn: addDays(startsOn, days),
        metric,
        habitId: metric === "habit_days" ? habitId || null : null,
        targetCount: target,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["challenges"] });
      push("success", "Temporada criada");
      onClose();
    },
    onError: pushError,
  });

  const canSave =
    title.trim().length > 0 &&
    target > 0 &&
    (metric === "manual" || habitId.length > 0) &&
    !create.isPending;

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Nova temporada</h2>
          <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <X size={18} aria-hidden />
          </button>
        </div>

        <label className="mt-4 block text-[12px] text-[var(--text-secondary)]">
          Nome
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="90 dias de treino"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
          />
        </label>

        <div className="mt-4">
          <span className="text-[12px] text-[var(--text-secondary)]">Placar</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Pill active={metric === "manual"} onClick={() => setMetric("manual")}>
              Contador manual
            </Pill>
            <Pill active={metric === "habit_days"} onClick={() => setMetric("habit_days")}>
              Ligada a um hábito
            </Pill>
          </div>
        </div>

        {metric === "habit_days" && (
          <label className="mt-3 block text-[12px] text-[var(--text-secondary)]">
            Hábito
            <select
              value={habitId}
              onChange={(e) => setHabitId(e.target.value)}
              className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
            >
              <option value="">Selecione…</option>
              {(habits.data ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-4 flex gap-4">
          <div className="flex-1">
            <span className="text-[12px] text-[var(--text-secondary)]">Ciclo</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Pill
                active={days === 30}
                onClick={() => {
                  setDays(30);
                  setTarget(30);
                }}
              >
                30 dias
              </Pill>
              <Pill
                active={days === 90}
                onClick={() => {
                  setDays(90);
                  setTarget(90);
                }}
              >
                90 dias
              </Pill>
            </div>
          </div>
          <label className="w-28 text-[12px] text-[var(--text-secondary)]">
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

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!canSave}>
            Criar temporada
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
