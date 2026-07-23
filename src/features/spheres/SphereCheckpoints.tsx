/**
 * Os checkpoints do dia (§3.1) — recomposto na v1.1 (C2) como o CORAÇÃO do jogo
 * diário, não uma lista de lembretes.
 *
 * Chamava-se `HealthCheckpoints` e **nunca foi da Saúde**: recebe `areaId` e lê os
 * hábitos daquela Esfera, qualquer uma. O nome era a única coisa específica, e um
 * nome específico numa coisa genérica é como um segundo componente igual nasce
 * quando a próxima Esfera precisa do mesmo (ADR-0096).
 *
 * "Checkpoints" não é um conceito novo — são os hábitos REAIS do core, filtrados
 * pela Esfera. Beber água, treinar, tomar sol: cada um já é um hábito com schedule
 * e streak. Marcar aqui é o mesmo tick que marca no módulo de Hábitos — um dado,
 * dois lugares de entrada.
 *
 * O que a v1.1 muda: um ANEL DO DIA no topo que cresce a cada check; cada linha
 * com a sua chama de streak e o número; e o check dispara um "+10 XP" que flutua
 * discreto (o tick vale XP_HABIT_DONE=10, xp.rs). E a mudança estrutural: o
 * "+ Adicionar hábito" mora AQUI, com a Esfera já escolhida — a gestão fina segue
 * na tela global de Hábitos.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CircleCheckBig, Flame, Pencil, Plus } from "lucide-react";

import { Checkbox } from "../../design-system/Checkbox";
import { Button, EmptyState, cx } from "../../design-system/primitives";
import { MonoLabel, Ring, SegBar } from "../../design-system/instruments";
import { ArmedDelete } from "../../design-system/ArmedDelete";
import { useToasts } from "../../stores/toasts";
import {
  deleteNode,
  habitsToday,
  renameNode,
  setNodeStatus,
  tickHabit,
  untickHabit,
  type HabitWithStats,
} from "../../lib/ipc";
import { HabitCreateForm, describeSchedule } from "../habits/HabitsScreen";

export function SphereCheckpoints({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [adding, setAdding] = useState(false);

  const { data: all = [], isLoading } = useQuery({
    queryKey: ["habits", "today"],
    queryFn: habitsToday,
  });

  const habits = useMemo(() => all.filter((h) => h.areaId === areaId), [all, areaId]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["habits"] });
    void client.invalidateQueries({ queryKey: ["spheres"] });
    void client.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const toggle = useMutation({
    mutationFn: (h: HabitWithStats) =>
      h.today === "done" ? untickHabit(h.id) : tickHabit(h.id, "done", null, h.targetValue),
    onSuccess: (streaks) => {
      refresh();
      if (streaks && streaks.isRecord && streaks.current > 1) {
        push("success", `Novo recorde: ${streaks.current} dias seguidos`);
      }
    },
    onError: pushError,
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  const done = habits.filter((h) => h.today === "done").length;
  const total = habits.length;
  const ratio = total > 0 ? done / total : 0;

  if (total === 0 && !adding) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={CircleCheckBig}
          title="Nenhum checkpoint ainda"
          hint="Os checkpoints são hábitos desta Esfera: beber água, treinar, tomar sol. Crie um aqui e ele vira uma caixa do dia — com anel, streak e XP a cada check."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
              Adicionar hábito
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ===== o anel do dia — cresce a cada check =====
          A SegBar tem um segmento POR CHECKPOINT: aqui ela não é decoração da
          porcentagem, é a lista em miniatura. Marcar um hábito acende um
          segmento, e o que falta se conta de relance sem ler número nenhum. */}
      <section
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-5"
        style={{
          background:
            "linear-gradient(135deg, var(--bg-surface), color-mix(in srgb, var(--sphere) 10%, var(--bg-surface)) 120%)",
        }}
      >
        <div className="flex items-center justify-between gap-5">
          <div className="min-w-0 flex-1">
            <MonoLabel>O dia</MonoLabel>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tabular text-[34px] leading-[38px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
                {done}
                <span className="text-[var(--text-tertiary)]">/{total}</span>
              </span>
              <span className="text-[13px] text-[var(--text-secondary)]">checkpoints</span>
            </div>
            <SegBar value={ratio} segments={Math.max(total, 1)} height={12} className="mt-3" />
            <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
              {done === total
                ? "Dia fechado. Constância é isto — de novo amanhã."
                : `${total - done} ${total - done === 1 ? "checkpoint" : "checkpoints"} para fechar o dia`}
            </p>
          </div>
          <Ring value={ratio} size={84} thickness={7} label="feito" />
        </div>
      </section>

      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {done} de {total} feitos hoje
        </span>
        {!adding && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
            Adicionar hábito
          </Button>
        )}
      </div>

      {adding && <HabitCreateForm presetAreaId={areaId} onDone={() => setAdding(false)} />}

      <div className="flex flex-col gap-2">
        {habits.map((h) => (
          <CheckpointRow
            key={h.id}
            habit={h}
            busy={toggle.isPending}
            onToggle={() => toggle.mutate(h)}
            onChanged={refresh}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Uma linha de checkpoint. O check é o gesto — e ao marcar (não desmarcar) um
 * "+10 XP" flutua discreto, a recompensa por sentir o progresso sem circo.
 */
function CheckpointRow({
  habit,
  busy,
  onToggle,
  onChanged,
}: {
  habit: HabitWithStats;
  busy: boolean;
  onToggle: () => void;
  /** Chamado após renomear/desativar/excluir — o pai revalida as queries. */
  onChanged: () => void;
}) {
  const done = habit.today === "done";
  // A key remonta o +XP para reiniciar a animação a cada nova marcação.
  const [floatKey, setFloatKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(habit.title);
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  // RENOMEAR / DESATIVAR / EXCLUIR (fase 11, BUG 2). Um hábito é um `node`, então
  // os comandos genéricos de node servem: renomear, arquivar (soft-disable — some
  // dos checkpoints sem apagar o histórico/streak) e excluir (o `Deleted` no ledger
  // preserva a Timeline). Antes a linha só marcava/desmarcava.
  const rename = useMutation({
    mutationFn: (t: string) => renameNode(habit.id, t),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: pushError,
  });
  const archive = useMutation({
    mutationFn: () => setNodeStatus(habit.id, "archived"),
    onSuccess: () => {
      push("success", `“${habit.title}” foi desativado`);
      onChanged();
    },
    onError: pushError,
  });
  const remove = useMutation({
    mutationFn: () => deleteNode(habit.id),
    onSuccess: () => {
      push("success", "Hábito excluído");
      onChanged();
    },
    onError: pushError,
  });

  const handle = () => {
    // O +XP só na transição para FEITO — desmarcar não premia.
    if (!done) setFloatKey((k) => k + 1);
    onToggle();
  };

  // Um único ponto de commit (o blur): o Enter dá blur, o Esc reverte e dá blur.
  const commitRename = () => {
    const t = title.trim();
    if (!t || t === habit.title) {
      setEditing(false);
      setTitle(habit.title);
      return;
    }
    rename.mutate(t);
  };

  const actionBusy = rename.isPending || archive.isPending || remove.isPending;

  return (
    <div
      className={cx(
        "group relative flex items-center gap-3 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] px-4 py-3",
        "transition-colors duration-[var(--dur-fast)]",
        done ? "border-[color-mix(in_srgb,var(--sphere)_35%,var(--border-subtle))]" : "border-[var(--border-subtle)]",
      )}
    >
      <Checkbox
        checked={done}
        variant={habit.today === "skipped" ? "skipped" : "default"}
        onChange={handle}
        disabled={busy || editing}
        size={24}
        title={done ? `Desmarcar ${habit.title}` : `Marcar ${habit.title}`}
      />

      {/* o +XP que flutua ao marcar (discreto) */}
      {floatKey > 0 && done && (
        <span
          key={floatKey}
          aria-hidden
          className="tabular pointer-events-none absolute left-9 top-1.5 text-[11px] font-semibold text-[var(--sphere)]"
          style={{ animation: "nexus-xp-float 900ms var(--ease) forwards" }}
        >
          +10 XP
        </span>
      )}

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                setTitle(habit.title);
                e.currentTarget.blur();
              }
            }}
            onBlur={commitRename}
            maxLength={80}
            aria-label="Renomear hábito"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-glow)] bg-[var(--bg-raised)] px-2 py-1 text-[14px] text-[var(--text-primary)] caret-[var(--sphere)] outline-none"
          />
        ) : (
          <div
            className={cx(
              "text-[14px] transition-colors duration-[var(--dur-base)]",
              done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]",
            )}
          >
            {habit.title}
          </div>
        )}
        <div className="text-[11px] text-[var(--text-tertiary)]">
          {describeSchedule(habit.schedule)}
          {habit.targetValue != null && ` · meta ${habit.targetValue}${habit.unit ?? ""}`}
        </div>
      </div>

      {/* a chama de streak com o número — o combustível do jogo */}
      {habit.streaks.current > 0 ? (
        <span
          className={cx(
            "tabular flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold",
            habit.streaks.isRecord
              ? "bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--warning)]"
              : "bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--sphere)]",
          )}
          title={`Recorde: ${habit.streaks.record} dias`}
        >
          <Flame size={13} />
          {habit.streaks.current}
          <span className="font-normal opacity-70">
            {habit.streaks.current === 1 ? "dia" : "dias"}
          </span>
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">sem streak</span>
      )}

      {/* AÇÕES do hábito — renomear · desativar · excluir. Discretas: surgem no
          hover/foco da linha (e ficam sempre visíveis no toque). */}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <RowAction
            title="Renomear"
            onClick={() => {
              setTitle(habit.title);
              setEditing(true);
            }}
            disabled={actionBusy}
          >
            <Pencil size={14} />
          </RowAction>
          <RowAction
            title="Desativar (arquiva sem apagar o histórico)"
            onClick={() => archive.mutate()}
            disabled={actionBusy}
          >
            <Archive size={14} />
          </RowAction>
          <ArmedDelete
            onConfirm={() => remove.mutate()}
            pending={remove.isPending}
            question="Excluir este hábito?"
            ariaLabel="Excluir hábito"
            size="sm"
          />
        </div>
      )}
    </div>
  );
}

/** Um botão-ícone discreto para as ações da linha do checkpoint. */
function RowAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 place-items-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
