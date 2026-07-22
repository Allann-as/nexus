/**
 * Hábitos & Rotinas.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat, Plus, Zap, Flame } from "lucide-react";

import {
  habitsToday,
  listHabits,
  tickHabit,
  untickHabit,
  createHabit,
  completeRoutine,
  listAreas,
  type Schedule,
  type HabitWithStats,
} from "../../lib/ipc";
import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { Checkbox } from "../../design-system/Checkbox";
import { HeroCard } from "../../design-system/cards";
import { ProgressRing } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import { HabitDetail } from "./HabitDetail";

export function HabitsScreen() {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [creating, setCreating] = useState(false);
  const [openHabit, setOpenHabit] = useState<string | null>(null);

  const { data: today = [], isPending } = useQuery({
    queryKey: ["habits", "today"],
    queryFn: habitsToday,
  });

  const { data: all = [] } = useQuery({
    queryKey: ["habits", "all"],
    queryFn: () => listHabits(),
  });

  // Esta tela atravessa TODAS as Esferas, então não há uma cor de página: quem
  // recebe `--sphere` é cada linha, pela Esfera do próprio hábito. Mesma query
  // (e mesmo cache) que o formulário de criação usa para o select de Área.
  const { data: areas = [] } = useQuery({ queryKey: ["areas"], queryFn: () => listAreas(false) });
  const colorOf = useMemo(() => new Map(areas.map((a) => [a.id, a.color])), [areas]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["habits"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      // Reclicar desmarca: o gesto de marcar é o mesmo de desfazer, porque o
      // erro mais comum é o clique errado.
      done ? untickHabit(id) : tickHabit(id, "done"),
    onSuccess: (streaks) => {
      invalidate();
      if (streaks.isRecord && streaks.current > 1) {
        push("success", `Novo recorde: ${streaks.current} dias seguidos`);
      }
    },
    onError: pushError,
  });

  const routine = useMutation({
    mutationFn: (id: string) => completeRoutine(id),
    onSuccess: (n) => {
      invalidate();
      push("success", `Rotina concluída — ${n} ${n === 1 ? "hábito" : "hábitos"}`);
    },
    onError: pushError,
  });

  // Agrupa por rotina, preservando a ordem que veio do backend.
  const groups = groupByRoutine(today, all);

  const doneToday = today.filter((h) => h.today === "done").length;
  const total = today.length;
  const ratio = total > 0 ? doneToday / total : 0;

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-8 pt-8 pb-12">
        <header className="flex items-start justify-between gap-6">
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.03em]">
            Hábitos
          </h1>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Novo hábito
          </Button>
        </header>

        {creating && (
          <div className="mt-6">
            <HabitCreateForm onDone={() => setCreating(false)} />
          </div>
        )}

        {all.length === 0 && !isPending && !creating ? (
          <div className="h-[420px]">
            <EmptyState
              icon={Repeat}
              title="Nenhum hábito ainda"
              hint="Um hábito pode ser binário (meditei?) ou quantitativo (2L de água). Rotinas agrupam vários — e você marca todos de uma vez."
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  Criar o primeiro
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {!isPending && (
              <div className="mt-6">
                <HeroCard
                  label="Hoje"
                  value={total > 0 ? `${doneToday}/${total}` : "—"}
                  hint={
                    total > 0
                      ? `${Math.round(ratio * 100)}% dos hábitos agendados para hoje`
                      : "Nenhum hábito agendado para hoje"
                  }
                  aside={
                    <ProgressRing value={ratio} size={72} thickness={6}>
                      <span className="tabular text-[15px] font-semibold">
                        {Math.round(ratio * 100)}%
                      </span>
                    </ProgressRing>
                  }
                />
              </div>
            )}

            <div className="mt-6 space-y-6">
              {groups.map((group) => (
                <div key={group.routineId ?? "avulsos"}>
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                      {group.title}
                    </h2>
                    {group.routineId && group.habits.length > 0 && (
                      <button
                        onClick={() => routine.mutate(group.routineId!)}
                        disabled={routine.isPending}
                        className={cx(
                          "flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent px-1.5 py-0.5 text-[10px] text-[var(--accent)]",
                          "transition-[background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
                          "hover:border-[var(--border-glow)] hover:bg-[var(--accent-muted)] disabled:opacity-40",
                        )}
                      >
                        <Zap size={10} />
                        concluir tudo
                      </button>
                    )}
                  </div>

                  <Card className="divide-y divide-[var(--border-subtle)] overflow-hidden">
                    {group.habits.map((h) => (
                      <HabitRow
                        key={h.id}
                        habit={h}
                        color={h.areaId ? colorOf.get(h.areaId) : undefined}
                        busy={tick.isPending}
                        onToggle={() => tick.mutate({ id: h.id, done: h.today === "done" })}
                        onOpen={() => setOpenHabit(h.id)}
                      />
                    ))}
                    {group.habits.length === 0 && (
                      <p className="px-4 py-3 text-[12px] text-[var(--text-tertiary)]">
                        Nada agendado para hoje.
                      </p>
                    )}
                  </Card>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {openHabit && <HabitDetail id={openHabit} onClose={() => setOpenHabit(null)} />}
    </div>
  );
}

function HabitRow({
  habit,
  color,
  busy,
  onToggle,
  onOpen,
}: {
  habit: HabitWithStats;
  /** A cor da Esfera do hábito. `undefined` = hábito sem Área: fica no azul do app. */
  color?: string;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = habit.today === "done";

  return (
    <div
      className="flex items-center gap-3 px-3 transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)]"
      style={
        {
          minHeight: "var(--row-list)",
          ...(color ? { "--sphere": color } : {}),
        } as React.CSSProperties
      }
    >
      {/* Marcar aqui é binário mesmo para hábito com meta — `tick_habit` grava
          "done", não o valor. O aro de streak não cabe neste gesto: o número
          dele já está no chip da direita, e um anel que só repete o vizinho é
          um alvo de clique caro por nada. */}
      <Checkbox
        checked={done}
        variant={habit.today === "skipped" ? "skipped" : "default"}
        onChange={onToggle}
        disabled={busy}
        size={18}
        title={done ? `Desmarcar ${habit.title}` : `Marcar ${habit.title}`}
      />

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={cx(
            "block truncate text-[13px] transition-colors duration-[var(--dur-base)]",
            done
              ? "text-[var(--text-tertiary)] line-through"
              : "text-[var(--text-primary)]",
          )}
        >
          {habit.title}
        </span>
        <span className="block text-[11px] text-[var(--text-tertiary)]">
          {describeSchedule(habit.schedule)}
          {habit.targetValue != null && ` · meta ${habit.targetValue}${habit.unit ?? ""}`}
        </span>
      </button>

      {habit.streaks.current > 0 && (
        <span
          className={cx(
            "tabular flex shrink-0 items-center gap-1 text-[11px]",
            habit.streaks.isRecord
              ? "text-[var(--warning)]"
              : "text-[var(--text-tertiary)]",
          )}
          title={`Recorde: ${habit.streaks.record}`}
        >
          <Flame size={11} />
          {habit.streaks.current}
        </span>
      )}
    </div>
  );
}

/**
 * O formulário de criação de hábito, compartilhado entre a tela global de Hábitos
 * e o "+ Adicionar hábito" contextual dos Checkpoints de uma Esfera (C2). Quando
 * `presetAreaId` vem, a Esfera já está escolhida — o campo Área some, porque
 * perguntar de novo o que o contexto já respondeu é ruído.
 */
export function HabitCreateForm({
  onDone,
  presetAreaId,
}: {
  onDone: () => void;
  presetAreaId?: string;
}) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"daily" | "weekdays" | "times_per_week">("daily");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [times, setTimes] = useState(3);
  const [areaId, setAreaId] = useState<string>(presetAreaId ?? "");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [reminder, setReminder] = useState("");

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
    enabled: !presetAreaId,
  });

  const create = useMutation({
    mutationFn: () => {
      const schedule: Schedule =
        kind === "daily"
          ? { type: "daily" }
          : kind === "weekdays"
            ? { type: "weekdays", days }
            : { type: "times_per_week", n: times };

      const parsedTarget = target.trim() ? Number(target) : null;
      return createHabit({
        title: title.trim(),
        areaId: areaId || null,
        schedule,
        targetValue: Number.isFinite(parsedTarget) ? parsedTarget : null,
        unit: unit.trim() || null,
        reminderTime: reminder.trim() || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      // O overview das Esferas é quem sabe se uma Esfera está VAZIA. Sem esta
      // linha, criar o primeiro hábito da Casa pelo botão contextual do Painel
      // deixava a tela dizendo "Casa começa aqui" com o hábito já criado — a
      // tela afirmando o contrário do banco (ADR-0096).
      qc.invalidateQueries({ queryKey: ["spheres", "overview"] });
      qc.invalidateQueries({ queryKey: ["nodes", "count"] });
      onDone();
    },
    onError: pushError,
  });

  // O botão só depende do NOME (o resto tem padrão ou é opcional) — mas um
  // "weekdays" sem nenhum dia marcado é rejeitado pelo backend, então guarda-se
  // isso aqui em vez de deixar o clique virar um toast de erro. E o motivo de o
  // botão estar travado passa a ser DITO (A4): o placeholder "2/L/07:30" dos
  // opcionais fazia o formulário parecer preenchido, e o botão morto sem nome
  // lia como quebrado.
  const missingDays = kind === "weekdays" && days.length === 0;
  const canSave = title.trim().length > 0 && !missingDays && !create.isPending;
  const blockedReason = !title.trim()
    ? "Dê um nome ao hábito para criar"
    : missingDays
      ? "Escolha ao menos um dia da semana"
      : null;

  const submit = () => {
    if (!canSave) return;
    create.mutate();
  };

  return (
    <Card className="mb-4 p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder="Nome do hábito (ex: Meditar)"
        className="w-full bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-[var(--text-tertiary)]">Quando</span>
        {(
          [
            ["daily", "Todo dia"],
            ["weekdays", "Dias da semana"],
            ["times_per_week", "N× por semana"],
          ] as const
        ).map(([k, label]) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
            {label}
          </Chip>
        ))}
      </div>

      {kind === "weekdays" && (
        <div className="mt-2 flex items-center gap-1.5">
          {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
            <Chip
              key={i}
              active={days.includes(i)}
              onClick={() =>
                setDays((cur) =>
                  cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort(),
                )
              }
            >
              {d}
            </Chip>
          ))}
        </div>
      )}

      {kind === "times_per_week" && (
        <div className="mt-2 flex items-center gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <Chip key={n} active={times === n} onClick={() => setTimes(n)}>
              {n}×
            </Chip>
          ))}
        </div>
      )}

      <div className={cx("mt-4 grid gap-2", presetAreaId ? "grid-cols-3" : "grid-cols-4")}>
        {!presetAreaId && (
          <Field label="Área">
            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none"
            >
              <option value="">nenhuma</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Meta (opcional)">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            placeholder="2"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-[12px] outline-none"
          />
        </Field>
        <Field label="Unidade">
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="L"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-[12px] outline-none"
          />
        </Field>
        <Field label="Lembrete">
          <input
            value={reminder}
            onChange={(e) => setReminder(e.target.value)}
            placeholder="07:30"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-[12px] outline-none"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {blockedReason && (
          <span
            className={cx(
              "mr-auto text-[11px]",
              missingDays ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]",
            )}
          >
            {blockedReason}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!canSave}
          title={blockedReason ?? undefined}
        >
          {create.isPending ? "Criando…" : "Criar hábito"}
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
      )}
    >
      {children}
    </button>
  );
}

const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function describeSchedule(s: Schedule): string {
  if (s.type === "daily") return "todo dia";
  if (s.type === "times_per_week") return `${s.n}× por semana`;
  return s.days.map((d) => DAY_NAMES[d]).join(", ");
}

interface Group {
  routineId: string | null;
  title: string;
  habits: HabitWithStats[];
}

/**
 * Agrupa os hábitos de hoje por rotina.
 *
 * `all` entra na conta só para nomear as rotinas: `habitsToday` devolve o
 * `routineId`, não o nome dela.
 */
function groupByRoutine(today: HabitWithStats[], all: { id: string; title: string }[]): Group[] {
  const nameOf = new Map(all.map((h) => [h.id, h.title]));
  const groups = new Map<string, Group>();
  const loose: HabitWithStats[] = [];

  for (const h of today) {
    if (!h.routineId) {
      loose.push(h);
      continue;
    }
    if (!groups.has(h.routineId)) {
      groups.set(h.routineId, {
        routineId: h.routineId,
        title: nameOf.get(h.routineId) ?? "Rotina",
        habits: [],
      });
    }
    groups.get(h.routineId)!.habits.push(h);
  }

  const out = [...groups.values()];
  if (loose.length > 0 || out.length === 0) {
    out.push({ routineId: null, title: "Hoje", habits: loose });
  }
  return out;
}
