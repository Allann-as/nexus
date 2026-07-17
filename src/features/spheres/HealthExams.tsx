/**
 * Exames e consultas (§3.1): eventos de calendário com `category='exame'`.
 *
 * Não uma tabela `exams` — um exame é um compromisso com hora e lugar, e a
 * categoria é a única coisa que o distingue de um almoço (ver a §2 da 0007).
 * Marcá-los no calendário e listá-los aqui é a mesma verdade, dois recortes.
 *
 * O alerta de < 7 dias é o ponto: um exame perdido é uma consulta remarcada em
 * três meses. O que está perto acende.
 */

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button, EmptyState, cx } from "../../design-system/primitives";
import { eventsByCategory, type Occurrence } from "../../lib/ipc";
import { fromDay, toDay } from "../calendar/grid";

/** Dias até um exame, a partir de hoje (dia local, não milissegundos). */
function daysUntil(day: string): number {
  const today = fromDay(toDay(new Date()));
  const target = fromDay(day);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function HealthExams() {
  const navigate = useNavigate();
  const { data: exams = [], isLoading } = useQuery({
    queryKey: ["events", "category", "exame"],
    queryFn: () => eventsByCategory("exame", 40),
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (exams.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={CalendarClock}
          title="Nenhum exame agendado"
          hint="Marque um exame ou consulta no Calendário com a categoria 'exame' e ele aparece aqui, com alerta quando estiver perto."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate("/calendar")}>
              Abrir o Calendário
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {exams.map((e) => (
        <ExamRow key={`${e.eventId}@${e.startsAt}`} exam={e} days={daysUntil(e.day)} />
      ))}
    </div>
  );
}

function ExamRow({ exam, days }: { exam: Occurrence; days: number }) {
  const soon = days >= 0 && days < 7;
  const start = new Date(exam.startsAt);

  return (
    <div
      className={cx(
        "flex items-center gap-4 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] px-4 py-3",
        soon ? "border-[var(--warning)]" : "border-[var(--border-subtle)]",
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
            ? "bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]"
            : "text-[var(--text-tertiary)]",
        )}
      >
        {days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`}
      </span>
    </div>
  );
}
