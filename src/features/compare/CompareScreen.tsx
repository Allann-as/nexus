/**
 * Comparativo de Períodos (ARSENAL) — mês vs anterior, ano vs anterior.
 *
 * A comparação é ATÉ-A-DATA: este mês até hoje contra o mesmo trecho do mês
 * passado (e igual para o ano). Um mês cheio contra um pela metade mentiria a
 * seta. Ver ADR-0062.
 *
 * O desenho é o do COCKPIT: cada métrica traz DUAS SegBars numa escala
 * compartilhada (o maior dos dois períodos). A porcentagem diz o quanto mudou; a
 * barra diz o TAMANHO da mudança — "+50%" sobre 2 tarefas e "+50%" sobre 200
 * lêem igual em texto e completamente diferente lado a lado.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CheckSquare,
  Minus,
  PiggyBank,
  Repeat,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { periodComparison, type Comparison, type PeriodStats } from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, cx } from "../../design-system/primitives";
import { SegBar, SegToggle, MonoLabel } from "../../design-system/instruments";
import { Formula } from "../../design-system/Formula";
import { formatMoneyShort } from "../../lib/format";

type Mode = "month" | "year";

interface MetricDef {
  key: keyof PeriodStats;
  label: string;
  icon: LucideIcon;
  format: (v: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "studyMinutes", label: "Estudo", icon: BookOpen, format: hours },
  { key: "focusMinutes", label: "Foco", icon: Timer, format: hours },
  { key: "habitsDone", label: "Hábitos cumpridos", icon: Repeat, format: (v) => String(v) },
  { key: "contributionCents", label: "Aportes", icon: PiggyBank, format: formatMoneyShort },
  { key: "tasksCompleted", label: "Tarefas concluídas", icon: CheckSquare, format: (v) => String(v) },
  { key: "scoreAvg", label: "Score médio", icon: Sparkles, format: (v) => String(Math.round(v)) },
];

export function CompareScreen() {
  const [mode, setMode] = useState<Mode>("month");
  const q = useQuery({
    queryKey: ["period-comparison", mode],
    queryFn: () => periodComparison(mode),
  });
  const data = q.data;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Comparativo"
        subtitle="Este período contra o anterior — sempre até a mesma data, para a seta ser honesta"
        actions={
          <SegToggle<Mode>
            options={[
              { value: "month", label: "Mês" },
              { value: "year", label: "Ano" },
            ]}
            value={mode}
            onChange={setMode}
            tone="phos"
          />
        }
      />

      <div className={cx(PAGE_CONTAINER, "pb-10")}>
        {data && (
          <Card className="p-5">
            <div className="mb-5 flex items-center justify-center gap-4 text-[12px]">
              <span className="inline-flex items-center gap-2">
                <span className="size-2.5 rounded-[3px] bg-[var(--accent)]" />
                <span className="font-semibold text-[var(--text-primary)]">
                  {data.currentLabel}
                </span>
              </span>
              <span className="text-[var(--text-tertiary)]">contra</span>
              <span className="inline-flex items-center gap-2">
                <span className="size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--text-tertiary)_45%,transparent)]" />
                <span className="text-[var(--text-secondary)]">{data.previousLabel}</span>
              </span>
            </div>

            <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {METRICS.map((m) => (
                <MetricRow key={m.key} def={m} data={data} />
              ))}
            </div>

            <Formula>
              Cada período vai do primeiro dia até HOJE, e o anterior vai até o
              mesmo dia dele — {data.currentLabel} até hoje contra {data.previousLabel}{" "}
              até o mesmo ponto. Comparar um período cheio com um pela metade
              inverteria a seta sem nada ter piorado. As duas barras de cada linha
              dividem a MESMA escala (o maior dos dois valores), então o
              comprimento é comparável dentro da linha e não entre linhas.
            </Formula>
          </Card>
        )}
      </div>
    </div>
  );
}

function MetricRow({ def, data }: { def: MetricDef; data: Comparison }) {
  const cur = numberOf(data.current[def.key]);
  const prev = numberOf(data.previous[def.key]);
  const Icon = def.icon;

  /* A escala da linha é o maior dos dois — assim a barra maior sempre enche e a
     outra é lida como fração dela. Sem denominador (ambos zero, ou o score ainda
     sem dias pontuados) não há escala, e a barra fica no trilho vazio em vez de
     inventar um comprimento. */
  const scale = Math.max(cur ?? 0, prev ?? 0);
  const frac = (v: number | null) => (v == null || scale <= 0 ? 0 : v / scale);

  return (
    <div className="py-3.5">
      <div className={cx("flex items-center gap-3", scale > 0 && "mb-2")}>
        <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
          <Icon size={15} style={{ color: "var(--accent)" }} />
        </span>
        <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">
          {def.label}
        </span>
        <Delta cur={cur} prev={prev} />
      </div>

      {/* Zero contra zero não tem escala, e um medidor graduado desenhando dois
          trilhos vazios ocupa a altura de uma leitura para não dizer nada. Sem
          denominador o instrumento SOME — a frase da direita já é a informação
          completa. */}
      {scale > 0 && (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 pl-11">
          <MonoLabel className="w-16 truncate">{data.currentLabel}</MonoLabel>
          <Bar value={cur} frac={frac(cur)} color="var(--accent)" />
          <span className="tabular w-24 text-right font-mono text-[13px] font-semibold text-[var(--text-primary)]">
            {cur != null ? def.format(cur) : "—"}
          </span>

          <MonoLabel className="w-16 truncate">{data.previousLabel}</MonoLabel>
          <Bar value={prev} frac={frac(prev)} color="var(--text-tertiary)" />
          <span className="tabular w-24 text-right font-mono text-[13px] text-[var(--text-secondary)]">
            {prev != null ? def.format(prev) : "—"}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A barra de um período — ou a marca de que ele não tem dado.
 *
 * Um trilho de SegBar vazio afirma **zero**. "Nenhum score congelado em 2025"
 * não é zero, é ausência de medida, e desenhar os dois iguais faz a tela dizer
 * que o ano passado teve nota zero. O ausente ganha um traço tracejado: alinha a
 * linha, e não se confunde com o zero medido da linha de cima.
 */
function Bar({ value, frac, color }: { value: number | null; frac: number; color: string }) {
  if (value == null) {
    return (
      <span
        className="h-0 w-full border-t border-dashed border-[var(--border-subtle)]"
        aria-label="sem dado no período"
      />
    );
  }
  return <SegBar value={frac} color={color} height={9} />;
}

function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) {
    return <span className="text-[11px] text-[var(--text-tertiary)]">sem base de comparação</span>;
  }
  if (prev === 0) {
    /* Variação percentual sobre zero não existe. "novo" quando surgiu algo, e
       nada quando os dois são zero — dizer "0%" ali afirmaria uma estabilidade
       que ninguém mediu. */
    if (cur === 0) {
      return <span className="text-[11px] text-[var(--text-tertiary)]">sem registro nos dois</span>;
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--success)]">
        <TrendingUp size={12} />
        novo
      </span>
    );
  }
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const flat = pct === 0;
  const up = pct > 0;
  const Ic = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cx(
        "tabular inline-flex items-center gap-1 text-[11px] font-semibold",
        flat
          ? "text-[var(--text-tertiary)]"
          : up
            ? "text-[var(--success)]"
            : "text-[var(--danger)]",
      )}
    >
      <Ic size={12} />
      {flat ? "estável" : `${up ? "+" : ""}${pct}%`}
    </span>
  );
}

function numberOf(v: number | null): number | null {
  return typeof v === "number" ? v : null;
}

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
