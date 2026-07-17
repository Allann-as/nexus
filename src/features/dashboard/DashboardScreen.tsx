/**
 * Dashboard v1 (M2): Hoje + hábitos + Nexus Score.
 *
 * O cartão "Neste dia" e o alerta de sobrecarga (guarda anti-burnout) dependem
 * do bi_engine e chegam no M4. A sparkline de 30 dias também: ela precisa da
 * série histórica de score no ledger, e recalcular 30 dias a cada abertura
 * seria caro e — pior — daria números diferentes conforme o passado mudasse.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Sun, Inbox, Repeat, CheckSquare } from "lucide-react";

import {
  dashboardToday,
  tickHabit,
  untickHabit,
  setTaskCompleted,
  toNexusError,
  type Task,
} from "../../lib/ipc";
import { Card, PageHeader, Kbd, Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { StreakRing } from "../habits/StreakRing";
import { NexusScoreCard } from "./NexusScoreCard";

export function DashboardScreen() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const { data, error, isPending } = useQuery({
    queryKey: ["dashboard", "today"],
    queryFn: dashboardToday,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["habits"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      done ? untickHabit(id) : tickHabit(id, "done"),
    onSuccess: (streaks) => {
      invalidate();
      if (streaks.isRecord && streaks.current > 1) {
        push("success", `Novo recorde: ${streaks.current} dias seguidos`);
      }
    },
    onError: pushError,
  });

  const toggleTask = useMutation({
    mutationFn: (t: Task) => setTaskCompleted(t.id, t.completedAt == null),
    onSuccess: invalidate,
    onError: pushError,
  });

  if (error) {
    return (
      <div className="p-8">
        <Card className="border-[var(--danger)] p-4">
          <p className="text-[13px] text-[var(--danger)]">{toNexusError(error).message}</p>
        </Card>
      </div>
    );
  }

  const habits = data?.habits ?? [];
  const tasks = data?.tasks ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Dashboard" subtitle={data ? formatToday(data.day) : "Carregando…"} />

      <div className="grid grid-cols-[1fr_360px] gap-4 px-8 pb-8">
        {/* ===== coluna esquerda: o dia ===== */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <SectionHeader icon={Repeat} title="Hábitos de hoje" count={habits.length} />
            {habits.length === 0 ? (
              <Empty
                text={
                  isPending
                    ? "Carregando…"
                    : "Nenhum hábito agendado para hoje."
                }
                action={
                  !isPending
                    ? { label: "Criar hábito", onClick: () => navigate("/habits") }
                    : undefined
                }
              />
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {habits.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 px-3 transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ minHeight: "var(--row-list)" }}
                  >
                    <StreakRing
                      streak={h.streaks.current}
                      status={h.today}
                      onClick={() => tick.mutate({ id: h.id, done: h.today === "done" })}
                      disabled={tick.isPending}
                      title={h.today === "done" ? `Desmarcar ${h.title}` : `Marcar ${h.title}`}
                    />
                    <span
                      className={cx(
                        "min-w-0 flex-1 truncate text-[13px]",
                        h.today === "done"
                          ? "text-[var(--text-tertiary)] line-through"
                          : "text-[var(--text-primary)]",
                      )}
                    >
                      {h.title}
                    </span>
                    {h.reminderTime && (
                      <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
                        {h.reminderTime}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden">
            <SectionHeader icon={Sun} title="Agenda de hoje" count={tasks.length} />
            {tasks.length === 0 ? (
              <Empty text="Nada agendado para hoje. Eventos do calendário entram aqui no M3." />
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-3 transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ minHeight: "var(--row-list)" }}
                  >
                    <span className="tabular w-[42px] shrink-0 text-[11px] text-[var(--text-tertiary)]">
                      {t.scheduledAt ? formatTime(t.scheduledAt) : "—"}
                    </span>
                    <button
                      onClick={() => toggleTask.mutate(t)}
                      aria-label={`Concluir ${t.title}`}
                      className="size-[15px] shrink-0 rounded-[4px] border border-[var(--border-strong)] transition-colors hover:border-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                    {t.durationMin && (
                      <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
                        {t.durationMin}min
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ===== coluna direita: score e atalhos ===== */}
        <div className="space-y-4">
          {data && <NexusScoreCard score={data.score} />}

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                <Inbox size={13} />
                <span className="text-[11px] font-medium tracking-[0.06em] uppercase">
                  Inbox
                </span>
              </div>
              <span className="tabular text-[15px] font-medium">
                {data?.inboxOpen ?? "—"}
              </span>
            </div>
            {(data?.inboxOpen ?? 0) > 0 ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => navigate("/inbox")}
              >
                Triar agora
              </Button>
            ) : (
              <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
                Zerada — nada esperando decisão.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
              <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>N</Kbd> captura de qualquer tela.{" "}
              <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> busca e navega.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Sun;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
      <Icon size={13} className="text-[var(--text-tertiary)]" />
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
        {title}
      </h2>
      {count > 0 && (
        <span className="tabular text-[11px] text-[var(--text-tertiary)]">{count}</span>
      )}
    </div>
  );
}

function Empty({
  text,
  action,
}: {
  text: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8">
      <p className="text-center text-[12px] text-[var(--text-tertiary)]">{text}</p>
      {action && (
        <Button size="sm" variant="secondary" icon={CheckSquare} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

function formatToday(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
