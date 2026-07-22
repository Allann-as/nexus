/**
 * A trilha de competências da Carreira — HABILIDADES 2.0 no idioma COCKPIT (v1.3).
 *
 * A MECÂNICA não mudou e não devia mudar: uma competência tem um nível de 1 a 10
 * que o sistema CALCULA a partir de um check-in mensal (ADR-0037) — estudou?
 * aplicou quantas vezes? como avalia a evolução? O motor, a fórmula com decaimento
 * de 12 meses e o ledger vieram prontos da v1.2 e continuam inteiros.
 *
 * O que mudou aqui é o VOCABULÁRIO (o mesmo passe que Saúde e Finanças levaram) e
 * uma correção de honestidade que o gate não pegava:
 *
 * **A régua era um gráfico que enganava.** A série de níveis era passada por um
 * `normalize()` que a esticava do MÍNIMO ao MÁXIMO dela mesma. Uma competência que
 * andou de 3 para 4 desenhava exatamente a mesma subida triunfal de uma que foi de
 * 1 a 10 — a forma era real, a ESCALA era inventada, e a escala é o que a pessoa lê.
 * Agora o nível entra na régua na escala FIXA de 1 a 10 (`(nível−1)/9`): nível 3 é
 * um terço da altura, e uma subida pequena PARECE pequena. É a lição 1 da fase 4
 * aplicada a um gráfico que já estava no app.
 *
 * O corolário incômodo: a competência LEGADA sem teto (`maxLevel = null`) perdeu o
 * gráfico. Sem teto não existe escala fixa contra a qual desenhar, e um gráfico
 * auto-escalado é justamente o que acabou de sair. Omitir > afirmar errado — ela
 * mostra o número, que é verdade, e mais nada.
 *
 * O nível deixou de ser uma fileira de pontos própria e virou `SegBar` de 10
 * segmentos: o medidor do Cockpit, o mesmo de toda fração do app.
 *
 * O "subir de nível" manual segue vivo APENAS na competência que nunca teve
 * check-in — nela o nível gravado ainda é a única verdade. No instante em que o
 * primeiro check-in chega, a conta manda e o botão sai: dois donos do mesmo número
 * seria a contradição. E o cartão segue com DOIS gestos armados de naturezas
 * opostas que nunca aparecem juntos (ver `SkillCard`).
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Plus, ChevronsUp, Check, CalendarCheck } from "lucide-react";

import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Formula } from "../../design-system/Formula";
import { BarSpark, MonoLabel, SegBar } from "../../design-system/instruments";
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
import { currentMonth, monthLabel, monthName } from "./skillMonth";

/** A escala do nível calculado. O 1 é o piso, não o zero: nível 1 é meio segmento. */
const LEVEL_MIN = 1;
const LEVEL_MAX = 10;

/**
 * Nível → fração 0..1 na escala FIXA da competência.
 *
 * É a função que substituiu o `normalize()` por mínimo/máximo da série. O teto é
 * argumento porque a competência legada com `maxLevel` tem escala própria; a
 * calculada é sempre 1..10.
 */
function levelFraction(level: number, max: number = LEVEL_MAX): number {
  if (max <= LEVEL_MIN) return 1;
  return Math.max(0, Math.min(1, (level - LEVEL_MIN) / (max - LEVEL_MIN)));
}

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
  // Duas contagens, e só contagens: quantas competências existem e quantas já
  // têm nível calculado. Nada de "nível médio" — com três competências uma média
  // é uma frase sobre a vida de alguém que o dado não sustenta (lição 3).
  const comCheckin = items.filter((s) => s.computedLevel != null).length;

  return (
    <div className="nx-enter">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <MonoLabel>Competências</MonoLabel>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            Um check-in por mês — estudou, aplicou, evoluiu. O nível de 1 a 10 sai daí.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span className="tabular text-[11px] text-[var(--text-tertiary)]">
              {items.length} {items.length === 1 ? "competência" : "competências"}
              {comCheckin > 0 && ` · ${comCheckin} com nível calculado`}
            </span>
          )}
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
            Nova
          </Button>
        </div>
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
  // O teto da escala: 10 para a calculada; o teto da própria competência para a
  // legada; e `null` quando a legada não tem teto — aí não há escala nenhuma.
  const scaleMax = showsComputed ? LEVEL_MAX : skill.maxLevel;
  const scaleLabel = scaleMax != null ? `/ ${scaleMax}` : "nível";

  /*
   * A régua no tempo, na escala FIXA — a correção descrita no topo do arquivo.
   *
   * Cada nível vira a sua fração do teto, não a sua posição entre o mínimo e o
   * máximo da própria série. Sem teto (legada sem `maxLevel`) não há régua: é o
   * único jeito honesto, porque qualquer escala que eu escolhesse seria minha e
   * não do dado.
   */
  const levels = showsComputed
    ? (history.data ?? []).map((p) => p.level)
    : (track.data ?? []).map((p) => p.level);
  const series =
    scaleMax != null && levels.length >= 2
      ? levels.map((l) => levelFraction(l, scaleMax))
      : null;

  // A janela da régua, dita por extenso: um eixo de meses a 84px seria o "maabr"
  // ilegível da lição 2. Duas pontas em texto legível dizem a mesma coisa.
  const janela =
    showsComputed && history.data && history.data.length >= 2
      ? `${monthLabel(history.data[0].month)} → ${monthLabel(history.data[history.data.length - 1].month)}`
      : null;

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

      {/* O número em mono é o dado; a SegBar ao lado é a mesma leitura sem ler. */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[26px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
            {shownLevel}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)]">{scaleLabel}</span>
        </div>
        {/* `track` porque o nível 1 é uma resposta legítima: sem a coluna vazia
            atrás, um mês fraco vira um risco que se lê como mês inexistente. */}
        {series && (
          <BarSpark data={series} width={84} height={28} track className="shrink-0" />
        )}
      </div>

      {scaleMax != null && (
        <SegBar value={levelFraction(shownLevel, scaleMax)} segments={scaleMax} height={8} />
      )}

      {janela && (
        <p className="tabular text-[10px] text-[var(--text-tertiary)]">{janela}</p>
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
          "mt-auto flex justify-end border-t border-[var(--border-subtle)] pt-2",
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

export { levelFraction };
