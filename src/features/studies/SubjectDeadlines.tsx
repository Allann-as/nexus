/**
 * As ENTREGAS e PROVAS de uma matéria da Faculdade.
 *
 * Nenhum schema novo: uma entrega é um `event` com `category='entrega'` e uma
 * prova é um com `category='prova'` — o mesmo mecanismo que a Saúde usa para os
 * Exames desde a 0007, onde `event_details.category` é TEXT livre. O que a fase 4
 * acrescentou foi o VÍNCULO (`nodes.parent_id` = a matéria) e a OBSERVAÇÃO
 * (`event_details.notes`, coluna que existia desde a 0017 sem ninguém escrevê-la).
 *
 * Consequência que vale dizer: marcar aqui é marcar no CALENDÁRIO. Não são duas
 * verdades — é a mesma, em dois recortes.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Plus, X } from "lucide-react";

import { DatePicker } from "../../design-system/DatePicker";
import { cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { createEvent, deleteEvent, type Occurrence } from "../../lib/ipc";
import { countdown, daysUntil, isSoon } from "../calendar/deadline";
import { toDay } from "../calendar/grid";

/** As duas categorias que a Faculdade marca, com o vocabulário de cada uma. */
const KINDS = [
  { key: "entrega", label: "Entrega", placeholder: "Trabalho de Cálculo, relatório…" },
  { key: "prova", label: "Prova", placeholder: "P1, prova final…" },
] as const;

type DeadlineKind = (typeof KINDS)[number]["key"];

export function SubjectDeadlines({
  subjectId,
  subjectTitle,
  areaId,
  /** As ocorrências JÁ filtradas para esta matéria — a busca é uma só, no topo. */
  items,
}: {
  subjectId: string;
  subjectTitle: string;
  areaId: string;
  items: Occurrence[];
}) {
  const [adding, setAdding] = useState<DeadlineKind | null>(null);

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
          Entregas e provas
        </span>
        {/* A contagem só aparece com o que contar. "0 compromissos" não é
            informação — a frase do vazio, abaixo, já diz o mesmo melhor. */}
        {items.length > 0 && (
          <span className="tabular text-[11px] text-[var(--text-secondary)]">
            {items.length} {items.length === 1 ? "marcada" : "marcadas"}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Nada marcado — a data que existe no papel e não no app é a que passa.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((o) => (
            <DeadlineRow key={`${o.eventId}@${o.startsAt}`} occurrence={o} />
          ))}
        </ul>
      )}

      {adding ? (
        <DeadlineForm
          kind={adding}
          subjectId={subjectId}
          subjectTitle={subjectTitle}
          areaId={areaId}
          onDone={() => setAdding(null)}
        />
      ) : (
        <div className="flex gap-3">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => setAdding(k.key)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:text-[var(--sphere)]"
            >
              <Plus size={12} strokeWidth={2.4} />
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeadlineRow({ occurrence }: { occurrence: Occurrence }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const days = daysUntil(occurrence.day);
  const soon = isSoon(days);
  const prova = occurrence.category === "prova";

  const remove = useMutation({
    mutationFn: () => deleteEvent(occurrence.eventId),
    onSuccess: () => {
      push("success", prova ? "Prova removida" : "Entrega removida");
      void qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: pushError,
  });

  return (
    <li className="group flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        {/* Prova e entrega se distinguem pelo ÍCONE, não pela cor: a cor da
            Esfera já está tomada, e duas cores novas num card pequeno viram
            semáforo sem significado. */}
        <span className="shrink-0 translate-y-[2px] text-[var(--text-tertiary)]">
          {prova ? <FileText size={12} /> : <CalendarClock size={12} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
          {occurrence.title}
        </span>
        <span
          className={cx(
            "tabular shrink-0 text-[11px]",
            soon ? "font-semibold text-[var(--warning)]" : "text-[var(--text-tertiary)]",
          )}
        >
          {countdown(days)}
        </span>
        <button
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          aria-label={`Excluir ${occurrence.title}`}
          className="grid size-5 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] opacity-0 transition-[opacity,color] duration-[var(--dur-fast)] group-hover:opacity-100 hover:text-[var(--danger)] focus-visible:opacity-100"
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      </div>
      {/* A observação ganha LINHA PRÓPRIA. Na mesma linha do título ela era
          espremida entre o nome e a contagem e saía como "· vale ..." — um dado
          que existe, ocupa espaço e não se lê. Aqui ela quebra em até duas
          linhas: "trazer calculadora" só serve se der para ler. */}
      {occurrence.notes && (
        <p className="pl-5 text-[11px] leading-snug text-[var(--text-tertiary)]">
          {occurrence.notes}
        </p>
      )}
    </li>
  );
}

/**
 * O formulário de uma entrega ou prova. Três campos e nada mais: o quê, quando,
 * e a observação (opcional).
 *
 * A hora não se pergunta. Uma entrega vence num DIA — "23:59 do dia 12" é o que
 * o aluno tem na cabeça, não "às 14h30". O evento nasce às 23h para ocupar o fim
 * do dia no Calendário, e a contagem de dias, que é o que a tela mostra, não
 * depende disso.
 */
function DeadlineForm({
  kind,
  subjectId,
  subjectTitle,
  areaId,
  onDone,
}: {
  kind: DeadlineKind;
  subjectId: string;
  subjectTitle: string;
  areaId: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const meta = KINDS.find((k) => k.key === kind)!;

  const [title, setTitle] = useState("");
  const [day, setDay] = useState(toDay(new Date()));
  const [notes, setNotes] = useState("");

  const valid = title.trim().length > 0 && day.length === 10;

  const create = useMutation({
    mutationFn: () => {
      const startsAt = new Date(`${day}T23:00:00`).getTime();
      return createEvent({
        title: title.trim(),
        areaId,
        parentId: subjectId,
        startsAt,
        endsAt: startsAt + 3_600_000,
        category: kind,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      push("success", `${meta.label} marcada em ${subjectTitle}`);
      onDone();
    },
    onError: pushError,
  });

  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate();
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
      <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--sphere)] uppercase">
        Nova {meta.label.toLowerCase()}
      </span>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder={meta.placeholder}
        aria-label={`Título da ${meta.label.toLowerCase()}`}
        className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
      />
      <DatePicker
        value={day}
        onChange={(d) => setDay(d ?? "")}
        ariaLabel={`Dia da ${meta.label.toLowerCase()}`}
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder="Observação (trazer calculadora…)"
        aria-label="Observação"
        className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
      />
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onDone}
          className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={!valid || create.isPending}
          className="h-7 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_12%,transparent)] px-2.5 text-[11px] font-medium text-[var(--sphere)] transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] disabled:opacity-40"
        >
          Marcar
        </button>
      </div>
    </div>
  );
}
