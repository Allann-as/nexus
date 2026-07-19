/**
 * Recordes Pessoais (ARSENAL) — os PRs auto-detectados do estado.
 *
 * Maior sequência, melhor semana de estudo, melhor mês de aportes, melhor score
 * semanal, mais dias de foco num mês. O VALOR é derivado; o momento de bater —
 * congelado no ledger e desenhado na Timeline. Quando um recorde acabou de cair,
 * o card mostra o valor anterior: "você superou X".
 */

import { useQuery } from "@tanstack/react-query";
import { Trophy, Flame, BookOpen, TrendingUp, Sparkles, Timer, type LucideIcon } from "lucide-react";

import { personalRecords, type PersonalRecord, type RecordFormat } from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, EmptyState, cx } from "../../design-system/primitives";
import { formatMoneyShort } from "../../lib/format";

const ICONS: Record<string, LucideIcon> = {
  habit_streak: Flame,
  study_week: BookOpen,
  contribution_month: TrendingUp,
  score_week: Sparkles,
  focus_days_month: Timer,
};

export function RecordsScreen() {
  const recs = useQuery({ queryKey: ["personal-records"], queryFn: personalRecords });
  const items = recs.data ?? [];

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Recordes Pessoais"
        subtitle="Os seus melhores números de sempre — detectados sozinhos do que você fez"
      />

      <div className={cx(PAGE_CONTAINER, "pb-10")}>
        {recs.isSuccess && items.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon={Trophy}
              title="Nenhum recorde ainda"
              hint="Registre hábitos, sessões de estudo, aportes e blocos de foco — os seus melhores números aparecem aqui sozinhos, e a Timeline marca o dia em que a régua sobe."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <RecordCard key={r.key} record={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecordCard({ record }: { record: PersonalRecord }) {
  const Icon = ICONS[record.key] ?? Trophy;
  return (
    <Card
      className={cx(
        "relative flex flex-col gap-3 p-4",
        record.isNew && "border-[color-mix(in_srgb,var(--success)_55%,var(--border-subtle))]",
      )}
    >
      {record.isNew && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--success)_16%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
          <Sparkles size={10} />
          novo recorde
        </span>
      )}

      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]">
          <Icon size={17} style={{ color: "var(--accent)" }} />
        </span>
        <h3 className="text-[13px] font-medium text-[var(--text-secondary)]">{record.label}</h3>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[30px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
          {formatValue(record.value, record.format)}
        </span>
        {unitOf(record.format) && (
          <span className="text-[12px] text-[var(--text-tertiary)]">{unitOf(record.format)}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        {record.context && <span>{record.context}</span>}
        {record.isNew && record.previous != null && (
          <span className="inline-flex items-center gap-1 text-[var(--success)]">
            <TrendingUp size={11} />
            superou {formatValue(record.previous, record.format)}
          </span>
        )}
      </div>
    </Card>
  );
}

function formatValue(value: number, format: RecordFormat): string {
  switch (format) {
    case "money":
      return formatMoneyShort(value);
    case "hours": {
      // value em minutos → "3h20" / "45min".
      const h = Math.floor(value / 60);
      const m = Math.round(value % 60);
      if (h === 0) return `${m}min`;
      return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
    }
    default:
      return String(Math.round(value));
  }
}

function unitOf(format: RecordFormat): string | null {
  switch (format) {
    case "days":
      return "dias";
    case "int":
      return "pontos";
    default:
      return null;
  }
}
