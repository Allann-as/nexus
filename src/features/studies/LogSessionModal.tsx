/**
 * Registrar uma sessão de estudo — o gesto atômico da Esfera Estudos.
 *
 * Como o AporteModal das Finanças, a velocidade é o requisito: os minutos já vêm
 * focados, o dia é hoje por padrão, e o Enter salva. Matéria, livro e tópico são
 * opcionais — uma sessão pode ser só "40 min de leitura solta". Registrar é um
 * FATO no ledger que vale XP (ADR-0047).
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { Modal } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { toDay } from "../calendar/grid";
import { listBooks, listSubjects, logStudySession } from "../../lib/ipc";

export function LogSessionModal({
  areaId,
  presetSubjectId,
  onClose,
  onSaved,
}: {
  areaId: string;
  /** Pré-seleção quando aberto de um card de matéria. */
  presetSubjectId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [minutes, setMinutes] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(presetSubjectId ?? null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [day, setDay] = useState(toDay(new Date()));
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const subjects = useQuery({
    queryKey: ["subjects", areaId],
    queryFn: () => listSubjects(areaId),
  });
  const books = useQuery({
    queryKey: ["books", areaId],
    queryFn: () => listBooks(areaId),
  });

  useEffect(() => {
    input.current?.focus();
  }, []);

  const mins = Number(minutes);
  const valid = Number.isFinite(mins) && mins > 0 && day.length === 10;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await logStudySession({
        subjectId,
        bookId,
        topic: topic.trim() || null,
        minutes: Math.round(mins),
        day,
      });
      push("success", `Sessão de ${Math.round(mins)} min registrada`);
      onSaved();
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  const subjectList = subjects.data ?? [];
  // Só livros ainda em curso ou na fila fazem sentido numa sessão de estudo.
  const bookList = (books.data ?? []).filter(
    (b) => b.status === "lendo" || b.status === "fila",
  );

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Registrar sessão
            </h2>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            {/* Os minutos são o herói: campo grande, foco imediato. */}
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 focus-within:border-[var(--sphere)]">
              <input
                ref={input}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                inputMode="numeric"
                placeholder="0"
                className="tabular h-14 w-full bg-transparent text-[28px] font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
              <span className="text-[15px] text-[var(--text-tertiary)]">min</span>
            </div>

            {subjectList.length > 0 && (
              <Field label="Matéria">
                <div className="flex flex-wrap gap-1">
                  <Pill active={subjectId === null} onClick={() => setSubjectId(null)}>
                    Nenhuma
                  </Pill>
                  {subjectList.map((s) => (
                    <Pill
                      key={s.id}
                      active={subjectId === s.id}
                      onClick={() => setSubjectId(s.id)}
                    >
                      {s.title}
                    </Pill>
                  ))}
                </div>
              </Field>
            )}

            {bookList.length > 0 && (
              <Field label="Livro (opcional)">
                <div className="flex flex-wrap gap-1">
                  <Pill active={bookId === null} onClick={() => setBookId(null)}>
                    Nenhum
                  </Pill>
                  {bookList.map((b) => (
                    <Pill key={b.id} active={bookId === b.id} onClick={() => setBookId(b.id)}>
                      {b.title}
                    </Pill>
                  ))}
                </div>
              </Field>
            )}

            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                  Tópico
                </span>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  placeholder="ex.: integrais…"
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                  Dia
                </span>
                <input
                  type="date"
                  value={day}
                  max={toDay(new Date())}
                  onChange={(e) => setDay(e.target.value)}
                  className="tabular h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">Enter salva</span>
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                Registrar
              </Button>
            </div>
          </div>
      </div>
    </Modal>
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
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
      )}
    >
      {children}
    </button>
  );
}
