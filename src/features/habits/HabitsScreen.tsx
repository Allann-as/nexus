/**
 * Hábitos & Rotinas.
 */

import { useState } from "react";
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
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  cx,
} from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { StreakRing } from "./StreakRing";
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Hábitos"
        subtitle={
          isPending
            ? "Carregando…"
            : today.length === 0
              ? "Nada agendado para hoje"
              : `${today.filter((h) => h.today === "done").length} de ${today.length} hoje`
        }
        actions={
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Novo hábito
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {creating && <CreateForm onDone={() => setCreating(false)} />}

        {all.length === 0 && !isPending && !creating ? (
          <div className="h-[60%]">
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
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.routineId ?? "avulsos"}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
                    {group.title}
                  </h2>
                  {group.routineId && group.habits.length > 0 && (
                    <button
                      onClick={() => routine.mutate(group.routineId!)}
                      disabled={routine.isPending}
                      className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
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
        )}
      </div>

      {openHabit && <HabitDetail id={openHabit} onClose={() => setOpenHabit(null)} />}
    </div>
  );
}

function HabitRow({
  habit,
  busy,
  onToggle,
  onOpen,
}: {
  habit: HabitWithStats;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = habit.today === "done";

  return (
    <div
      className="flex items-center gap-3 px-3 transition-colors hover:bg-[var(--bg-hover)]"
      style={{ minHeight: "var(--row-list)" }}
    >
      <StreakRing
        streak={habit.streaks.current}
        status={habit.today}
        onClick={onToggle}
        disabled={busy}
        title={done ? `Desmarcar ${habit.title}` : `Marcar ${habit.title}`}
      />

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={cx(
            "block truncate text-[13px] transition-colors",
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

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"daily" | "weekdays" | "times_per_week">("daily");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [times, setTimes] = useState(3);
  const [areaId, setAreaId] = useState<string>("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [reminder, setReminder] = useState("");

  const { data: areas = [] } = useQuery({ queryKey: ["areas"], queryFn: () => listAreas(false) });

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
      onDone();
    },
    onError: pushError,
  });

  const submit = () => {
    if (!title.trim() || create.isPending) return;
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

      <div className="mt-4 grid grid-cols-4 gap-2">
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

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!title.trim() || create.isPending}
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
