/**
 * A AGENDA DO DIA — a coluna direita do Command Deck (v1.3, §2.1).
 *
 * Substitui a `TodayStrip`, que era uma FAIXA horizontal no rodapé do Hub. O
 * Cockpit move o "e agora?" para uma coluna vertical fixa: ela cabe na altura da
 * tela sem empurrar nada, e o olho a encontra no mesmo lugar toda vez.
 *
 * O que NÃO mudou, de propósito, porque era a parte certa da faixa antiga:
 *
 *   * **Marcar aqui é o tick de sempre** — o mesmo `tickHabit`/`setTaskCompleted`
 *     do resto do app, com a mesma invalidação. A agenda não é um espelho
 *     read-only: o Hub é a tela mais aberta, e obrigar um desvio para marcar um
 *     hábito seria transformar a tela inicial num pôster.
 *   * **O item concluído FICA no lugar, riscado.** Some-ao-marcar quebra de duas
 *     formas: a linha seguinte pula para debaixo do cursor e o segundo clique
 *     marca o item errado (aconteceu no primeiro teste da faixa antiga), e — o
 *     que importa mais — o risco no texto É a recompensa. Marcar e ver o item
 *     evaporar rouba do usuário a prova de que ele fez.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ListTodo } from "lucide-react";

import {
  setTaskCompleted,
  tickHabit,
  untickHabit,
  type Task,
  type Today,
} from "../../lib/ipc";
import { Checkbox } from "../../design-system/Checkbox";
import { cx } from "../../design-system/primitives";
import { Terminal } from "../../design-system/instruments";
import { useToasts } from "../../stores/toasts";

/** Quantos itens cabem antes de a coluna virar uma lista de rolagem infinita. */
const VISIBLE = 9;

export function DayAgenda({ data, isPending }: { data: Today | undefined; isPending: boolean }) {
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

  const habits = data?.habits ?? [];
  const tasks = data?.tasks ?? [];
  const total = habits.length + tasks.length;
  const doneCount =
    habits.filter((h) => h.today === "done").length + tasks.filter((t) => t.completedAt != null).length;
  const allDone = total > 0 && doneCount === total;

  const shownHabits = habits.slice(0, VISIBLE);
  const shownTasks = tasks.slice(0, Math.max(0, VISIBLE - shownHabits.length));
  const hidden = total - shownHabits.length - shownTasks.length;

  return (
    <Terminal
      title="Agenda de hoje"
      icon={ListTodo}
      right={
        total > 0 ? (
          <span className="tabular text-[11px] text-[var(--text-secondary)]">
            {doneCount}/{total}
          </span>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {isPending ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-raised)]"
              style={{ animationDelay: `${i * 70}ms` }}
            />
          ))}
        </div>
      ) : total === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
          Nada agendado para hoje.
        </p>
      ) : (
        <>
          {/* O dia fechado ganha a faixa de comemoração NO TOPO — a lista segue
              abaixo, riscada, porque a prova do feito é ela. */}
          {allDone && (
            <div className="flex items-center justify-center gap-2 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] py-2">
              <CheckCircle2 size={14} className="text-[var(--success)]" />
              <span className="text-[12px] font-medium text-[var(--text-primary)]">Dia fechado</span>
            </div>
          )}

          <ul className="divide-y divide-[var(--border-subtle)]">
            {shownHabits.map((h) => {
              const done = h.today === "done";
              return (
                <li key={h.id} className="flex items-center gap-2.5 px-3 py-2">
                  <Checkbox
                    checked={done}
                    variant={h.today === "skipped" ? "skipped" : "default"}
                    onChange={() => tick.mutate({ id: h.id, done })}
                    disabled={tick.isPending}
                    size={16}
                    title={done ? `Desmarcar ${h.title}` : `Marcar ${h.title}`}
                  />
                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-[12.5px]",
                      done
                        ? "text-[var(--text-tertiary)] line-through"
                        : "text-[var(--text-primary)]",
                    )}
                  >
                    {h.title}
                  </span>
                  {h.streaks.current > 0 && (
                    <span className="tabular shrink-0 text-[10px] text-[var(--text-tertiary)]">
                      {h.streaks.current}d
                    </span>
                  )}
                </li>
              );
            })}

            {shownTasks.map((t) => {
              const done = t.completedAt != null;
              return (
                <li key={t.id} className="flex items-center gap-2.5 px-3 py-2">
                  <Checkbox
                    checked={done}
                    onChange={() => toggleTask.mutate(t)}
                    disabled={toggleTask.isPending}
                    size={16}
                    title={done ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
                  />
                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-[12.5px]",
                      done
                        ? "text-[var(--text-tertiary)] line-through"
                        : "text-[var(--text-primary)]",
                    )}
                  >
                    {t.title}
                  </span>
                </li>
              );
            })}
          </ul>

          {hidden > 0 && (
            <button
              onClick={() => navigate("/habits")}
              className="w-full border-t border-[var(--border-subtle)] px-3 py-2 text-left text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              e mais {hidden} {hidden === 1 ? "item" : "itens"} →
            </button>
          )}
        </>
      )}
    </Terminal>
  );
}
