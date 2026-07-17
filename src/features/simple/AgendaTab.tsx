/**
 * A Agenda de uma Esfera 'simple' (§2.4): compromissos com data/hora criados
 * aqui e visíveis no Calendário unificado.
 *
 * Um compromisso É um evento do calendário (mesma tabela, mesma tela unificada):
 * criar aqui e abrir o Calendário mostra o mesmo item. Nada paralelo.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, CalendarDays } from "lucide-react";

import { Button, EmptyState } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { toDay } from "../calendar/grid";
import { createEvent, eventsRange, type Occurrence } from "../../lib/ipc";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${d} de ${MONTHS[m - 1]}`;
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function AgendaTab({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    // 'YYYY-MM-DDTHH:mm' para o input datetime-local.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const from = toDay(new Date());
  const to = toDay(new Date(Date.now() + 60 * 24 * 3600 * 1000));
  const events = useQuery({
    queryKey: ["agenda", areaId, from],
    queryFn: () => eventsRange(from, to),
  });

  // Só os compromissos desta Esfera, dos próximos 60 dias.
  const byDay = useMemo(() => {
    const mine = (events.data ?? []).filter((o) => o.areaId === areaId);
    const groups = new Map<string, Occurrence[]>();
    for (const o of mine) {
      if (!groups.has(o.day)) groups.set(o.day, []);
      groups.get(o.day)!.push(o);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events.data, areaId]);

  const create = async () => {
    if (!title.trim()) return;
    const startsAt = new Date(when).getTime();
    if (!Number.isFinite(startsAt)) return;
    try {
      await createEvent({
        title: title.trim(),
        areaId,
        startsAt,
        endsAt: startsAt + 60 * 60_000,
      });
      push("success", "Compromisso criado");
      setTitle("");
      setAdding(false);
      void client.invalidateQueries({ queryKey: ["agenda"] });
      void client.invalidateQueries({ queryKey: ["calendar"] });
    } catch (e) {
      pushError(e);
    }
  };

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Agenda</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={CalendarDays} onClick={() => navigate("/calendar")}>
            Calendário
          </Button>
          <Button variant="primary" size="sm" icon={CalendarPlus} onClick={() => setAdding((v) => !v)}>
            Novo
          </Button>
        </div>
      </header>

      {adding && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder="O que vai acontecer?"
            className="h-9 min-w-[180px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] [color-scheme:dark]"
          />
          <Button variant="primary" size="sm" onClick={create} disabled={!title.trim()}>
            Criar
          </Button>
        </div>
      )}

      {events.isLoading ? (
        <div className="h-24 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
      ) : byDay.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nenhum compromisso próximo"
          hint="Crie um compromisso — ele aparece aqui e no Calendário unificado."
          action={
            <Button variant="primary" size="sm" icon={CalendarPlus} onClick={() => setAdding(true)}>
              Novo compromisso
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {byDay.map(([day, occs]) => (
            <div key={day}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
                {dayLabel(day)}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {occs.map((o) => (
                  <li
                    key={`${o.eventId}-${o.startsAt}`}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5"
                  >
                    <span className="tabular w-12 shrink-0 text-[12px] font-medium text-[var(--sphere)]">
                      {o.allDay ? "dia" : hhmm(o.startsAt)}
                    </span>
                    <span className="flex-1 truncate text-[13.5px] text-[var(--text-primary)]">
                      {o.title}
                    </span>
                    {o.isRecurring && (
                      <span className="text-[10px] text-[var(--text-tertiary)]">repete</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
