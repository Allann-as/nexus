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
import { Check, GripVertical, Info, Plus, Repeat, Target, TrendingUp } from "lucide-react";

import { Checkbox } from "../../design-system/Checkbox";
import { CountUp } from "../../design-system/cards";
import { ProgressBar, ProgressRing, Sparkline } from "../../design-system/charts";
import { Button, cx } from "../../design-system/primitives";
import { metricDecimals } from "../../lib/format";
import type { GoalKind, GoalWithProgress, MilestoneView, ProgressSource } from "../../lib/ipc";
import { NodeLinkSection } from "../links/NodeLinkSection";

/** O subtítulo de uma meta SEM métrica — onde a quantitativa mostra o que mede. */
const KIND_LABEL: Record<GoalKind, string> = {
  quantitative: "",
  binary: "Conquista",
  staged: "Por etapas",
};

export function GoalCard({
  goal,
  colour,
  onToggleMilestone,
  onAddMilestone,
  onMoveMilestone,
  onCheckpoint,
  onSetSource,
}: {
  goal: GoalWithProgress;
  colour: string;
  onToggleMilestone: (m: MilestoneView, done: boolean) => void;
  onAddMilestone: (title: string) => void;
  onMoveMilestone: (m: MilestoneView, toIndex: number) => void;
  onCheckpoint: (value: number) => void;
  onSetSource: (source: ProgressSource) => void;
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
          {quantitative && <SourceToggle source={goal.progressSource} onChange={onSetSource} />}
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
        {quantitative && goal.checkpoints.length >= 1 ? (
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
}: {
  milestones: MilestoneView[];
  onToggle: (m: MilestoneView, done: boolean) => void;
  onAdd: (title: string) => void;
  onMove: (m: MilestoneView, toIndex: number) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [adding, setAdding] = useState("");

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
