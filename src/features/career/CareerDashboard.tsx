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
 * - **A linha do tempo saiu para a aba MARCOS** (ADR-0089). O que ficou aqui é o
 *   RESUMO dela: "No marco atual" (há quanto tempo dura a fase corrente) e
 *   "Marcos em {ano}". Resumo no painel, história na aba — a mesma lista não se
 *   desenha em dois lugares.
 *
 * O `seg` de um tile é uma fração REAL de algo que importa, ou não existe. "Em
 * evolução" sobre o total de competências passa; "marcos no ano" sobre o total de
 * marcos foi REPROVADO (ADR-0088) — a fração era verdadeira e ninguém faz aquela
 * pergunta. "Tempo no cargo" e "próxima meta" não têm denominador nenhum.
 */

import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Briefcase, FolderKanban, Plus, Target, TrendingUp } from "lucide-react";

import { StatTile } from "../../design-system/cards";
import { MonoLabel, StatusList, type StatusRow } from "../../design-system/instruments";
import { Button, EmptyState } from "../../design-system/primitives";
import {
  careerMilestones,
  listGoals,
  listNodes,
  listSkills,
  projectProgress,
  skillsEvolving,
} from "../../lib/ipc";
import { RecordMilestoneModal } from "./RecordMilestoneModal";
import { daysBetween, humanize, isoDay, parseMilestone, todayLocal } from "./careerTime";

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

      {/* ===== Os projetos ativos, com o quanto cada um andou ===== */}
      <ProjetosAtivos areaId={areaId} />

      {recording && <RecordMilestoneModal onClose={() => setRecording(false)} onSaved={refresh} />}
    </div>
  );
}

/**
 * Os projetos ativos da Esfera, com o quanto cada um andou.
 *
 * Por que isto é DADO e não enchimento: "o que estou tocando agora e quanto
 * falta" é uma pergunta que um painel de carreira tem que responder, e ela não
 * estava respondida em lugar nenhum do Painel — só dentro da aba Projetos, um
 * clique adiante. Aqui é o RESUMO (nome + barra); lá é o trabalho (checklist,
 * evolução, meta ligada). A mesma divisão de "resumo no painel, história na aba"
 * que os Marcos ganharam no ADR-0089.
 *
 * A barra é a CONTAGEM de tarefas, com a mesma regra do cartão: projeto sem
 * tarefa não ganha barra, porque 0 de 0 não é 0% — é "ainda não há o que medir"
 * (ADR-0087). Ele aparece na lista assim mesmo, escrito "sem tarefas": existir e
 * não estar decomposto É uma informação, e escondê-lo faria o painel mentir por
 * omissão sobre quantos projetos estão abertos.
 */
function ProjetosAtivos({ areaId }: { areaId: string }) {
  const projetos = useQuery({
    queryKey: ["nodes", "project", areaId],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 50 }),
  });
  const items = projetos.data ?? [];

  // Uma consulta de progresso por projeto. `useQueries` porque o `StatusList`
  // recebe uma lista PRONTA — não há como cada linha buscar a sua.
  const progressos = useQueries({
    queries: items.map((p) => ({
      queryKey: ["project-progress", p.id],
      queryFn: () => projectProgress(p.id),
    })),
  });

  // Enquanto não se sabe, não se diz: um "nenhum projeto ativo" piscando durante
  // o carregamento é uma afirmação falsa sobre a vida de quem tem projetos.
  if (projetos.isLoading) return null;

  if (items.length === 0) {
    return (
      <section>
        <MonoLabel className="mb-2 block">Projetos</MonoLabel>
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-5 text-center">
          <p className="text-[12.5px] leading-[18px] text-[var(--text-tertiary)]">
            Nenhum projeto ativo. Uma migração, um lançamento, uma iniciativa que você lidera — eles
            moram na aba Projetos.
          </p>
        </div>
      </section>
    );
  }

  const rows: StatusRow[] = items.map((p, i) => {
    const prog = progressos[i]?.data;
    const total = prog?.total ?? 0;
    const done = prog?.done ?? 0;
    return {
      id: p.id,
      icon: FolderKanban,
      label: p.title,
      value: total > 0 ? `${done}/${total}` : "sem tarefas",
      tone: total > 0 ? ("sphere" as const) : ("muted" as const),
      progress: total > 0 ? done / total : undefined,
    };
  });

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <MonoLabel>Projetos</MonoLabel>
        <span className="tabular text-[11px] text-[var(--text-tertiary)]">
          {items.length} {items.length === 1 ? "ativo" : "ativos"}
        </span>
      </div>
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1">
        <StatusList rows={rows} />
      </div>
    </section>
  );
}
