/**
 * Nova meta (recomposta na v1.2, fase C).
 *
 * O que mudou, e por quê: este formulário era quantitativo e SÓ quantitativo —
 * métrica, começo, alvo, unidade, todos obrigatórios. Em uso real isso recusou a
 * vida do dono do app. *"Conseguir um emprego"* não tem métrica. *"Sair do
 * básico ao avançado em inglês"* não é um número. E o exemplo "Perder 10 kg"
 * aparecia até dentro de Finanças.
 *
 * Agora o primeiro passo é **que tipo de meta?** (ADR-0071 / ADR-0079):
 *
 *   * QUANTITATIVA — o formato de sempre. Nada aqui regrediu.
 *   * CONQUISTA    — só título. Ou aconteceu, ou não. Os degraus contam o caminho.
 *   * POR ETAPAS   — uma escada de estágios nomeados; o progresso é o degrau atual.
 *   * CONSTÂNCIA   — marca-se TODO DIA e acumula ("guardar R$ 10 por dia").
 *
 * A constância é a que mais mexe neste formulário, porque ela **cria um hábito**:
 * a série dela É `habit_ticks` (ADR-0077), e é por isso que ela aparece nos
 * Checkpoints do dia da Esfera e se preenche sozinha ao ser marcada lá. O
 * salvamento então é hábito → meta, nessa ordem: a meta precisa do id do hábito,
 * e um hábito sem meta é um hábito perfeitamente útil, enquanto uma constância
 * sem hábito é uma barra que nada alimenta.
 *
 * E o formulário nasce CONTEXTUAL: os exemplos, as unidades, o tipo que abre
 * marcado e os degraus sugeridos vêm de `goalTemplates.ts`, indexados pelo
 * `template` da Esfera. Trocar a Esfera troca o formulário inteiro. Isso é
 * catálogo, não `if` — nenhuma Esfera tem código próprio aqui.
 *
 * Os DEGRAUS de uma escada não são entidade nova: são os `milestone` de sempre
 * (§5.6 do DATA_MODEL), criados em ordem logo depois da meta. É por isso que o
 * salvamento tem duas etapas — e é por isso que a falha ao criar um degrau NÃO
 * descarta a meta: ela já existe e é válida sem eles, então o erro é avisado e o
 * usuário adiciona o que faltou no card. Perder a meta inteira por causa do
 * terceiro degrau seria o pior desfecho possível.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Target, X } from "lucide-react";

import { Modal, ModalHeader } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { addMilestone, createGoal, createHabit, type Area, type GoalKind } from "../../lib/ipc";
import { SphereIcon } from "../hub/SphereIcon";
import { goalTemplateFor } from "./goalTemplates";

const KINDS: Array<{ key: GoalKind; label: string; hint: string }> = [
  { key: "quantitative", label: "Com número", hint: "Uma métrica que sobe ou desce até um alvo" },
  { key: "binary", label: "Conquista", hint: "Aconteceu ou não aconteceu" },
  { key: "staged", label: "Por etapas", hint: "Uma escada de níveis nomeados" },
  {
    key: "constancia",
    label: "Constância",
    hint: "Você marca todo dia, e o feito do dia se acumula até o alvo",
  },
];

export function NewGoalModal({
  areas,
  defaultAreaId,
  onClose,
  onCreated,
}: {
  areas: Area[];
  defaultAreaId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [areaId, setAreaId] = useState<string | null>(defaultAreaId);
  const [kind, setKind] = useState<GoalKind>("quantitative");
  const [kindTouched, setKindTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [metricName, setMetricName] = useState("");
  const [unit, setUnit] = useState("");
  const [startValue, setStartValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  /* Os três campos da constância. `habitTitle` é o nome do HÁBITO que a
     alimenta — ele nasce junto e é o que aparece nos Checkpoints do dia. */
  const [habitTitle, setHabitTitle] = useState("");
  const [habitTouched, setHabitTouched] = useState(false);
  const [dailyTarget, setDailyTarget] = useState("");
  /* Se o USUÁRIO digitou nestes dois. Um booleano e não "o campo está vazio":
     "vazio" não distingue o que o usuário apagou do que um template anterior
     preencheu — e foi assim que a dirigida pegou uma constância de Finanças
     medindo em "dias", porque o valor herdado da esfera anterior grudou. É a
     mesma distinção que `kindTouched` já fazia para o tipo. */
  const [unitTouched, setUnitTouched] = useState(false);
  const [dailyTouched, setDailyTouched] = useState(false);

  const tpl = useMemo(
    () => goalTemplateFor(areas.find((a) => a.id === areaId)?.template),
    [areas, areaId],
  );

  /* Trocar a Esfera reabre o formulário no tipo que aquela Esfera costuma usar —
     a menos que o usuário JÁ tenha escolhido um tipo. A escolha explícita dele
     sempre ganha da sugestão; o catálogo abre a porta certa, não tranca as outras. */
  useEffect(() => {
    if (!kindTouched) setKind(tpl.defaultKind);
  }, [tpl, kindTouched]);

  /* Os degraus sugeridos entram quando a escada é escolhida — e só enquanto o
     usuário não mexeu neles. */
  useEffect(() => {
    if (kind === "staged") setStages((s) => (s.length === 0 ? tpl.stages : s));
  }, [kind, tpl]);

  /* A constância nasce com a unidade e o alvo diário da Esfera já preenchidos —
     em Finanças isso é "R$ 10", em Saúde é "dias" sem alvo diário nenhum.
     Trocar a Esfera TROCA os dois, como troca o resto do formulário; só a
     digitação do usuário é preservada. Guardar só "enquanto estiver vazio"
     deixava a unidade da esfera anterior grudada, e uma meta de Finanças
     media em "dias". */
  useEffect(() => {
    if (kind !== "constancia") return;
    if (!unitTouched) setUnit(tpl.constancia.unit);
    if (!dailyTouched) setDailyTarget(tpl.constancia.dailyPlaceholder);
  }, [kind, tpl, unitTouched, dailyTouched]);

  const start = Number(startValue.replace(",", "."));
  const target = Number(targetValue.replace(",", "."));
  const daily = dailyTarget.trim() === "" ? null : Number(dailyTarget.replace(",", "."));

  const namedStages = stages.map((s) => s.trim()).filter((s) => s !== "");

  /* O hábito, quando o usuário não o nomeou, é o próprio título da meta:
     "Guardar R$ 10 por dia" é um nome perfeitamente bom para o que aparece no
     checklist do dia. Pedir dois nomes obrigatórios para uma coisa só seria
     burocracia — o campo existe para quem QUER separá-los. */
  const effectiveHabit = (habitTouched && habitTitle.trim()) || title.trim();

  const valid =
    title.trim() !== "" &&
    (kind !== "quantitative" ||
      (metricName.trim() !== "" &&
        unit.trim() !== "" &&
        Number.isFinite(start) &&
        Number.isFinite(target) &&
        start !== target)) &&
    // Uma escada sem degraus é uma escada sem degrau nenhum para subir: ela
    // nasceria em 0/0 e nunca sairia dali.
    (kind !== "staged" || namedStages.length >= 2) &&
    // Uma constância precisa do alvo a acumular e da unidade dele; o alvo POR
    // DIA é opcional (sem ele, ela conta DIAS), mas se vier tem que ser > 0.
    (kind !== "constancia" ||
      (unit.trim() !== "" &&
        Number.isFinite(target) &&
        target > 0 &&
        (daily === null || (Number.isFinite(daily) && daily > 0))));

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const quantitative = kind === "quantitative";
      const constancia = kind === "constancia";

      /* O HÁBITO vem primeiro, porque a meta precisa do id dele. Se a criação da
         meta falhar depois disto, sobra um hábito diário — que é uma coisa útil
         e deletável, não lixo. A ordem inversa deixaria uma meta de constância
         sem série nenhuma, que é o estado inútil dos dois. */
      const habit = constancia
        ? await createHabit({
            title: effectiveHabit,
            areaId,
            schedule: { type: "daily" },
            // O hábito herda o alvo diário: marcar "R$ 30" no dia é digitar no
            // hábito, e é esse `value` que o acumulado da meta soma.
            targetValue: daily,
            unit: daily === null ? null : unit.trim(),
          })
        : null;

      const goal = await createGoal({
        title: title.trim(),
        areaId,
        goalKind: kind,
        // Os cinco campos da métrica só existem na quantitativa. O banco recusa
        // qualquer um deles nos outros tipos (o CHECK por tipo da 0016).
        //
        // A constância fica no MEIO: ela tem alvo e unidade, e NÃO tem métrica
        // nem partida (o terceiro braço do CHECK da 0017). A direção o backend
        // força para 'increase' — uma constância só acumula.
        metricName: quantitative ? metricName.trim() : null,
        startValue: quantitative ? start : null,
        targetValue: quantitative || constancia ? target : null,
        unit: quantitative || constancia ? unit.trim() : null,
        // A direção é DERIVADA pelo backend a partir do par de números.
        progressSource: quantitative || constancia ? "metric" : "milestones",
        habitId: habit?.id ?? null,
        dailyTarget: constancia ? daily : null,
      });

      // Os degraus da escada, em ordem. Sequencial de propósito: `sort_order` sai
      // da ordem de chegada, e um Promise.all embaralharia a escada.
      //
      // O catch é SEPARADO do da meta, e não relança: neste ponto a meta já
      // existe e é perfeitamente válida sem os degraus. Deixar o erro subir
      // manteria a modal aberta sobre uma meta que já foi criada, e um segundo
      // "Criar meta" faria a segunda. Avisar e seguir é o desfecho honesto — o
      // usuário completa a escada no card.
      if (kind === "staged") {
        try {
          for (const label of namedStages) {
            await addMilestone({ goalId: goal.id, title: label });
          }
        } catch (e) {
          pushError(e);
          push("success", "A meta foi criada; adicione os degraus que faltaram no card.");
        }
      }

      onCreated();
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  const subtitle =
    kind === "quantitative"
      ? "Uma métrica, um começo honesto e um alvo"
      : kind === "binary"
        ? "A linha de chegada; os degraus vêm depois"
        : kind === "staged"
          ? "Os degraus da escada, do primeiro ao último"
          : "Um dia de cada vez, somando até o alvo";

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <ModalHeader icon={Target} title="Nova meta" subtitle={subtitle} onClose={onClose} />

        <div className="flex flex-col gap-3">
          {/* ===== passo 1: que tipo de meta? ===== */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
              Tipo
            </span>
            <div className="grid grid-cols-4 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  title={k.hint}
                  onClick={() => {
                    setKind(k.key);
                    setKindTouched(true);
                  }}
                  className={cx(
                    "rounded-[var(--radius-md)] border px-2 py-2 text-[12px] font-medium",
                    "transition-colors duration-[var(--dur-fast)]",
                    kind === k.key
                      ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text-primary)]"
                      : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {KINDS.find((k) => k.key === kind)?.hint}
            </span>
          </div>

          <Input
            autoFocus
            value={title}
            onChange={setTitle}
            placeholder={
              kind === "constancia" ? tpl.constancia.titlePlaceholder : tpl.titlePlaceholder
            }
            label="Meta"
          />

          {/* ===== os campos da métrica: só a quantitativa os tem ===== */}
          {kind === "quantitative" && (
            <>
              <Input
                value={metricName}
                onChange={setMetricName}
                placeholder={tpl.metricPlaceholder}
                label="Métrica"
              />
              <div className="grid grid-cols-3 gap-2">
                <Input value={startValue} onChange={setStartValue} placeholder="82" label="Hoje" />
                <Input value={targetValue} onChange={setTargetValue} placeholder="72" label="Alvo" />
                <Input value={unit} onChange={setUnit} placeholder={tpl.units[0]} label="Unidade" />
              </div>
              {/* As unidades que ESTA Esfera mede, a um clique. Em Finanças isso é
                  só "R$" — e é exatamente esse o ponto. */}
              <div className="flex flex-wrap gap-1">
                {tpl.units.map((u) => (
                  <Chip key={u} active={unit === u} onClick={() => setUnit(u)}>
                    {u}
                  </Chip>
                ))}
              </div>
            </>
          )}

          {/* ===== a constância: quanto por dia, até quanto, e o hábito ===== */}
          {kind === "constancia" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  value={dailyTarget}
                  onChange={(v) => {
                    setDailyTouched(true);
                    setDailyTarget(v);
                  }}
                  placeholder={tpl.constancia.dailyPlaceholder || "opcional"}
                  label="Por dia"
                />
                <Input
                  value={targetValue}
                  onChange={setTargetValue}
                  placeholder={tpl.constancia.targetPlaceholder}
                  label="Até acumular"
                />
                <Input
                  value={unit}
                  onChange={(v) => {
                    setUnitTouched(true);
                    setUnit(v);
                  }}
                  placeholder={tpl.constancia.unit}
                  label="Unidade"
                />
              </div>

              {/* A frase que diz o que vai acontecer, com os números que o
                  usuário acabou de digitar. Um formulário de constância sem ela
                  faz o dono adivinhar se "30" é dias ou reais. */}
              <p className="text-[11px] leading-[17px] text-[var(--text-tertiary)]">
                {constanciaSentence(daily, target, unit)}
              </p>

              <Input
                value={habitTouched ? habitTitle : effectiveHabit}
                onChange={(v) => {
                  setHabitTouched(true);
                  setHabitTitle(v);
                }}
                placeholder={tpl.constancia.habitPlaceholder}
                label="Hábito diário (aparece nos Checkpoints)"
              />
              {/* O que a constância REALMENTE cria, dito antes de criar: um
                  hábito diário. Ele é a série da meta (ADR-0077), e marcar ele
                  no dia é o que move a barra — não há um segundo lugar. */}
              <p className="text-[11px] leading-[17px] text-[var(--text-tertiary)]">
                Um hábito diário com este nome é criado junto e entra nos
                Checkpoints de hoje. Marcar ele lá é o que move esta meta.
              </p>
            </>
          )}

          {/* ===== os degraus da escada ===== */}
          {kind === "staged" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                Degraus
              </span>
              <div className="flex flex-col gap-1.5">
                {stages.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="tabular w-4 shrink-0 text-[11px] text-[var(--text-tertiary)]">
                      {i + 1}
                    </span>
                    <input
                      value={s}
                      onChange={(e) =>
                        setStages((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))
                      }
                      placeholder={`Degrau ${i + 1}`}
                      className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
                    />
                    <button
                      onClick={() => setStages((cur) => cur.filter((_, j) => j !== i))}
                      aria-label={`Remover degrau ${i + 1}`}
                      className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={Plus}
                onClick={() => setStages((cur) => [...cur, ""])}
                className="self-start"
              >
                Adicionar degrau
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
              Esfera
            </span>
            <div className="flex flex-wrap gap-1">
              <Chip active={areaId === null} onClick={() => setAreaId(null)}>
                Nenhuma
              </Chip>
              {areas.map((a) => (
                <Chip
                  key={a.id}
                  active={areaId === a.id}
                  colour={a.color}
                  onClick={() => setAreaId(a.id)}
                >
                  <SphereIcon name={a.icon} size={12} />
                  {a.name}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={submit} disabled={!valid || saving}>
              Criar meta
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A frase que diz, com os números que o usuário acabou de digitar, o que vai
 * acontecer quando ele marcar o dia.
 *
 * Ela existe porque "30" sozinho é ambíguo: 30 dias? 30 reais? A regra do
 * ADR-0079 — sem alvo diário a constância conta DIAS, com alvo diário ela soma
 * VALORES — só é óbvia depois de explicada uma vez, e este é o lugar de explicar.
 *
 * Função livre e exportada para ser testável sozinha: é texto com concordância,
 * e concordância errada ("1 dias") é a marca de um app que ninguém leu.
 */
export function constanciaSentence(
  daily: number | null,
  target: number,
  unit: string,
): string {
  const u = unit.trim();
  const hasTarget = Number.isFinite(target) && target > 0;

  if (daily === null) {
    const base = `Cada dia marcado conta 1 ${u || "dia"}`;
    return hasTarget ? `${base} — a meta fecha em ${target}.` : `${base}.`;
  }
  const base = `Marcar o dia conta ${daily} ${u}`;
  return hasTarget
    ? `${base}, e a meta fecha ao somar ${target} ${u}.`
    : `${base}. Digite um valor diferente no dia para corrigir.`;
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
      />
    </label>
  );
}

function Chip({
  active,
  colour,
  onClick,
  children,
}: {
  active: boolean;
  colour?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={colour ? ({ "--sphere": colour } as React.CSSProperties) : undefined}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        "transition-colors duration-[var(--dur-fast)]",
        active
          ? colour
            ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_20%,transparent)] text-[var(--text-primary)]"
            : "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
      )}
    >
      {children}
    </button>
  );
}
