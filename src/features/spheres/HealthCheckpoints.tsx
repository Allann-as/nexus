/**
 * Os checkpoints do dia da Saúde (§3.1): os hábitos da Esfera como caixas
 * diárias, cada uma com streak e o checkbox animado.
 *
 * "Checkpoints" não é um conceito novo — são os hábitos REAIS do core, filtrados
 * pela Esfera. Beber água, treinar, tomar sol: cada um já é um hábito com
 * schedule e streak. A tab só os apresenta como a lista de "o que eu faço todo
 * dia pela minha saúde", e marcar aqui é o mesmo tick que marca no módulo de
 * Hábitos — um dado, dois lugares de entrada.
 */

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Checkbox } from "../../design-system/Checkbox";
import { Button, EmptyState, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { habitsToday, tickHabit, untickHabit, type HabitWithStats } from "../../lib/ipc";

export function HealthCheckpoints({ areaId }: { areaId: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const pushError = useToasts((s) => s.pushError);

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["habits", "today"],
    queryFn: habitsToday,
  });

  // Filtra no cliente: `habits_today` já é UMA query para o app todo, e o Hub e
  // o Dashboard também a usam. Uma variante por Esfera seria uma segunda rota
  // para a mesma pergunta.
  const habits = useMemo(() => all.filter((h) => h.areaId === areaId), [all, areaId]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["habits"] });
    void client.invalidateQueries({ queryKey: ["spheres"] });
  };

  const toggle = useMutation({
    mutationFn: (h: HabitWithStats) =>
      h.today === "done" ? untickHabit(h.id) : tickHabit(h.id, "done", null, h.targetValue),
    onSuccess: refresh,
    onError: pushError,
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (habits.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={Plus}
          title="Nenhum checkpoint ainda"
          hint="Os checkpoints da Saúde são hábitos: beber água, treinar, tomar sol. Crie um hábito ligado a esta Esfera e ele aparece aqui como caixa do dia."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate("/habits")}>
              Criar um hábito
            </Button>
          }
        />
      </div>
    );
  }

  const done = habits.filter((h) => h.today === "done").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {done} de {habits.length} feitos hoje
        </span>
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => navigate("/habits")}>
          Gerenciar
        </Button>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {habits.map((h, i) => (
          <div
            key={h.id}
            className={cx(
              "flex items-center gap-3 px-4 py-3",
              i > 0 && "border-t border-[var(--border-subtle)]",
            )}
          >
            <Checkbox
              checked={h.today === "done"}
              onChange={() => toggle.mutate(h)}
              size={22}
              title={h.title}
            />
            <div className="min-w-0 flex-1">
              <div
                className={cx(
                  "text-[14px]",
                  h.today === "done"
                    ? "text-[var(--text-tertiary)] line-through"
                    : "text-[var(--text-primary)]",
                )}
              >
                {h.title}
              </div>
              {h.targetValue && h.unit && (
                <div className="text-[11px] text-[var(--text-tertiary)]">
                  meta: {h.targetValue} {h.unit}
                </div>
              )}
            </div>
            {h.streaks.current > 0 && (
              <span className="tabular flex shrink-0 items-center gap-1 text-[12px] text-[var(--sphere)]">
                <Flame size={13} />
                {h.streaks.current}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
