/**
 * OBJETIVOS — o hub que agrega objetivos de QUALQUER natureza (REFINO R7).
 *
 * A ideia do usuário: "um objetivo pode ser uma promoção, pode ser correr 250x no
 * ano". As caixinhas (dinheiro guardado) e as metas anuais (incluindo as de
 * CONSTÂNCIA, como "correr 100 dias") são o mesmo conceito na cabeça dele — algo
 * que você persegue ao longo do tempo. Aqui elas moram juntas, filtráveis por
 * tipo e por Esfera, cada card levando à sua tela de origem.
 *
 * Nada é migrado: esta é uma SUPERFÍCIE nova sobre os mesmos nodes. As caixinhas
 * seguem nas Finanças; as metas anuais seguem em Metas Anuais. Aqui elas só se
 * encontram — e as quantitativas ganham o INDICADOR DE RITMO (`annualPace`), que é
 * o que faz de "47/100" uma meta viva em vez de um placar morto.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, PiggyBank, Target, TrendingUp, type LucideIcon } from "lucide-react";

import {
  annualGoalYear,
  listAreas,
  listFinGoals,
  type AnnualGoal,
  type FinGoalCard,
} from "../../lib/ipc";
import { PageContainer, PageHeader, cx } from "../../design-system/primitives";
import { formatMoneyShort } from "../../lib/format";
import { SphereIcon } from "../hub/SphereIcon";
import { annualPace } from "./pace";

type ObjType = "meta" | "caixinha";

interface ObjCard {
  id: string;
  type: ObjType;
  title: string;
  areaId: string | null;
  ratio: number;
  detail: string;
  pace?: { message: string; onTrack: boolean };
  onOpen: () => void;
}

const TYPE_FILTERS: { key: "all" | ObjType; label: string; icon: LucideIcon }[] = [
  { key: "all", label: "Todos", icon: Target },
  { key: "meta", label: "Metas anuais", icon: CalendarRange },
  { key: "caixinha", label: "Caixinhas", icon: PiggyBank },
];

export function ObjectivesScreen() {
  const navigate = useNavigate();
  const year = new Date().getFullYear();
  const [type, setType] = useState<"all" | ObjType>("all");
  const [area, setArea] = useState<string | "all">("all");

  const areas = useQuery({ queryKey: ["areas"], queryFn: () => listAreas(false) });
  const caixinhas = useQuery({ queryKey: ["fin-goals", "all"], queryFn: () => listFinGoals() });
  const yearGoals = useQuery({ queryKey: ["annual-goals", year], queryFn: () => annualGoalYear(year) });

  const areaMap = useMemo(
    () => new Map((areas.data ?? []).map((a) => [a.id, a])),
    [areas.data],
  );

  const cards = useMemo<ObjCard[]>(() => {
    const out: ObjCard[] = [];

    for (const c of (caixinhas.data ?? []) as FinGoalCard[]) {
      if (c.status === "archived") continue;
      out.push({
        id: `caixinha:${c.id}`,
        type: "caixinha",
        title: c.title,
        areaId: c.areaId,
        ratio: c.targetCents > 0 ? Math.min(1, c.savedCents / c.targetCents) : 0,
        detail: `${formatMoneyShort(c.savedCents)} / ${formatMoneyShort(c.targetCents)}`,
        onOpen: () =>
          navigate(c.areaId ? `/sphere/${c.areaId}?s=objetivos` : "/annual-goals"),
      });
    }

    const elapsed = yearGoals.data?.yearElapsedRatio ?? 0;
    for (const g of (yearGoals.data?.goals ?? []) as AnnualGoal[]) {
      const quantitative = g.goalKind === "quantitative" && g.targetValue != null;
      const unit = g.unit ? ` ${g.unit}` : "";
      const detail = quantitative
        ? `${g.currentValue} / ${g.targetValue}${unit}`
        : g.progressRatio >= 1
          ? "Concluída"
          : "Em aberto";
      const pace =
        quantitative && g.targetValue
          ? annualPace(g.currentValue, g.targetValue, elapsed)
          : null;
      out.push({
        id: `meta:${g.id}`,
        type: "meta",
        title: g.title,
        areaId: g.areaId,
        ratio: Math.min(1, g.progressRatio),
        detail,
        pace: pace ? { message: pace.message, onTrack: pace.onTrack } : undefined,
        onOpen: () => navigate("/annual-goals"),
      });
    }

    return out;
  }, [caixinhas.data, yearGoals.data, navigate]);

  const filtered = useMemo(
    () =>
      cards.filter(
        (c) => (type === "all" || c.type === type) && (area === "all" || c.areaId === area),
      ),
    [cards, type, area],
  );

  const activeAreas = useMemo(() => {
    const ids = new Set(cards.map((c) => c.areaId).filter(Boolean) as string[]);
    return (areas.data ?? []).filter((a) => ids.has(a.id));
  }, [cards, areas.data]);

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <PageHeader title="Objetivos" subtitle="Tudo que você persegue — dinheiro, constância, marcos — num lugar só" />

      <PageContainer className="pb-16">
        {/* filtros: tipo + Esfera */}
        <div className="flex flex-wrap items-center gap-2">
          {TYPE_FILTERS.map((f) => (
            <FilterChip key={f.key} active={type === f.key} icon={f.icon} onClick={() => setType(f.key)}>
              {f.label}
            </FilterChip>
          ))}
          {activeAreas.length > 0 && <span className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />}
          <FilterChip active={area === "all"} onClick={() => setArea("all")}>
            Todas as Esferas
          </FilterChip>
          {activeAreas.map((a) => (
            <FilterChip
              key={a.id}
              active={area === a.id}
              onClick={() => setArea(a.id)}
              dot={a.color}
            >
              {a.name}
            </FilterChip>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16 text-center">
            <Target size={26} className="text-[var(--text-tertiary)]" strokeWidth={1.6} />
            <p className="text-[13px] text-[var(--text-tertiary)]">
              Nenhum objetivo por aqui. Crie uma caixinha nas Finanças ou uma meta anual.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <ObjectiveCard key={c.id} card={c} area={c.areaId ? areaMap.get(c.areaId) : undefined} />
            ))}
          </div>
        )}
      </PageContainer>
    </div>
  );
}

function ObjectiveCard({
  card,
  area,
}: {
  card: ObjCard;
  area: { color: string; icon: string; name: string } | undefined;
}) {
  const Icon = card.type === "caixinha" ? PiggyBank : CalendarRange;
  const pct = Math.round(card.ratio * 100);
  return (
    <button
      onClick={card.onOpen}
      style={{ "--sphere": area?.color ?? "var(--accent)" } as React.CSSProperties}
      className={cx(
        "group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left",
        "transition-[transform,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease)]",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--sphere)_45%,transparent)] hover:shadow-[var(--glow-accent)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)]"
            style={{ background: "color-mix(in srgb, var(--sphere) 14%, transparent)" }}
          >
            <Icon size={16} style={{ color: "var(--sphere)" }} />
          </span>
          <h3 className="truncate text-[14px] font-semibold text-[var(--text-primary)]">{card.title}</h3>
        </div>
        {area && (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
            <SphereIcon name={area.icon} size={12} style={{ color: "var(--sphere)" }} />
          </span>
        )}
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="tabular text-[13px] text-[var(--text-secondary)]">{card.detail}</span>
          <span className="tabular text-[12px] font-semibold text-[var(--sphere)]">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-base)]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--sphere)" }} />
        </div>
      </div>

      {card.pace && (
        <p
          className={cx(
            "flex items-center gap-1.5 text-[11px] leading-[15px]",
            card.pace.onTrack ? "text-[var(--success)]" : "text-[var(--warning)]",
          )}
        >
          <TrendingUp size={12} className="shrink-0" />
          {card.pace.message}
        </p>
      )}
    </button>
  );
}

function FilterChip({
  active,
  icon: Icon,
  dot,
  onClick,
  children,
}: {
  active: boolean;
  icon?: LucideIcon;
  dot?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]",
      )}
    >
      {Icon && <Icon size={13} />}
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}
