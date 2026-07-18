/**
 * A Revisão Semanal (M5) — o ritual de 6 passos.
 *
 * Dois cuidados guiam a tela:
 *
 * 1. É RETOMÁVEL. O passo e o texto da reflexão vêm do backend (rascunho em
 *    disco). Fechar no passo 3 e voltar reabre no passo 3. O evento só é gravado
 *    no ÚLTIMO passo — quem sai no meio não deixa fato nenhum.
 * 2. Os números dos hábitos são REAIS (agendados × cumpridos na semana), e o
 *    "porquê" vem das correlações dos insights de verdade. Sem correlação, a
 *    linha diz "sem padrão detectável" — nunca inventa narrativa.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Flag,
  Inbox as InboxIcon,
  ListTodo,
  Repeat,
  Sparkles,
} from "lucide-react";

import {
  completeWeeklyReview,
  eventsRange,
  getInsights,
  listGoals,
  saveWeeklyReviewProgress,
  weeklyReviewHabits,
  weeklyReviewState,
  type HabitWeek,
  type Insights,
} from "../../lib/ipc";
import { Button, Card, PageHeader } from "../../design-system/primitives";
import { ProgressBar } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";

const TOTAL = 6;

export function WeeklyReviewScreen() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const state = useQuery({ queryKey: ["weekly-review"], queryFn: weeklyReviewState });

  const [step, setStep] = useState(1);
  const [reflection, setReflection] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Abre no passo em que o rascunho parou (retomável).
  useEffect(() => {
    if (state.data && !hydrated) {
      setStep(Math.min(Math.max(state.data.step, 1), TOTAL));
      setReflection(state.data.reflection);
      setHydrated(true);
    }
  }, [state.data, hydrated]);

  const save = useMutation({
    mutationFn: (v: { step: number; reflection: string }) =>
      saveWeeklyReviewProgress(v.step, v.reflection),
  });

  const complete = useMutation({
    mutationFn: () => completeWeeklyReview(reflection),
    onSuccess: () => {
      push("success", "Revisão da semana concluída");
      qc.invalidateQueries({ queryKey: ["weekly-review"] });
      qc.invalidateQueries({ queryKey: ["gamification"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      setHydrated(false); // relê o estado (agora completedThisWeek)
    },
    onError: pushError,
  });

  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), TOTAL);
    setStep(clamped);
    save.mutate({ step: clamped, reflection });
  };

  if (state.data?.completedThisWeek && state.data.step === 0) {
    return <ReviewedState weekStart={state.data.weekStart} weekEnd={state.data.weekEnd} />;
  }

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-8 pt-8 pb-16">
        <PageHeader
          title="Revisão Semanal"
          subtitle={
            state.data
              ? `A semana de ${fmt(state.data.weekStart)} a ${fmt(state.data.weekEnd)}`
              : "…"
          }
        />

        {/* Barra de progresso do ritual */}
        <div className="mt-2 mb-6 flex items-center gap-3">
          <ProgressBar value={step / TOTAL} height={6} color="var(--accent)" className="flex-1" />
          <span className="tabular shrink-0 text-[12px] text-[var(--text-tertiary)]">
            Passo {step} de {TOTAL}
          </span>
        </div>

        <div key={step} className="nx-section-enter">
          <StepBody step={step} reflection={reflection} setReflection={setReflection} />
        </div>

        {/* Navegação */}
        <div className="mt-8 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            disabled={step === 1}
            onClick={() => go(step - 1)}
          >
            Voltar
          </Button>
          {step < TOTAL ? (
            <Button variant="primary" size="sm" onClick={() => go(step + 1)}>
              Avançar
              <ArrowRight size={15} />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={CheckCircle2}
              disabled={complete.isPending}
              onClick={() => complete.mutate()}
            >
              {complete.isPending ? "Concluindo…" : "Concluir revisão"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBody({
  step,
  reflection,
  setReflection,
}: {
  step: number;
  reflection: string;
  setReflection: (v: string) => void;
}) {
  switch (step) {
    case 1:
      return <InboxStep />;
    case 2:
      return <TasksStep />;
    case 3:
      return <HabitsStep />;
    case 4:
      return <GoalsStep />;
    case 5:
      return <AgendaStep />;
    default:
      return <ReflectionStep reflection={reflection} setReflection={setReflection} />;
  }
}

/* ===== Passo 1 — triagem do inbox ===== */
function InboxStep() {
  const navigate = useNavigate();
  return (
    <StepCard
      icon={InboxIcon}
      title="Esvazie a caixa de entrada"
      lead="Toda captura solta vira uma tarefa, uma nota ou some. Comece a semana com o inbox no zero."
    >
      <Button variant="secondary" size="sm" onClick={() => navigate("/inbox")}>
        Abrir o Inbox
      </Button>
    </StepCard>
  );
}

/* ===== Passo 2 — tarefas em aberto ===== */
function TasksStep() {
  const navigate = useNavigate();
  return (
    <StepCard
      icon={ListTodo}
      title="Amarre as pontas soltas"
      lead="O que ficou aberto? Conclua, reagende ou solte de vez. Uma tarefa que atravessa semanas sem se mexer virou culpa, não plano."
    >
      <Button variant="secondary" size="sm" onClick={() => navigate("/projects")}>
        Ver projetos e tarefas
      </Button>
    </StepCard>
  );
}

/* ===== Passo 3 — hábitos da semana (o coração honesto) ===== */
function HabitsStep() {
  const habits = useQuery({ queryKey: ["weekly-review", "habits"], queryFn: weeklyReviewHabits });
  const insights = useQuery({ queryKey: ["insights", "cache"], queryFn: getInsights });

  return (
    <StepCard
      icon={Repeat}
      title="Seus hábitos, sem maquiagem"
      lead="O que a semana mostra — não o que você gostaria que ela mostrasse. Os porquês vêm das correlações reais; onde não há padrão, a linha diz isso."
    >
      {habits.isPending ? (
        <div className="h-24 animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-base)]" />
      ) : (habits.data ?? []).length === 0 ? (
        <p className="text-[13px] text-[var(--text-tertiary)]">
          Nenhum hábito ativo ainda. Quando houver, a semana deles aparece aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {(habits.data ?? []).map((h) => (
            <HabitRow key={h.habitId} habit={h} insights={insights.data ?? null} />
          ))}
        </ul>
      )}
    </StepCard>
  );
}

function HabitRow({ habit, insights }: { habit: HabitWeek; insights: Insights | null }) {
  const why = useMemo(() => {
    const c = insights?.correlations.find(
      (x) => x.habitA.id === habit.habitId || x.habitB.id === habit.habitId,
    );
    return c?.sentence ?? null;
  }, [insights, habit.habitId]);

  const ratio = habit.scheduled > 0 ? habit.done / habit.scheduled : 0;

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
          {habit.title}
        </span>
        <span className="tabular shrink-0 text-[12px] text-[var(--text-secondary)]">
          {habit.scheduled > 0 ? `${habit.done} de ${habit.scheduled} dias` : "sem agenda esta semana"}
        </span>
      </div>
      {habit.scheduled > 0 && (
        <div className="mt-2">
          <ProgressBar value={ratio} height={5} color={ratio >= 0.7 ? "var(--success)" : "var(--warning)"} />
        </div>
      )}
      <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">
        {why ?? "Sem padrão estatístico detectável ainda."}
      </p>
    </li>
  );
}

/* ===== Passo 4 — metas ===== */
function GoalsStep() {
  const navigate = useNavigate();
  const goals = useQuery({ queryKey: ["goals", "all"], queryFn: () => listGoals(null) });
  const count = goals.data?.length ?? 0;

  return (
    <StepCard
      icon={Flag}
      title="Suas metas ainda são suas?"
      lead="Passe o olho no que você disse que queria. Registrar um novo ponto de progresso, ou soltar o que já não faz sentido, é o trabalho aqui."
    >
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        {count > 0 ? `${count} meta(s) em aberto.` : "Nenhuma meta em aberto agora."}
      </p>
      <Button variant="secondary" size="sm" onClick={() => navigate("/goals")}>
        Abrir metas
      </Button>
    </StepCard>
  );
}

/* ===== Passo 5 — a semana que vem ===== */
function AgendaStep() {
  const navigate = useNavigate();
  const range = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    const dow = (today.getDay() + 6) % 7; // 0 = segunda
    monday.setDate(today.getDate() - dow + 7); // segunda da PRÓXIMA semana
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { from: iso(monday), to: iso(sunday) };
  }, []);
  const events = useQuery({
    queryKey: ["events", "next-week", range.from],
    queryFn: () => eventsRange(range.from, range.to),
  });
  const count = events.data?.length ?? 0;

  return (
    <StepCard
      icon={CalendarClock}
      title="O que a próxima semana já pede"
      lead="Olhe a agenda antes que ela chegue. Bloqueie o tempo do que importa agora, com a semana ainda em branco."
    >
      <p className="mb-3 text-[12.5px] text-[var(--text-secondary)]">
        {count > 0
          ? `${count} compromisso(s) já marcado(s) para a semana que vem.`
          : "A próxima semana ainda está livre."}
      </p>
      <Button variant="secondary" size="sm" onClick={() => navigate("/calendar")}>
        Abrir o calendário
      </Button>
    </StepCard>
  );
}

/* ===== Passo 6 — reflexão ===== */
function ReflectionStep({
  reflection,
  setReflection,
}: {
  reflection: string;
  setReflection: (v: string) => void;
}) {
  return (
    <StepCard
      icon={Sparkles}
      title="Uma frase sobre a semana"
      lead="Não precisa ser bonito. O que funcionou, o que pesou, o que você leva para a próxima. Fica na história — daqui a um ano, é isto que você relê."
    >
      <textarea
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        rows={4}
        data-selectable
        placeholder="Nesta semana…"
        className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] leading-[20px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <p className="mt-2 text-[11.5px] text-[var(--text-tertiary)]">
        Ao concluir, a semana entra na sua Timeline como revisada.
      </p>
    </StepCard>
  );
}

/* ===== estado "já revisada" ===== */
function ReviewedState({ weekStart, weekEnd }: { weekStart: string; weekEnd: string }) {
  const navigate = useNavigate();
  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[560px] flex-col items-center px-8 pt-24 text-center">
        <span
          className="grid size-16 place-items-center rounded-full"
          style={{ background: "color-mix(in srgb, var(--success) 16%, transparent)" }}
        >
          <CheckCircle2 size={30} className="text-[var(--success)]" />
        </span>
        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          Semana revisada
        </h1>
        <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
          Você já fez a revisão da semana de {fmt(weekStart)} a {fmt(weekEnd)}. Uma revisão por
          semana — volte no domingo que vem.
        </p>
        <div className="mt-6 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate("/timeline")}>
            Ver na Timeline
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            Voltar ao Hub
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ===== helpers ===== */
function StepCard({
  icon: Icon,
  title,
  lead,
  children,
}: {
  icon: typeof InboxIcon;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3.5">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)]"
          style={{ background: "color-mix(in srgb, var(--accent) 14%, transparent)" }}
        >
          <Icon size={19} className="text-[var(--accent)]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            {title}
          </h2>
          <p className="mt-1 text-[13px] leading-[20px] text-[var(--text-secondary)]">{lead}</p>
        </div>
      </div>
      <div className="mt-4 pl-[54px]">{children}</div>
    </Card>
  );
}

function fmt(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
