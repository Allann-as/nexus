/**
 * Exames e consultas (§3.1): eventos de calendário com `category='exame'`.
 *
 * Não uma tabela `exams` — um exame é um compromisso com hora e lugar, e a
 * categoria é a única coisa que o distingue de um almoço (ver a §2 da 0007).
 * Marcá-los no calendário e listá-los aqui é a mesma verdade, dois recortes.
 *
 * O alerta de < 7 dias é o ponto: um exame perdido é uma consulta remarcada em
 * três meses. O que está perto acende.
 *
 * A criação é INLINE (A5): antes só dava para marcar um exame indo até o
 * Calendário — a seção que os LISTA não os criava, e o usuário ficava sem o gesto
 * óbvio. Agora um "+ Adicionar exame" abre um formulário curto aqui mesmo, no
 * padrão das outras seções, e grava o mesmo evento `category='exame'`.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, History, MapPin, Plus, Stethoscope } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { StatTile } from "../../design-system/cards";
import { DatePicker } from "../../design-system/DatePicker";
import { MonoLabel } from "../../design-system/instruments";
import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import {
  createEvent,
  deleteEvent,
  eventsByCategory,
  pastEventsByCategory,
  type Occurrence,
} from "../../lib/ipc";
import { useToasts } from "../../stores/toasts";
import { toDay } from "../calendar/grid";
/* As contas de prazo saíram para `deadline.ts` quando a Faculdade passou a
   precisar das mesmas — uma cópia por tela é como duas telas começam a contar
   dias de forma diferente (ADR-0089). */
import { countdown, daysUntil, elapsed } from "../calendar/deadline";

export function HealthExams({ areaId }: { areaId: string }) {
  const [creating, setCreating] = useState(false);
  const { data: exams = [], isLoading } = useQuery({
    queryKey: ["events", "category", "exame"],
    queryFn: () => eventsByCategory("exame", 40),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["events", "category", "exame", "past"],
    queryFn: () => pastEventsByCategory("exame", 20),
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (exams.length === 0 && history.length === 0 && !creating) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={CalendarClock}
          title="Nenhum exame agendado"
          hint="Um exame ou consulta com hora e lugar. Marque um aqui e ele aparece com alerta quando estiver perto — e também no seu Calendário."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Adicionar exame
            </Button>
          }
        />
      </div>
    );
  }

  const next = exams[0];
  const last = history[0];
  const sinceLast = last ? -daysUntil(last.day) : null;

  /* Quantos exames no último ano — a medida de quem se cuida. Conta os PASSADOS,
     porque um exame agendado ainda não é um exame feito. */
  const lastYear = history.filter((e) => -daysUntil(e.day) <= 365).length;

  return (
    <div className="flex flex-col gap-4">
      {/* A tela era uma lista de compromissos com meia página vazia embaixo. Os
          três tiles e o histórico a transformam num REGISTRO: o que vem, com que
          frequência eu me cuido, e quando foi a última vez. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile
          icon={CalendarClock}
          label="Próximo exame"
          tone="sphere"
          value={next ? countdown(daysUntil(next.day)) : "—"}
          hint={next?.title ?? "nenhum agendado"}
        />
        <StatTile
          icon={Stethoscope}
          label="No último ano"
          value={lastYear}
          unit={lastYear === 1 ? "exame" : "exames"}
          hint="realizados, sem contar os agendados"
        />
        <StatTile
          icon={History}
          label="Desde o último"
          value={sinceLast === null ? "—" : sinceLast}
          unit={sinceLast === null ? undefined : sinceLast === 1 ? "dia" : "dias"}
          hint={last?.title ?? "nenhum registro anterior"}
        />
      </div>

      <div className="flex items-center justify-between px-1">
        <MonoLabel>
          {exams.length} {exams.length === 1 ? "exame agendado" : "exames agendados"}
        </MonoLabel>
        {!creating && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Adicionar exame
          </Button>
        )}
      </div>

      {creating && <ExamForm areaId={areaId} onDone={() => setCreating(false)} />}

      {exams.length === 0 && !creating ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
          Nada agendado. O histórico abaixo continua valendo.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {exams.map((e) => (
            <ExamRow key={`${e.eventId}@${e.startsAt}`} exam={e} days={daysUntil(e.day)} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <>
          <MonoLabel className="mt-2 px-1">Já realizados</MonoLabel>
          <div className="flex flex-col gap-2">
            {history.map((e) => (
              <ExamRow
                key={`${e.eventId}@${e.startsAt}`}
                exam={e}
                days={daysUntil(e.day)}
                past
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * O formulário inline de um exame. Curto por princípio: título, dia, hora e (só se
 * houver) o lugar. A duração não se pergunta — um exame dura o que durar; guarda-se
 * uma hora para o bloco ter tamanho no calendário, e o alerta olha só o dia.
 */
function ExamForm({ areaId, onDone }: { areaId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [title, setTitle] = useState("");
  const [day, setDay] = useState(toDay(new Date()));
  const [time, setTime] = useState("08:00");
  const [location, setLocation] = useState("");

  const valid = title.trim().length > 0 && day.length === 10 && /^\d{2}:\d{2}$/.test(time);

  const create = useMutation({
    mutationFn: () => {
      // Dia local + hora → epoch ms. `T${time}:00` sem sufixo de fuso = hora local,
      // que é o que o usuário digitou.
      const startsAt = new Date(`${day}T${time}:00`).getTime();
      return createEvent({
        title: title.trim(),
        areaId,
        startsAt,
        endsAt: startsAt + 3_600_000,
        location: location.trim() || null,
        category: "exame",
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      push("success", "Exame agendado");
      onDone();
    },
    onError: pushError,
  });

  const submit = () => {
    if (!valid || create.isPending) return;
    create.mutate();
  };

  return (
    <Card className="p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder="Exame de sangue, consulta com o cardiologista…"
        className="w-full bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Field label="Dia">
          <DatePicker
            value={day}
            onChange={(d) => setDay(d ?? "")}
            ariaLabel="Dia do exame"
          />
        </Field>
        <Field label="Hora">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="tabular w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)]"
          />
        </Field>
        <Field label="Local (opcional)">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Laboratório"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {!title.trim() && (
          <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">
            Dê um nome ao exame para agendar
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!valid || create.isPending}
        >
          {create.isPending ? "Agendando…" : "Agendar exame"}
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-[var(--text-tertiary)]">{label}</span>
      {children}
    </label>
  );
}

function ExamRow({
  exam,
  days,
  past = false,
}: {
  exam: Occurrence;
  days: number;
  /** Já aconteceu: sem alerta, com o tempo contado para trás. */
  past?: boolean;
}) {
  const soon = !past && days >= 0 && days < 7;
  const start = new Date(exam.startsAt);

  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  /* Um exame marcado por engano — ou desmarcado pelo laboratório — precisa sair
     da lista. O evento some do estado; o ledger guarda que existiu (ADR-0056). */
  const remove = useMutation({
    mutationFn: () => deleteEvent(exam.eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["events"] });
      push("success", "Exame excluído");
    },
    onError: pushError,
  });

  return (
    <div
      className={cx(
        "flex items-center gap-4 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] px-4 py-3",
        // "Em breve" na cor da SEÇÃO (fase 10 §7), não âmbar: uma cor por Esfera.
        soon ? "border-[color-mix(in_srgb,var(--sphere)_45%,transparent)]" : "border-[var(--border-subtle)]",
        // O passado é passado: a linha recua um tom para o olho ir primeiro ao
        // que ainda vai acontecer.
        past && "opacity-70",
      )}
    >
      {/* A data em bloco: o dia grande, o mês pequeno — leitura de relance. */}
      <div className="flex w-12 shrink-0 flex-col items-center">
        <span className="tabular text-[20px] font-semibold text-[var(--text-primary)]">
          {start.getDate()}
        </span>
        <span className="text-[10px] tracking-wider text-[var(--text-tertiary)] uppercase">
          {start.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-[var(--text-primary)]">
          {exam.title}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
          <span className="tabular">
            {start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          {exam.location && (
            <span className="flex items-center gap-1">
              <MapPin size={11} />
              {exam.location}
            </span>
          )}
        </div>
      </div>

      <span
        className={cx(
          "tabular shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
          soon
            ? "bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--sphere)]"
            : "text-[var(--text-tertiary)]",
        )}
      >
        {past ? elapsed(-days) : countdown(days)}
      </span>

      <ArmedDelete
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
        question="Excluir este exame?"
        ariaLabel="Excluir exame"
      />
    </div>
  );
}
