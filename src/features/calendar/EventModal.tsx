/**
 * O modal rápido de evento: criar (o que o arrasto abre) e ver/editar um que
 * existe.
 *
 * "Rápido" é o requisito: o gesto que traz o usuário aqui é arrastar um bloco na
 * agenda, e ele já disse QUANDO. Só falta o título. Por isso o campo já vem
 * focado e o Enter salva — o resto (Esfera, duração, recorrência) tem padrão
 * bom o bastante para ser ignorado.
 */

import { useEffect, useRef, useState } from "react";
import { Repeat, Trash2, X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { Button, Kbd, cx } from "../../design-system/primitives";
import { SphereIcon } from "../hub/SphereIcon";
import type { Area, Occurrence, Recurrence } from "../../lib/ipc";
import { durationLabel, hhmm } from "./grid";

/** As durações de um clique. Cobrem quase todo compromisso real. */
const PRESETS_MIN = [15, 30, 45, 60, 90, 120];

/**
 * As recorrências que o modal oferece.
 *
 * Um subconjunto do subconjunto: o vocabulário do domínio tem `interval`, e a UI
 * do M3 só expõe `interval = 1`. "A cada 2 semanas" existe no banco e o seed o
 * usa — a tela de edição completa da regra é do backlog. Prometer um campo de
 * intervalo aqui seria um formulário a mais para um caso que quase ninguém pede.
 */
const RRULE_OPTIONS: Array<{ label: string; value: Recurrence | null }> = [
  { label: "Não repete", value: null },
  { label: "Todo dia", value: { type: "daily", interval: 1 } },
  { label: "Toda semana", value: { type: "weekly", interval: 1, days: [] } },
  { label: "Todo mês", value: { type: "monthly", interval: 1 } },
  { label: "Todo ano", value: { type: "yearly", interval: 1 } },
];

export interface EventDraft {
  startsAt: number;
  endsAt: number;
}

export function EventModal({
  draft,
  existing,
  areas,
  onCreate,
  onDelete,
  onCancelOccurrence,
  onClose,
}: {
  /** O bloco que o arrasto desenhou. Exclusivo com `existing`. */
  draft: EventDraft | null;
  /** A ocorrência que o usuário abriu. Exclusivo com `draft`. */
  existing: Occurrence | null;
  areas: Area[];
  onCreate: (e: {
    title: string;
    areaId: string | null;
    startsAt: number;
    endsAt: number;
    rrule: Recurrence | null;
  }) => void;
  onDelete: (occurrence: Occurrence) => void;
  onCancelOccurrence: (occurrence: Occurrence) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [durationMin, setDurationMin] = useState(60);
  const [rrule, setRrule] = useState<Recurrence | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft) {
      setDurationMin(Math.round((draft.endsAt - draft.startsAt) / 60_000));
      input.current?.focus();
    }
  }, [draft]);

  // Escape fecha, e o listener é do modal: um `onKeyDown` no wrapper só ouviria
  // o que tem foco dentro dele, e o usuário pode ter clicado no fundo.
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

  if (!draft && !existing) return null;

  const submit = () => {
    if (!draft || !title.trim()) return;
    onCreate({
      title: title.trim(),
      areaId,
      startsAt: draft.startsAt,
      endsAt: draft.startsAt + durationMin * 60_000,
      rrule,
    });
  };

  return (
    <div
      // O fundo escuro é um `div` com `onClick`, e não um `<dialog>`: o
      // `showModal()` põe o elemento na top-layer, acima do backdrop-filter do
      // GlassPanel — e o vidro pararia de mostrar o que está atrás dele.
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,black_55%,transparent)] p-4"
    >
      <GlassPanel className="w-full max-w-md">
        <div onClick={(e) => e.stopPropagation()} className="p-5">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                {draft ? "Novo evento" : existing?.title}
              </h2>
              <p className="tabular mt-0.5 text-[12px] text-[var(--text-tertiary)]">
                {draft
                  ? `${hhmm(draft.startsAt)} · ${durationLabel(durationMin * 60_000)}`
                  : existing &&
                    `${hhmm(existing.startsAt)} – ${hhmm(existing.endsAt)} · ${durationLabel(
                      existing.endsAt - existing.startsAt,
                    )}`}
              </p>
            </div>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          {draft ? (
            <div className="flex flex-col gap-4">
              <input
                ref={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="O que vai acontecer?"
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
              />

              <Field label="Duração">
                <div className="flex flex-wrap gap-1">
                  {PRESETS_MIN.map((min) => (
                    <Pill
                      key={min}
                      active={durationMin === min}
                      onClick={() => setDurationMin(min)}
                    >
                      {durationLabel(min * 60_000)}
                    </Pill>
                  ))}
                </div>
              </Field>

              <Field label="Esfera">
                <div className="flex flex-wrap gap-1">
                  <Pill active={areaId === null} onClick={() => setAreaId(null)}>
                    Nenhuma
                  </Pill>
                  {areas.map((a) => (
                    <Pill
                      key={a.id}
                      active={areaId === a.id}
                      colour={a.color}
                      onClick={() => setAreaId(a.id)}
                    >
                      {/* Nome + ícone junto da cor, sempre: a cor tinge, nunca
                          codifica (ADR-0017). */}
                      <SphereIcon name={a.icon} size={12} />
                      {a.name}
                    </Pill>
                  ))}
                </div>
              </Field>

              <Field label="Repetição">
                <div className="flex flex-wrap gap-1">
                  {RRULE_OPTIONS.map((opt) => (
                    <Pill
                      key={opt.label}
                      active={rruleLabel(rrule) === opt.label}
                      onClick={() => setRrule(opt.value)}
                    >
                      {opt.value && <Repeat size={11} />}
                      {opt.label}
                    </Pill>
                  ))}
                </div>
              </Field>

              <div className="flex items-center justify-end gap-2 pt-1">
                <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">
                  <Kbd>Enter</Kbd> salva
                </span>
                <Button variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={submit} disabled={!title.trim()}>
                  Criar
                </Button>
              </div>
            </div>
          ) : (
            existing && <ExistingEvent existing={existing} onDelete={onDelete} onCancelOccurrence={onCancelOccurrence} />
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

/**
 * O que se pode fazer com um evento que já existe.
 *
 * As duas ações de apagar são deliberadamente diferentes, e a diferença é o
 * ponto: cancelar UMA ocorrência é "toda terça, menos a de 25/11"; apagar o
 * evento leva a série inteira. Um botão só, decidindo sozinho qual das duas o
 * usuário quis, apagaria um ano de terapia por causa de um feriado.
 */
function ExistingEvent({
  existing,
  onDelete,
  onCancelOccurrence,
}: {
  existing: Occurrence;
  onDelete: (o: Occurrence) => void;
  onCancelOccurrence: (o: Occurrence) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {existing.location && (
        <Field label="Local">
          <p className="text-[13px] text-[var(--text-secondary)]">{existing.location}</p>
        </Field>
      )}
      {existing.category && (
        <Field label="Categoria">
          <p className="text-[13px] text-[var(--text-secondary)]">{existing.category}</p>
        </Field>
      )}
      {existing.status === "moved" && (
        <p className="text-[12px] text-[var(--text-tertiary)]">
          Esta ocorrência foi remarcada — ela não segue mais a regra da série.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {existing.isRecurring ? (
          <>
            <Button variant="danger" size="sm" onClick={() => onCancelOccurrence(existing)}>
              Cancelar só esta
            </Button>
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => onDelete(existing)}>
              Apagar a série
            </Button>
          </>
        ) : (
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => onDelete(existing)}>
            Apagar
          </Button>
        )}
      </div>
    </div>
  );
}

function rruleLabel(r: Recurrence | null): string {
  return RRULE_OPTIONS.find((o) => o.value?.type === r?.type)?.label ?? "Não repete";
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
