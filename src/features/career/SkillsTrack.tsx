/**
 * A trilha de competências da Carreira (M4.6, item 6).
 *
 * Uma competência tem um NÍVEL de 1 a 10 que, desde a v1.2, o sistema CALCULA a
 * partir de um CHECK-IN MENSAL (ADR-0037): estudou? aplicou quantas vezes? como
 * avalia a evolução? O cartão convida o check-in do mês corrente enquanto ele
 * não vier — um convite no próprio cartão, nunca uma modal na cara de quem abriu
 * a tela para outra coisa. O nível calculado carrega o "ⓘ como calculamos", como
 * todo número derivado deste app.
 *
 * O "subir de nível" manual é a herança pré-v1.2 e continua vivo APENAS para a
 * competência que nunca teve check-in — nela o nível gravado ainda é a única
 * verdade, e o gesto segue armado em dois cliques. No instante em que o primeiro
 * check-in chega, a conta passa a mandar e o botão manual sai do cartão: dois
 * donos do mesmo número seria a contradição.
 *
 * A trilha de evolução vem da régua calculada (ou da série legada do ledger, na
 * competência sem check-in); com menos de dois pontos NÃO desenha sparkline — o
 * padrão "número real, omitido sem dado" vale para gráfico.
 *
 * A competência também pode ser APAGADA (v1.2): uma trilha criada por engano não
 * é uma trilha, é ruído. Apagar corrige o ESTADO — os níveis que já subiram
 * continuam no ledger e no XP (ADR-0056), porque o passado não se reescreve.
 * Repare que o cartão tem DOIS gestos armados de naturezas opostas: subir de
 * nível é afirmativo e mora no botão largo, embaixo; excluir é destrutivo e mora
 * no rodapé discreto, com a cor de perigo. Eles nunca aparecem armados juntos —
 * ver `SkillCard`.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Plus, ChevronsUp, Check, CalendarCheck } from "lucide-react";

import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Formula } from "../../design-system/Formula";
import { Sparkline } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import {
  createSkill,
  deleteSkill,
  levelUpSkill,
  listSkills,
  skillCheckins,
  skillComputedLevel,
  skillLevelHistory,
  skillTrack,
  type Skill,
} from "../../lib/ipc";
import { SkillCheckinModal } from "./SkillCheckinModal";
import { currentMonth, monthName } from "./skillMonth";

export function SkillsTrack({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");

  const skills = useQuery({
    queryKey: ["skills", areaId],
    queryFn: () => listSkills(areaId),
  });

  const create = async () => {
    if (!title.trim()) return;
    try {
      await createSkill({
        title: title.trim(),
        areaId,
        category: category.trim() || null,
      });
      push("success", "Competência criada");
      setTitle("");
      setCategory("");
      setCreating(false);
      void client.invalidateQueries({ queryKey: ["skills", areaId] });
    } catch (e) {
      pushError(e);
    }
  };

  const items = skills.data ?? [];

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Competências</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            Um check-in por mês — estudou, aplicou, evoluiu. O nível de 1 a 10 sai daí.
          </p>
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
          Nova
        </Button>
      </header>

      {creating && (
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Competência (ex.: System Design)…"
            className="h-9 min-w-[220px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Categoria (opcional)"
            className="h-9 w-[180px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={create} disabled={!title.trim()}>
            Criar
          </Button>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={Award}
          title="Nenhuma competência ainda"
          hint="Uma competência é uma capacidade que você desenvolve — System Design, inglês, liderança. Um check-in por mês responde três perguntas, e o nível de 1 a 10 vem delas."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Nova competência
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <SkillCard key={s.id} skill={s} areaId={areaId} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, areaId }: { skill: Skill; areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [armed, setArmed] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const armedTimer = useRef<number | null>(null);

  const checkins = useQuery({
    queryKey: ["skill-checkins", skill.id],
    queryFn: () => skillCheckins(skill.id),
  });
  const hasCheckins = (checkins.data?.length ?? 0) > 0;

  // As três consultas do nível calculado só existem para quem TEM check-in.
  // Numa competência legada elas voltariam vazias — não vale a viagem.
  const computed = useQuery({
    queryKey: ["skill-level", skill.id],
    queryFn: () => skillComputedLevel(skill.id),
    enabled: hasCheckins,
  });
  const history = useQuery({
    queryKey: ["skill-level-history", skill.id],
    queryFn: () => skillLevelHistory(skill.id),
    enabled: hasCheckins,
  });
  // A trilha legada (níveis subidos no clique) só desenha para quem nunca fez
  // check-in; a partir do primeiro, a régua calculada é a história verdadeira.
  const track = useQuery({
    queryKey: ["skill-track", skill.id],
    queryFn: () => skillTrack(skill.id),
    enabled: checkins.isSuccess && !hasCheckins,
  });

  const levelUp = useMutation({
    mutationFn: () => levelUpSkill(skill.id),
    onSuccess: () => {
      setArmed(false);
      void client.invalidateQueries({ queryKey: ["skills", areaId] });
      void client.invalidateQueries({ queryKey: ["skill-track", skill.id] });
      // O nível novo é XP novo (ADR-0045): o Hub e a gamificação recomputam.
      void client.invalidateQueries({ queryKey: ["gamification"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
    },
    onError: (e) => {
      setArmed(false);
      pushError(e);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteSkill(skill.id),
    onSuccess: () => {
      push("success", "Competência excluída");
      void client.invalidateQueries({ queryKey: ["skills", areaId] });
      void client.invalidateQueries({ queryKey: ["skill-track", skill.id] });
      // Some do painel de "em evolução" junto com o cartão — senão o número
      // continua contando uma trilha que não existe mais.
      void client.invalidateQueries({ queryKey: ["skills-evolving", areaId] });
      // O XP dos níveis fica no ledger, mas o Hub relê o que ainda tem estado.
      void client.invalidateQueries({ queryKey: ["gamification"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
    },
    onError: pushError,
  });

  // A confirmação leve: o primeiro clique arma; se o segundo não vem em 3.5s, desarma.
  useEffect(() => {
    if (!armed) return;
    armedTimer.current = window.setTimeout(() => setArmed(false), 3500);
    return () => {
      if (armedTimer.current) window.clearTimeout(armedTimer.current);
    };
  }, [armed]);

  const atMax = skill.maxLevel != null && skill.level >= skill.maxLevel;

  // A REGRA da v1.2: o nível calculado manda; o gravado só existe enquanto não
  // houver check-in nenhum. `null` é "ainda não perguntamos" — nunca um 1 inventado.
  const showsComputed = skill.computedLevel != null;
  const shownLevel = skill.computedLevel ?? skill.level;
  const scale = showsComputed ? "/ 10" : skill.maxLevel != null ? `/ ${skill.maxLevel}` : "nível";

  // A série vem da régua calculada quando ela existe; da trilha legada quando não.
  // Menos de dois pontos: sem gráfico (o padrão "número real, omitido sem dado").
  const levels = showsComputed
    ? (history.data ?? []).map((p) => p.level)
    : (track.data ?? []).map((p) => p.level);
  const series = levels.length >= 2 ? normalize(levels) : null;

  const month = currentMonth();
  const monthDone = (checkins.data ?? []).some((c) => c.month === month);
  // O convite só aparece quando já sabemos a resposta — piscar "pendente" durante
  // o carregamento seria cobrar do usuário uma coisa que talvez ele já tenha feito.
  const monthPending = checkins.isSuccess && !monthDone;

  const onLevelUp = () => {
    if (atMax || levelUp.isPending) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    levelUp.mutate();
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
          <Award size={16} style={{ color: "var(--sphere)" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-[var(--text-primary)]">
            {skill.title}
          </p>
          {skill.category && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">
              {skill.category}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[26px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
            {shownLevel}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)]">{scale}</span>
        </div>
        {series && (
          <Sparkline data={series} width={84} height={28} className="shrink-0" />
        )}
      </div>

      {showsComputed ? (
        <LevelPips level={shownLevel} max={10} />
      ) : (
        skill.maxLevel != null && <LevelPips level={skill.level} max={skill.maxLevel} />
      )}

      {/* O convite do mês: um chamado claro no cartão, nunca uma modal que
          atravessa a frente do app. Quem já fez o check-in do mês vê só a
          confirmação discreta — e o caminho para corrigir, se errou. */}
      <button
        onClick={() => setCheckinOpen(true)}
        className={cx(
          "flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[12.5px] font-medium",
          "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
          "border",
          monthPending
            ? "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] text-[var(--sphere)] hover:bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)]"
            : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
        )}
      >
        {monthPending ? (
          <>
            <CalendarCheck size={14} strokeWidth={2.2} />
            Check-in de {monthName(month)} pendente
          </>
        ) : monthDone ? (
          <>
            <Check size={14} strokeWidth={2.4} />
            Check-in de {monthName(month)} feito · corrigir
          </>
        ) : (
          <>
            <CalendarCheck size={14} strokeWidth={2.2} />
            Check-in mensal
          </>
        )}
      </button>

      {/* O nível é derivado: ele DEVE saber explicar-se (§2, zero IA). */}
      {computed.data && <Formula>{computed.data.formula}</Formula>}

      {/* O "subir de nível" manual é a herança pré-v1.2. Enquanto não há
          check-in, ele ainda é o único jeito de a competência andar — e segue
          armado em dois cliques. Assim que o primeiro check-in chega, o nível
          passa a ser calculado e um +1 na mão contradiria a conta: o botão sai. */}
      {!hasCheckins && checkins.isSuccess && (
        <button
          onClick={onLevelUp}
          disabled={atMax || levelUp.isPending}
          className={cx(
            "flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[12.5px] font-medium",
            "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
            "border",
            atMax
              ? "cursor-default border-transparent bg-[var(--bg-raised)] text-[var(--text-tertiary)]"
              : armed
                ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
          )}
        >
          {atMax ? (
            "Nível máximo"
          ) : armed ? (
            <>
              <Check size={14} strokeWidth={2.4} />
              Confirmar · nível {skill.level} → {skill.level + 1}
            </>
          ) : (
            <>
              <ChevronsUp size={14} strokeWidth={2.2} />
              Subir de nível (manual)
            </>
          )}
        </button>
      )}

      {hasCheckins && (
        <p className="text-[11px] leading-[15px] text-[var(--text-tertiary)]">
          O nível agora vem dos check-ins — por isso o "subir de nível" manual saiu daqui.
        </p>
      )}

      {/* O rodapé destrutivo. Ele mora FORA do botão de nível, atrás de uma
          hairline, e usa a cor de perigo — nada nele parece um passo adiante.
          Enquanto o nível está armado, o rodapé fica invisível e sem cliques:
          duas perguntas armadas ao mesmo tempo no mesmo cartão seriam a receita
          para o "sim" errado. (O caminho inverso já é seguro: o mousedown no
          botão de nível cai fora do ArmedDelete e o desarma sozinho.) */}
      <div
        className={cx(
          "flex justify-end border-t border-[var(--border-subtle)] pt-2",
          armed && "invisible pointer-events-none",
        )}
      >
        <ArmedDelete
          onConfirm={() => remove.mutate()}
          pending={remove.isPending}
          question="Excluir esta competência?"
          ariaLabel={`Excluir a competência ${skill.title}`}
        />
      </div>

      {checkinOpen && (
        <SkillCheckinModal
          skill={skill}
          areaId={areaId}
          onClose={() => setCheckinOpen(false)}
        />
      )}
    </Card>
  );
}

/** Uma fileira de pontos para competências com teto: cheios até o nível atual. */
function LevelPips({ level, max }: { level: number; max: number }) {
  // Um teto muito alto viraria uma parede de pontos; acima de 10 o número já basta.
  if (max > 10) return null;
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className="h-1.5 flex-1 rounded-full"
          style={{
            background:
              i < level
                ? "var(--sphere)"
                : "color-mix(in srgb, var(--sphere) 16%, transparent)",
          }}
        />
      ))}
    </div>
  );
}

/** Normaliza a série de níveis para 0..1 pelo mínimo e máximo — a forma da subida. */
function normalize(levels: number[]): number[] {
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  if (max === min) return levels.map(() => 0.5);
  return levels.map((l) => (l - min) / (max - min));
}
