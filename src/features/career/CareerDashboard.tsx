/**
 * O painel da Carreira — vocabulário COCKPIT (v1.3).
 *
 * O que ele responde continua o mesmo (tempo no cargo, marcos do ano,
 * competências em evolução, próxima meta, e a linha do tempo de cargos com a
 * DURAÇÃO de cada fase). O que mudou:
 *
 * - **O `<h2>Carreira</h2>` saiu.** Ele repetia, um centímetro abaixo, o nome que
 *   o cabeçalho da Esfera já diz em corpo 32. Dois títulos iguais empilhados não
 *   são hierarquia, são ruído.
 * - **O `PanelTile` local virou `StatTile`.** Não havia razão para a Carreira ter
 *   um tile só dela: o app inteiro muda junto quando o tile muda (a alavanca da
 *   §1 do plano), e um componente por tela desfaz exatamente isso.
 * - **O vazio abaixo da linha do tempo virou as COMPETÊNCIAS.** Um painel de
 *   carreira que termina em três marcos e meia tela preta não é denso, é
 *   inacabado. A lista compacta de competências com o nível calculado é o dado
 *   mais vivo desta Esfera (é o que muda todo mês) e não duplica a aba
 *   Habilidades: lá se faz o check-in, aqui se vê onde tudo está.
 *
 * O `seg` de cada tile é uma fração REAL ou não existe: "marcos no ano" sobre o
 * total de marcos, "em evolução" sobre o total de competências. "Tempo no cargo"
 * e "próxima meta" não ganham medidor porque não têm denominador — uma barra ali
 * seria um enfeite fingindo proporção (lição 1).
 *
 * Um marco também pode ser apagado (v1.2). Aqui a exclusão é de um tipo raro:
 * o marco não tem linha de estado nenhuma — ele É um fato do ledger. Então
 * "excluir" não remove nada: acrescenta um evento de RETRATAÇÃO, e é a leitura
 * do ledger que passa a ignorar o marco retratado (ADR-0056). O passado fica
 * inteiro; só a linha da carreira se corrige.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Briefcase, CalendarClock, Plus, Target, TrendingUp } from "lucide-react";

import { StatTile } from "../../design-system/cards";
import { MonoLabel, StatusList, type StatusRow } from "../../design-system/instruments";
import { Button, EmptyState, cx } from "../../design-system/primitives";
import { ArmedDelete } from "../../design-system/ArmedDelete";
import { useToasts } from "../../stores/toasts";
import {
  careerMilestones,
  deleteCareerMilestone,
  listGoals,
  listSkills,
  skillsEvolving,
  type CareerMilestoneKind,
  type LedgerEntry,
} from "../../lib/ipc";
import { CAREER_KIND_META } from "./careerKinds";
import { RecordMilestoneModal } from "./RecordMilestoneModal";

const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** '2026-07-12' → '12 de jul de 2026'. */
function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)} de ${MONTHS[Number(m) - 1] ?? m} de ${y}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** O dia LOCAL de hoje como 'YYYY-MM-DD' — a mesma convenção do backend. */
function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** Dias entre dois 'YYYY-MM-DD' (UTC para não tropeçar em horário de verão). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Uma duração em dias, em português curto: "2 anos 3 meses", "5 meses", "12 dias". */
function humanize(days: number): string {
  if (days <= 0) return "hoje";
  if (days < 45) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(days / 365.25);
  const rem = Math.floor((days - years * 365.25) / 30.44);
  const y = `${years} ${years === 1 ? "ano" : "anos"}`;
  return rem > 0 ? `${y} ${rem} ${rem === 1 ? "mês" : "meses"}` : y;
}

interface Milestone {
  entry: LedgerEntry;
  kind: CareerMilestoneKind;
  note: string | null;
}

function parseMilestone(entry: LedgerEntry): Milestone {
  let kind: CareerMilestoneKind = "other";
  let note: string | null = null;
  try {
    const p = JSON.parse(entry.payload) as { kind?: string; note?: string | null };
    if (p.kind && p.kind in CAREER_KIND_META) kind = p.kind as CareerMilestoneKind;
    note = p.note ?? null;
  } catch {
    // Um payload ilegível não pode derrubar o painel; cai no marco genérico.
  }
  return { entry, kind, note };
}

export function CareerDashboard({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const [recording, setRecording] = useState(false);

  const milestonesQ = useQuery({
    queryKey: ["career", "milestones"],
    queryFn: careerMilestones,
  });
  const evolvingQ = useQuery({
    queryKey: ["skills-evolving", areaId],
    queryFn: () => skillsEvolving(areaId),
  });
  const goalsQ = useQuery({
    queryKey: ["goals", areaId],
    queryFn: () => listGoals(areaId),
  });
  // O total de competências é o DENOMINADOR de "em evolução" e a matéria da
  // lista de baixo. Sem ele, "3 em evolução" não diz se é muito ou pouco.
  const skillsQ = useQuery({
    queryKey: ["skills", areaId],
    queryFn: () => listSkills(areaId),
  });

  // Os marcos vêm do mais recente ao mais antigo (o ledger por entity_kind).
  const milestones = useMemo(
    () => (milestonesQ.data ?? []).map(parseMilestone),
    [milestonesQ.data],
  );
  const latest = milestones[0];
  const today = todayLocal();
  const year = today.slice(0, 4);

  // Próxima meta: a de prazo mais próximo AINDA no futuro.
  const nextGoal = useMemo(() => {
    const now = Date.now();
    return (goalsQ.data ?? [])
      .filter((g) => g.deadline != null && g.deadline > now)
      .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0))[0];
  }, [goalsQ.data]);

  const marcosNoAno = milestones.filter((m) => m.entry.day.startsWith(year)).length;
  const evolving = evolvingQ.data ?? [];
  const skills = skillsQ.data ?? [];

  /*
   * As competências como linhas de status: nível à direita, a SegBar do próprio
   * nível sob o rótulo. A ordem é do maior para o menor nível — ordenar é
   * arrumar, não afirmar; em lugar nenhum daqui sai uma frase do tipo "a sua
   * melhor competência é X", que um empate ou uma amostra de duas tornaria
   * falsa (lição 3 / ADR-0079).
   */
  const skillRows: StatusRow[] = useMemo(
    () =>
      [...skills]
        .sort((a, b) => (b.computedLevel ?? -1) - (a.computedLevel ?? -1))
        .map((s) => {
          const nivel = s.computedLevel;
          return {
            id: s.id,
            icon: Award,
            label: s.title,
            sub: s.category ?? undefined,
            // Sem check-in não há nível calculado — e o gravado não é a mesma
            // coisa. Dizer o que falta é mais útil que exibir um número de outra
            // régua como se fosse deste.
            value: nivel != null ? `${nivel}/10` : "sem check-in",
            tone: nivel != null ? ("sphere" as const) : ("muted" as const),
            progress: nivel != null ? (nivel - 1) / 9 : undefined,
          };
        }),
    [skills],
  );

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["career"] });
    void client.invalidateQueries({ queryKey: ["ledger"] });
    setRecording(false);
  };

  return (
    <div className="nx-enter flex flex-col gap-5">
      {!latest && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
          <EmptyState
            icon={Award}
            title="Sua história profissional começa aqui"
            hint="Registre promoções, certificações e conquistas — elas ficam para sempre na Timeline, e a linha do tempo mostra quanto durou cada fase."
            action={
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)}>
                Registrar marco
              </Button>
            }
          />
        </div>
      )}

      {/* ===== O painel: só os tiles com dado real ===== */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {latest && (
          <StatTile
            icon={Briefcase}
            label="No marco atual"
            value={humanize(daysBetween(latest.entry.day, today))}
            hint={latest.entry.titleSnapshot}
          />
        )}
        {milestones.length > 0 && (
          <StatTile
            icon={Award}
            label={`Marcos em ${year}`}
            value={marcosNoAno}
            hint={`${milestones.length} no total`}
          />
        )}
        {evolving.length > 0 && (
          <StatTile
            icon={TrendingUp}
            label="Em evolução (90d)"
            value={evolving.length}
            hint={evolving.slice(0, 2).map((s) => s.title).join(", ")}
            seg={skills.length > 0 ? evolving.length / skills.length : undefined}
          />
        )}
        {nextGoal && (
          <StatTile
            icon={Target}
            label="Próxima meta"
            value={humanize(daysBetween(today, isoDay(nextGoal.deadline!)))}
            hint={nextGoal.title}
          />
        )}
      </div>

      {/* ===== A linha do tempo de cargos, com duração de cada fase ===== */}
      {milestones.length > 0 && (
        <section>
          {/* "Registrar marco" mora AQUI, no cabeçalho da linha do tempo a que
              ele acrescenta. Numa linha só dele, depois que o `<h2>` saiu, o
              botão ficava flutuando num vazio sem nada a que pertencer. */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <MonoLabel>Linha da carreira</MonoLabel>
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => setRecording(true)}>
              Registrar marco
            </Button>
          </div>
          <ol className="relative ml-2 border-l border-[var(--border-subtle)]">
            {milestones.map((m, i) => {
              // A fase deste marco durou dele até o PRÓXIMO mais recente (o de
              // índice i-1); o mais recente de todos corre até hoje ("atual").
              const isCurrent = i === 0;
              const spanDays = isCurrent
                ? daysBetween(m.entry.day, today)
                : daysBetween(m.entry.day, milestones[i - 1].entry.day);
              const Icon = CAREER_KIND_META[m.kind].icon;
              return (
                <li key={m.entry.seq} className="relative py-3 pl-6">
                  <span
                    className={cx(
                      "absolute -left-[13px] top-3.5 grid size-6 place-items-center rounded-full text-[var(--sphere)]",
                      isCurrent
                        ? "bg-[color-mix(in_srgb,var(--sphere)_18%,var(--bg-surface))] ring-2 ring-[color-mix(in_srgb,var(--sphere)_55%,transparent)]"
                        : "bg-[var(--bg-surface)] ring-1 ring-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
                    )}
                    aria-hidden
                  >
                    <Icon size={12} />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">
                      {m.entry.titleSnapshot}
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      {formatDay(m.entry.day)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-[var(--sphere)]">
                      {CAREER_KIND_META[m.kind].label}
                    </span>
                    <span
                      className={cx(
                        "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                        isCurrent
                          ? "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--sphere)]"
                          : "border-[var(--border-subtle)] text-[var(--text-tertiary)]",
                      )}
                    >
                      <CalendarClock size={10} />
                      {isCurrent ? `atual · há ${humanize(spanDays)}` : `durou ${humanize(spanDays)}`}
                    </span>
                    <MilestoneDelete entry={m.entry} />
                  </div>
                  {m.note && (
                    <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--text-secondary)]">
                      {m.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ===== As competências, compactas — onde tudo está agora ===== */}
      {skillRows.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <MonoLabel>Competências</MonoLabel>
            <span className="tabular text-[11px] text-[var(--text-tertiary)]">
              {skills.length} {skills.length === 1 ? "trilha" : "trilhas"}
            </span>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1">
            <StatusList rows={skillRows} />
          </div>
        </section>
      )}

      {recording && <RecordMilestoneModal onClose={() => setRecording(false)} onSaved={refresh} />}
    </div>
  );
}

/**
 * O gesto de retratar um marco, ao lado da duração da fase.
 *
 * As chaves invalidadas são as mesmas que `refresh` usa depois de registrar um
 * marco — ["career"] redesenha a linha e os tiles, ["ledger"] redesenha a
 * Timeline, que é onde o evento de correção também aparece.
 */
function MilestoneDelete({ entry }: { entry: LedgerEntry }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const remove = useMutation({
    mutationFn: () => deleteCareerMilestone(entry.entityId),
    onSuccess: () => {
      push("success", "Marco excluído");
      void client.invalidateQueries({ queryKey: ["career"] });
      void client.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: pushError,
  });

  return (
    <ArmedDelete
      className="ml-auto"
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      question="Excluir este marco?"
      ariaLabel={`Excluir o marco ${entry.titleSnapshot}`}
    />
  );
}

/** '2026-07-12' de um epoch-ms LOCAL — para a meta com prazo (o deadline é ms). */
function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
