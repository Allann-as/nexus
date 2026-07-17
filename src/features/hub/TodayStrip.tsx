/**
 * A faixa "Hoje" do Hub — o próximo passo, atravessando todas as Esferas.
 *
 * Compacta de propósito. O Hub responde "como vai a vida?"; esta faixa é a nota
 * de rodapé que responde "e agora?". Se ela crescesse para uma lista completa,
 * o Hub voltaria a ser o Dashboard v1 com cards bonitos em cima.
 *
 * O cartão "Neste dia" (memórias do ledger) entra no M4, junto com a Timeline —
 * ele precisa de rollups que ainda não existem. Um placeholder aqui seria
 * exatamente o tipo de card mentiroso que o Hub não pode ter.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

import {
  setTaskCompleted,
  tickHabit,
  untickHabit,
  type Task,
  type Today,
} from "../../lib/ipc";
import { Checkbox } from "../../design-system/Checkbox";
import { cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

export function TodayStrip({
  data,
  isPending,
}: {
  data: Today | undefined;
  isPending: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["spheres"] });
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

  if (isPending) {
    return <div className="mt-3 h-[92px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />;
  }

  const habits = data?.habits ?? [];
  const tasks = data?.tasks ?? [];
  const pendingHabits = habits.filter((h) => h.today !== "done");
  const pendingTasks = tasks.filter((t) => t.completedAt == null);
  const allDone = habits.length > 0 && pendingHabits.length === 0 && pendingTasks.length === 0;

  // A lista mostra TUDO de hoje, feito e por fazer, na ordem em que veio — o
  // item concluído fica no lugar, riscado.
  //
  // Some-ao-marcar seria pior de duas formas. A óbvia: a linha seguinte pula
  // para debaixo do cursor, e o segundo clique marca o item errado (aconteceu
  // no primeiro teste desta tela). A que importa mais: o risco no texto É a
  // recompensa. Marcar e ver o item evaporar rouba do usuário justamente a
  // prova de que ele fez.
  const VISIBLE = 8;
  const shownHabits = habits.slice(0, VISIBLE);
  const shownTasks = tasks.slice(0, Math.max(0, VISIBLE - shownHabits.length));
  const hidden = habits.length + tasks.length - shownHabits.length - shownTasks.length;

  if (habits.length === 0 && tasks.length === 0) {
    return (
      <div className="mt-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-6 text-center">
        <p className="text-[13px] text-[var(--text-tertiary)]">
          Nada agendado para hoje. Eventos do calendário entram aqui no M3.
        </p>
      </div>
    );
  }

  // Dia fechado: o card vira a comemoração em vez de mostrar uma lista vazia.
  if (allDone) {
    return (
      <div className="relative mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--bg-surface)] px-5 py-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(600px 200px at 50% 120%, color-mix(in srgb, var(--success) 16%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex items-center justify-center gap-2.5">
          <CheckCircle2 size={18} className="text-[var(--success)]" />
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            Dia fechado <span className="text-[var(--success)]">✦</span>
          </p>
        </div>
        <p className="relative mt-1 text-center text-[12px] text-[var(--text-tertiary)]">
          {habits.length} {habits.length === 1 ? "hábito" : "hábitos"}
          {tasks.length > 0 && ` e ${tasks.length} ${tasks.length === 1 ? "tarefa" : "tarefas"}`} —
          tudo em dia.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="divide-y divide-[var(--border-subtle)]">
        {shownHabits.map((h) => {
          const done = h.today === "done";
          return (
            <Row key={h.id} done={done}>
              <Checkbox
                checked={done}
                variant={h.today === "skipped" ? "skipped" : "default"}
                onChange={() => tick.mutate({ id: h.id, done })}
                disabled={tick.isPending}
                size={18}
                title={done ? `Desmarcar ${h.title}` : `Marcar ${h.title}`}
              />
              <Label done={done}>{h.title}</Label>
              {h.streaks.current > 0 && (
                <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
                  {h.streaks.current}d
                </span>
              )}
              {h.reminderTime && (
                <span className="tabular w-[38px] shrink-0 text-right text-[11px] text-[var(--text-tertiary)]">
                  {h.reminderTime}
                </span>
              )}
            </Row>
          );
        })}

        {shownTasks.map((t) => {
          const done = t.completedAt != null;
          return (
            <Row key={t.id} done={done}>
              <Checkbox
                checked={done}
                onChange={() => toggleTask.mutate(t)}
                disabled={toggleTask.isPending}
                size={18}
                color="var(--accent)"
                title={done ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
              />
              <Label done={done}>{t.title}</Label>
              <span className="tabular w-[38px] shrink-0 text-right text-[11px] text-[var(--text-tertiary)]">
                {t.scheduledAt ? formatTime(t.scheduledAt) : "—"}
              </span>
            </Row>
          );
        })}
      </div>

      {hidden > 0 && (
        <button
          onClick={() => navigate("/habits")}
          className="w-full border-t border-[var(--border-subtle)] py-2 text-[12px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          e mais {hidden} →
        </button>
      )}
    </div>
  );
}

function Row({ children, done }: { children: React.ReactNode; done?: boolean }) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 px-4 transition-colors duration-[var(--dur-fast)]",
        "hover:bg-[var(--bg-hover)]",
        done && "opacity-55",
      )}
      style={{ minHeight: "var(--row-list)" }}
    >
      {children}
    </div>
  );
}

/**
 * O texto do item, com o risco animado.
 *
 * O risco é um pseudo-elemento escalado em X, e não `line-through`: um
 * `text-decoration` aparece pronto, de uma vez, e o gesto perde a resposta. Com
 * `transform: scaleX` o traço é RISCADO da esquerda para a direita em 200ms —
 * e, sendo transform, sai de graça no compositor.
 */
function Label({ children, done }: { children: React.ReactNode; done: boolean }) {
  return (
    <span className="relative min-w-0 flex-1 truncate">
      <span
        className={cx(
          "text-[13px] transition-colors duration-[var(--dur-base)]",
          done ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]",
        )}
      >
        {children}
      </span>
      <span
        aria-hidden
        className={cx(
          "absolute top-1/2 left-0 h-[1.5px] w-full origin-left rounded-full bg-[var(--text-tertiary)]",
          "transition-transform duration-[var(--dur-base)] ease-[var(--ease)]",
          done ? "scale-x-100" : "scale-x-0",
        )}
      />
    </span>
  );
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
