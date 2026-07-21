/**
 * O card de uma meta: a barra, a projeção e a árvore de sub-desafios.
 *
 * Ele é o produto inteiro da tela de Metas — a lista só o repete. Por isso mora
 * num arquivo próprio: o que muda quando uma meta ganha um campo muda aqui, e
 * não na tela que sabe listar.
 *
 * # As duas barras
 *
 * Uma meta tem duas medidas de progresso que discordam o tempo todo: a métrica
 * (o peso de hoje) e os sub-desafios concluídos. O NEXUS não escolhe por quem a
 * meta é — o toggle escolhe, e a barra sempre diz qual das duas está mostrando
 * (§5 da 0007). Um número grande sem dizer de onde veio é um número em que não
 * se pode confiar.
 */

import { useState } from "react";
import { Check, Flame, GripVertical, Info, Link2, Plus, Repeat, Target, TrendingUp } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Checkbox } from "../../design-system/Checkbox";
import { CountUp } from "../../design-system/cards";
import { ProgressBar, ProgressRing, Sparkline } from "../../design-system/charts";
import { Heatmap, type HeatCell } from "../../design-system/instruments";
import { Button, cx } from "../../design-system/primitives";
import { metricDecimals } from "../../lib/format";
import type {
  Constancia,
  GoalKind,
  GoalWithProgress,
  MilestoneView,
  ProgressSource,
} from "../../lib/ipc";
import { NodeLinkSection } from "../links/NodeLinkSection";

/** O subtítulo de uma meta SEM métrica — onde a quantitativa mostra o que mede. */
const KIND_LABEL: Record<GoalKind, string> = {
  quantitative: "",
  binary: "Conquista",
  staged: "Por etapas",
  constancia: "Constância diária",
};

export function GoalCard({
  goal,
  colour,
  onToggleMilestone,
  onAddMilestone,
  onMoveMilestone,
  onCheckpoint,
  onSetSource,
  onDelete,
  deleting,
  onDeleteMilestone,
  deletingMilestoneId,
  onLinkHabit,
  onAddDailyMilestone,
}: {
  goal: GoalWithProgress;
  colour: string;
  onToggleMilestone: (m: MilestoneView, done: boolean) => void;
  onAddMilestone: (title: string) => void;
  onMoveMilestone: (m: MilestoneView, toIndex: number) => void;
  onCheckpoint: (value: number) => void;
  onSetSource: (source: ProgressSource) => void;
  onDelete: () => void;
  deleting: boolean;
  onDeleteMilestone: (m: MilestoneView) => void;
  /** Qual degrau está em voo — só ele trava, e não a árvore inteira. */
  deletingMilestoneId: string | null;
  /** Religa o hábito de uma constância que ficou sem um (a 0018 zera o vínculo). */
  onLinkHabit: () => void;
  /** Cria o hábito diário E o sub-desafio contado que ele alimenta. */
  onAddDailyMilestone: (title: string, targetCount: number) => void;
}) {
  const [formula, setFormula] = useState(false);
  const done = goal.milestones.filter((m) => m.ratio >= 1).length;

  /* Uma meta só tem MÉTRICA se for quantitativa (ADR-0071). Para a conquista e
     para a escada, os cinco campos são NULL por invariante do banco — então tudo
     que os lê (o número grande, a sparkline, a projeção, o checkpoint) some da
     tela em vez de renderizar "null / null undefined". O `startValue` é a guarda
     que o TypeScript cobra; o `goalKind` é a que diz a VERDADE, e é por ela que
     o componente decide. */
  const quantitative =
    goal.goalKind === "quantitative" &&
    goal.startValue !== null &&
    goal.targetValue !== null;

  /* A constância traz a série DELA (os ticks do hábito ligado), e não
     checkpoints: ela não tem nenhum, por invariante — `add_checkpoint` a recusa
     (ADR-0079). Tudo que é dela mora neste objeto. */
  const c = goal.constancia;

  // A série viva dos checkpoints, normalizada 0..1 do começo ao alvo (C5). O sinal
  // do span já cuida da direção: 82→72 tem span negativo, então medir 72 dá 1. O
  // ponto 0 do começo abre a linha, para um único checkpoint já desenhar a subida.
  const series = quantitative
    ? (() => {
        const start = goal.startValue as number;
        const span = (goal.targetValue as number) - start;
        const norm = (v: number) =>
          span === 0 ? 0 : Math.max(0, Math.min(1, (v - start) / span));
        return [
          0,
          ...[...goal.checkpoints]
            .sort((a, b) => a.notedAt - b.notedAt)
            .map((c) => norm(c.value)),
        ];
      })()
    : [];

  return (
    <article
      style={{ "--sphere": colour } as React.CSSProperties}
      className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)]"
    >
      {/* O mesmo gradiente do HeroCard: a meta é o herói da própria linha. Um
          card chapado sobre um fundo com profundidade parece papel colado. */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, var(--bg-surface) 0%, color-mix(in srgb, var(--sphere) 7%, var(--bg-surface)) 60%, color-mix(in srgb, var(--sphere) 18%, var(--bg-surface)) 100%)",
        }}
      />

      <div className="p-5">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-[var(--text-primary)]">
              {goal.title}
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
              {goal.metricName ?? KIND_LABEL[goal.goalKind]}
              {goal.deadline && ` · até ${new Date(goal.deadline).toLocaleDateString("pt-BR")}`}
            </p>
          </div>

          {/* O toggle só existe onde há DUAS medidas discordando (§5.6 do
              DATA_MODEL). Sem métrica há uma só, o banco força
              `progress_source='milestones'`, e oferecer a escolha seria oferecer
              um botão que o backend recusa. */}
          {/* O toggle e a exclusão dividem o canto direito do cabeçalho: os dois
              são gestos sobre a meta INTEIRA, e é aqui que se olha quando se
              quer mexer nela e não no que ela mede. Apagar corrige o ESTADO —
              a meta some da tela; o que ela viveu segue no ledger (ADR-0056). */}
          <div className="flex shrink-0 items-center gap-1">
            {quantitative && <SourceToggle source={goal.progressSource} onChange={onSetSource} />}
            <ArmedDelete
              onConfirm={onDelete}
              pending={deleting}
              question="Excluir esta meta?"
              ariaLabel="Excluir meta"
            />
          </div>
        </header>

        {/* ===== o dado é o herói: o número (ou o degrau) à esquerda, o anel à direita =====
            Cada tipo tem o SEU herói. A quantitativa mostra a métrica; a escada
            mostra em que degrau se está, que é a única pergunta que ela responde;
            a conquista não tem número nenhum, e fingir um seria pior que não ter. */}
        <div className="mb-3 flex items-center justify-between gap-4">
          {quantitative ? (
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[34px] leading-none font-semibold text-[var(--text-primary)]">
                <CountUp
                  to={goal.currentValue ?? (goal.startValue as number)}
                  decimals={metricDecimals(goal.currentValue ?? (goal.startValue as number))}
                />
              </span>
              <span className="tabular text-[15px] text-[var(--text-tertiary)]">
                / {goal.targetValue} {goal.unit}
              </span>
            </div>
          ) : c ? (
            /* A leitura de uma constância é o ACUMULADO: "R$ 1.250 / R$ 3.650".
               Os dias marcados vão ao lado porque são a outra metade da história
               — 12 dias de "R$ 10 por dia" são 12 dias E R$ 120, e mostrar só um
               dos dois esconde se o ritmo está sendo cumprido. */
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[34px] leading-none font-semibold text-[var(--text-primary)]">
                <CountUp to={c.accumulated} decimals={metricDecimals(c.accumulated)} />
              </span>
              <span className="tabular text-[15px] text-[var(--text-tertiary)]">
                / {c.target} {goal.unit}
              </span>
              <span className="tabular text-[12px] text-[var(--text-tertiary)]">
                · {c.daysMarked} dia{c.daysMarked === 1 ? "" : "s"}
              </span>
            </div>
          ) : goal.goalKind === "staged" && goal.progress.stageTotal ? (
            <div className="flex items-baseline gap-2">
              <span className="tabular text-[34px] leading-none font-semibold text-[var(--text-primary)]">
                <CountUp to={goal.progress.stageCurrent ?? 0} decimals={0} />
              </span>
              <span className="tabular text-[15px] text-[var(--text-tertiary)]">
                / {goal.progress.stageTotal} degraus
              </span>
              {goal.progress.stageLabel && (
                <span className="truncate text-[13px] font-medium text-[var(--sphere)]">
                  {goal.progress.stageLabel}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[13px] text-[var(--text-secondary)]">
              {done}/{goal.milestones.length || 0} degraus até a linha de chegada
            </span>
          )}
          <ProgressRing value={goal.progress.ratio} size={64} thickness={6} color="var(--sphere)">
            <span className="tabular text-[13px] font-semibold text-[var(--text-primary)]">
              {Math.round(goal.progress.ratio * 100)}%
            </span>
          </ProgressRing>
        </div>

        {/* A trajetória: a série dos checkpoints como sparkline (C5). Sem medições,
            cai na barra grossa com glow — sempre há um elemento vivo. */}
        {c ? (
          <ConstanciaStrip c={c} unit={goal.unit} onLinkHabit={onLinkHabit} />
        ) : quantitative && goal.checkpoints.length >= 1 ? (
          <Sparkline data={series} color="var(--sphere)" width={420} height={44} className="w-full" />
        ) : (
          <div className="relative">
            <ProgressBar value={goal.progress.ratio} height={12} />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                boxShadow: `0 0 16px color-mix(in srgb, var(--sphere) ${Math.round(
                  goal.progress.ratio * 45,
                )}%, transparent)`,
              }}
            />
          </div>
        )}

        {/* ===== a projeção, com a fórmula a um clique =====
            Só a quantitativa projeta: mínimos quadrados sobre checkpoints precisa
            de uma métrica para regredir. Numa conquista ou numa escada o backend
            devolve `projection: null` de propósito, e a linha "registre N
            checkpoints" não faz sentido nenhuma delas — some inteira. */}
        {quantitative && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          {goal.projection ? (
            <>
              <TrendingUp size={12} className="text-[var(--sphere)]" />
              <span>
                {goal.projection.eta ? (
                  <>
                    no ritmo atual, você atinge em{" "}
                    <strong className="tabular font-semibold text-[var(--text-primary)]">
                      {new Date(goal.projection.eta).toLocaleDateString("pt-BR")}
                    </strong>
                  </>
                ) : (
                  // `eta` nulo com 2+ pontos É uma resposta: o ritmo medido não
                  // leva ao alvo. Esconder isso seria esconder a única coisa
                  // que a projeção tinha a dizer.
                  <>no ritmo atual, você não chega ao alvo</>
                )}
              </span>
              <button
                onClick={() => setFormula((f) => !f)}
                aria-label="Como calculamos"
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <Info size={12} />
              </button>
            </>
          ) : (
            // Uma reta precisa de dois pontos, e o NEXUS não chuta.
            <span className="text-[var(--text-tertiary)]">
              registre {2 - goal.checkpoints.length} checkpoint
              {goal.checkpoints.length === 0 ? "s" : ""} para ver a projeção
            </span>
          )}
        </div>
        )}

        {formula && goal.projection && (
          <p className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[11px] leading-[18px] text-[var(--text-tertiary)]">
            {goal.projection.formula}
          </p>
        )}
        {formula && (
          <p className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[11px] leading-[18px] text-[var(--text-tertiary)]">
            {goal.progress.formula}
          </p>
        )}

        {/* ===== a árvore ===== */}
        <MilestoneTree
          milestones={goal.milestones}
          onToggle={onToggleMilestone}
          onAdd={onAddMilestone}
          onMove={onMoveMilestone}
          onDelete={onDeleteMilestone}
          deletingId={deletingMilestoneId}
          onAddDaily={onAddDailyMilestone}
        />

        <footer className="mt-4 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {done}/{goal.milestones.length}{" "}
            {goal.goalKind === "staged" ? "degraus" : "sub-desafios"}
          </span>
          {/* O checkpoint mede a MÉTRICA. Sem métrica o backend recusa a escrita
              (e faz bem), então o botão não pode existir para prometer o que não
              vai acontecer. */}
          {quantitative && (
            <CheckpointButton unit={goal.unit as string} onSubmit={onCheckpoint} />
          )}
        </footer>

        {/* Os vínculos: esta meta "conta para" uma Meta Anual ou um item de
            Estudos (ADR-0046). O backlink aparece do outro lado. */}
        <NodeLinkSection nodeId={goal.id} canAdd />
      </div>
    </article>
  );
}

/**
 * A faixa de uma CONSTÂNCIA: o heatmap dos dias, a sequência e a projeção.
 *
 * # Por que o heatmap é montado aqui, e não vem pronto do backend
 *
 * `constancia.days` traz só os dias que TÊM tick — é a série honesta, e ela não
 * inventa linhas para os dias em que nada aconteceu. Mas um heatmap com buracos
 * omitidos mentiria: as células ficariam lado a lado e uma semana inteira em
 * branco pareceria uma semana de dois dias. Então a grade contínua de
 * `countsFrom` até hoje se monta na tela, que é quem sabe o formato dela.
 *
 * A INTENSIDADE de cada célula é a fração do alvo diário cumprida no dia — com
 * alvo diário, "guardei R$ 30 de R$ 10" satura em 1; sem alvo diário, marcar é
 * marcar e a célula é cheia. Um dia PULADO não é um dia vazio, e por isso ele
 * tem célula (fraca) em vez de sumir.
 */
function ConstanciaStrip({
  c,
  unit,
  onLinkHabit,
}: {
  c: Constancia;
  unit: string | null;
  onLinkHabit: () => void;
}) {
  /* Sem hábito não há série nenhuma — nem porque nunca se ligou um, nem porque
     o hábito foi excluído (a 0018 zera o vínculo e os dois viram o mesmo
     estado, ADR-0078). Desenhar um heatmap vazio de 90 células cinzas seria um
     instrumento fingindo medir; o que cabe aqui é a saída. */
  if (!c.habitId) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] px-3 py-2.5">
        <span className="text-[11px] leading-[17px] text-[var(--text-tertiary)]">
          Sem hábito ligado — é ele que marca os dias e move esta meta.
        </span>
        <Button variant="secondary" size="sm" icon={Link2} onClick={onLinkHabit}>
          Ligar hábito
        </Button>
      </div>
    );
  }

  const { cells, truncated } = constanciaCells(c, unit);

  return (
    <div className="flex flex-col gap-2.5">
      <Heatmap cells={cells} columns={7} color="var(--sphere)" cell={11} gap={3} />

      {/* Corte declarado. Uma meta de três anos daria mil células e um heatmap
          que não cabe no card; mostrar as 26 últimas semanas em SILÊNCIO faria a
          faixa parecer a história inteira. O acumulado acima segue sendo o
          total desde o começo — só o desenho é que tem janela. */}
      {truncated && (
        <span className="text-[10px] text-[var(--text-tertiary)]">
          últimas 26 semanas — o acumulado acima conta desde{" "}
          {new Date(`${c.countsFrom}T12:00:00`).toLocaleDateString("pt-BR")}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <Flame size={12} className="text-[var(--sphere)]" />
          <span className="tabular font-semibold text-[var(--text-primary)]">{c.streak.current}</span>
          <span className="text-[var(--text-tertiary)]">
            dia{c.streak.current === 1 ? "" : "s"} seguidos
          </span>
          {c.streak.record > c.streak.current && (
            <span className="tabular text-[var(--text-tertiary)]">(recorde {c.streak.record})</span>
          )}
        </span>

        {/* A projeção da constância sai dos TICKS, não de checkpoints — ela mora
            em `constancia.projection` de propósito (ADR-0079). Com menos de dois
            dias marcados ela é `null`, e a linha diz isso em vez de chutar. */}
        {c.projection ? (
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp size={12} className="text-[var(--sphere)]" />
            {c.projection.eta ? (
              <>
                no ritmo atual, você acumula o alvo em{" "}
                <strong className="tabular font-semibold text-[var(--text-primary)]">
                  {new Date(c.projection.eta).toLocaleDateString("pt-BR")}
                </strong>
              </>
            ) : (
              <>no ritmo atual, o alvo não é alcançado</>
            )}
          </span>
        ) : (
          <span className="text-[var(--text-tertiary)]">
            marque {2 - c.daysMarked} dia{c.daysMarked === 1 ? "" : "s"} para ver a projeção
          </span>
        )}
      </div>
    </div>
  );
}

/** Quantas semanas o heatmap de uma constância desenha, no máximo. */
const HEATMAP_WEEKS = 26;

/**
 * A grade contínua do heatmap de uma constância.
 *
 * Três decisões moram aqui, e nenhuma delas cabe no backend:
 *
 * 1. **A grade é contínua.** `c.days` traz só os dias que TÊM tick — a série
 *    honesta, que não inventa linhas para os dias em que nada aconteceu. Mas
 *    encostar essas células umas nas outras faria uma semana em branco parecer
 *    uma semana de dois dias. Os buracos viram células vazias.
 * 2. **As semanas alinham.** As colunas são dias da semana, então a grade
 *    começa no domingo da primeira semana — sem o preenchimento, cada meta
 *    desenharia as colunas numa fase diferente e nenhuma delas seria legível
 *    como "as segundas-feiras".
 * 3. **A janela é finita e DECLARADA.** No máximo `HEATMAP_WEEKS` semanas; o
 *    corte é dito na tela por quem chama.
 */
function constanciaCells(
  c: Constancia,
  unit: string | null,
): { cells: HeatCell[]; truncated: boolean } {
  const marks = new Map(c.days.map((d) => [d.day, d]));
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const birth = new Date(`${c.countsFrom}T12:00:00`);
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() - (HEATMAP_WEEKS * 7 - 1));

  const truncated = birth < earliest;
  const from = truncated ? earliest : birth;

  // O domingo da semana em que a janela começa — as colunas são dias da semana.
  const start = new Date(from);
  start.setDate(start.getDate() - start.getDay());

  const cells: HeatCell[] = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const label = d.toLocaleDateString("pt-BR");

    // Os dias antes do começo da janela existem na GRADE (para as semanas
    // alinharem) mas não na história: eles ficam vazios e sem tooltip.
    if (d < from) {
      cells.push({ value: null });
      continue;
    }

    const mark = marks.get(dayKey(d));
    if (!mark) {
      cells.push({ value: null, title: `${label} — sem marca` });
      continue;
    }
    if (mark.status !== "done") {
      // Pulado e falhado são FATOS: aparecem, fracos, para a sequência que se
      // quebrou ter onde ser vista. Zero seria "nada aconteceu", que é outra
      // coisa.
      cells.push({
        value: 0.15,
        title: `${label} — ${mark.status === "skipped" ? "pulado" : "falhou"}`,
      });
      continue;
    }

    // A intensidade é a fração do combinado diário cumprida no dia: "guardei
    // R$ 30 de R$ 10" satura em 1. Sem alvo diário, marcar é marcar. O piso de
    // 0.35 existe para um dia feito nunca parecer um dia vazio.
    const intensity = c.dailyTarget ? Math.min(1, mark.value / c.dailyTarget) : 1;
    cells.push({
      value: Math.max(0.35, intensity),
      title: `${label} — ${mark.value} ${unit ?? ""}`.trim(),
    });
  }

  return { cells, truncated };
}

/**
 * O toggle da régua.
 *
 * Duas pílulas e não um switch: um switch não diz o que cada lado significa, e
 * "métrica" vs "sub-desafios" não é ligado/desligado.
 */
function SourceToggle({
  source,
  onChange,
}: {
  source: ProgressSource;
  onChange: (s: ProgressSource) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
      {(["metric", "milestones"] as ProgressSource[]).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          title={
            s === "metric"
              ? "A barra mede a métrica (os checkpoints)"
              : "A barra mede os sub-desafios concluídos"
          }
          className={cx(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
            "transition-colors duration-[var(--dur-fast)]",
            source === s
              ? "bg-[color-mix(in_srgb,var(--sphere)_22%,transparent)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
          )}
        >
          {s === "metric" ? <Target size={10} /> : <Check size={10} />}
          {s === "metric" ? "Métrica" : "Sub-desafios"}
        </button>
      ))}
    </div>
  );
}

/**
 * A árvore de sub-desafios: checkbox, contador e arrasto.
 *
 * O drag usa HTML5 drag-and-drop e não Pointer Events (como o calendário): aqui
 * a lista é curta e vertical, o alvo é uma linha inteira, e o `dragover` já dá o
 * índice de destino de graça. No calendário o alvo é um pixel numa coluna de 24
 * horas — são problemas diferentes.
 */
function MilestoneTree({
  milestones,
  onToggle,
  onAdd,
  onMove,
  onDelete,
  deletingId,
  onAddDaily,
}: {
  milestones: MilestoneView[];
  onToggle: (m: MilestoneView, done: boolean) => void;
  onAdd: (title: string) => void;
  onMove: (m: MilestoneView, toIndex: number) => void;
  onDelete: (m: MilestoneView) => void;
  deletingId: string | null;
  onAddDaily: (title: string, targetCount: number) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [adding, setAdding] = useState("");
  const [daily, setDaily] = useState(false);

  return (
    <div className="mt-4 flex flex-col gap-0.5">
      {milestones.map((m, index) => (
        <div
          key={m.id}
          draggable
          onDragStart={() => setDragging(m.id)}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(index);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const item = milestones.find((x) => x.id === dragging);
            if (item && item.id !== m.id) onMove(item, index);
            setDragging(null);
            setOver(null);
          }}
          className={cx(
            "group flex items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1.5",
            "transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)]",
            dragging === m.id && "opacity-40",
            over === index && dragging !== m.id && "bg-[color-mix(in_srgb,var(--sphere)_12%,transparent)]",
          )}
        >
          <GripVertical
            size={12}
            className="shrink-0 cursor-grab text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100"
          />

          <Checkbox
            checked={m.ratio >= 1}
            // Um 'counter' se preenche pelos ticks do hábito: o backend recusa o
            // clique, então a UI não o oferece. Um checkbox que erra ao ser
            // clicado é pior que um checkbox que não existe.
            disabled={m.kind === "counter"}
            onChange={() => onToggle(m, m.ratio < 1)}
            size={16}
            title={
              m.kind === "counter"
                ? "Este se preenche sozinho pelos ticks do hábito ligado"
                : m.title
            }
          />

          <span
            className={cx(
              "min-w-0 flex-1 truncate text-[12px]",
              m.ratio >= 1
                ? "text-[var(--text-tertiary)] line-through"
                : "text-[var(--text-secondary)]",
            )}
          >
            {m.title}
          </span>

          {m.kind === "counter" && (
            <span className="flex shrink-0 items-center gap-1.5">
              <Repeat size={10} className="text-[var(--text-tertiary)]" />
              <span className="tabular text-[10px] text-[var(--text-tertiary)]">
                {m.currentCount ?? 0}/{m.targetCount}
              </span>
              <div className="w-12">
                <ProgressBar value={m.ratio} height={3} />
              </div>
            </span>
          )}

          {/* A saída do sub-desafio, na mesma discrição da alça de arrasto: ela
              só aparece quando a linha está sob o cursor. Uma lixeira acesa em
              cada linha faria a árvore inteira parecer perigosa — e o gesto
              comum aqui é marcar, não apagar. O `focus-within` é o que segura a
              pergunta na tela depois de armada: o botão de confirmar recebe o
              foco, e sem isso tirar o mouse da linha esconderia a resposta. */}
          <ArmedDelete
            onConfirm={() => onDelete(m)}
            pending={deletingId === m.id}
            question="Excluir este sub-desafio?"
            ariaLabel="Excluir sub-desafio"
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          />
        </div>
      ))}

      {/* Adicionar inline, estilo checklist: Enter cria e deixa o campo pronto
          para o próximo. Um modal para cada linha de uma lista de 12 seria 12
          modais. */}
      <div className="flex items-center gap-2 px-1.5 py-1">
        <Plus size={12} className="shrink-0 text-[var(--text-tertiary)]" />
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && adding.trim()) {
              onAdd(adding.trim());
              setAdding("");
            }
          }}
          placeholder="Adicionar sub-desafio"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        {/* A segunda porta, e a que faltava: um sub-desafio que RENOVA TODO DIA.
            O campo acima cria um degrau de marcar uma vez; este cria um hábito
            diário de verdade, que entra nos Checkpoints da Esfera e preenche o
            contador sozinho. As duas coisas são diferentes o bastante para não
            caberem no mesmo Enter. */}
        {!daily && (
          <button
            onClick={() => setDaily(true)}
            className="shrink-0 text-[11px] font-medium text-[var(--text-tertiary)] hover:text-[var(--sphere)]"
          >
            + hábito diário
          </button>
        )}
      </div>

      {daily && <DailyMilestoneForm onCancel={() => setDaily(false)} onSubmit={onAddDaily} />}
    </div>
  );
}

/**
 * O sub-desafio que renova todo dia.
 *
 * Ele não é um checkbox: é um HÁBITO diário mais um sub-desafio 'counter' ligado
 * a ele (§4 da 0007). Marcar o hábito nos Checkpoints do dia é o que enche o
 * contador — e é por isso que o formulário pede duas coisas e não uma: o nome do
 * que se faz todo dia, e quantas vezes até o sub-desafio estar vencido.
 *
 * O piso é HOJE, decidido pelo backend (`counts_from`, 0009): um "30 dias de
 * academia" criado hoje sobre um hábito antigo nasceria completo, exibindo
 * 51/30 — que foi o que a tela mostrou quando o M3 foi dirigido de verdade.
 */
function DailyMilestoneForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, targetCount: number) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [count, setCount] = useState("30");

  const target = Number(count);
  const valid = title.trim() !== "" && Number.isInteger(target) && target > 0;

  const submit = () => {
    if (!valid) return;
    onSubmit(title.trim(), target);
    onCancel();
  };

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Repeat size={12} className="shrink-0 text-[var(--sphere)]" />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="O que você vai fazer todo dia"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <input
          value={count}
          onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
          aria-label="Quantos dias"
          className="tabular h-7 w-14 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-transparent px-2 text-center text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)]"
        />
        <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">dias</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">
          Entra nos Checkpoints de hoje e conta a partir de hoje.
        </span>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!valid}>
            Criar
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Registrar um checkpoint em ≤ 2 cliques a partir do card. */
function CheckpointButton({
  unit,
  onSubmit,
}: {
  unit: string;
  onSubmit: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  const submit = () => {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n)) return;
    onSubmit(n);
    setValue("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setOpen(true)}>
        Registrar medição
      </Button>
    );
  }

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={unit}
        className="h-7 w-24 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)]"
      />
      <Button variant="primary" size="sm" onClick={submit}>
        Salvar
      </Button>
    </div>
  );
}
