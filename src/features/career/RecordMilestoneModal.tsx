/**
 * Registrar um marco de carreira (§2.3): título, tipo, data e uma observação.
 *
 * O marco é um FATO da vida — vai direto para o ledger e aparece na Timeline
 * com destaque. Não é um node: não tem tela própria, só história.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { toDay } from "../calendar/grid";
import { recordCareerMilestone, type CareerMilestoneKind } from "../../lib/ipc";
import { CAREER_KINDS, CAREER_KIND_META } from "./careerKinds";

export function RecordMilestoneModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [kind, setKind] = useState<CareerMilestoneKind>("promotion");
  const [title, setTitle] = useState("");
  const [happenedOn, setHappenedOn] = useState(toDay(new Date()));
  const [note, setNote] = useState("");
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

  const valid = title.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await recordCareerMilestone({
        title: title.trim(),
        kind,
        happenedOn: happenedOn || null,
        note: note.trim() || null,
      });
      push("success", "Marco registrado 🎉");
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
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Novo marco de carreira
            </h2>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            <Field label="Tipo">
              <div className="flex flex-wrap gap-1">
                {CAREER_KINDS.map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={cx(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-[var(--dur-fast)]",
                      kind === k
                        ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
                    )}
                  >
                    <span>{CAREER_KIND_META[k].emoji}</span>
                    {CAREER_KIND_META[k].label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="O que aconteceu">
              <input
                ref={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="Promovido a Engenheiro Sênior"
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <Field label="Quando">
              <input
                type="date"
                value={happenedOn}
                onChange={(e) => setHappenedOn(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] [color-scheme:dark]"
              />
            </Field>

            <Field label="Observação (opcional)">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Depois de 2 anos no time de plataforma…"
                className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                Registrar marco
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
