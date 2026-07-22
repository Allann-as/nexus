/**
 * A tela de Gamificação — "um mini-jogo da minha vida", com design sério.
 *
 * XP por Esfera e nível geral (tudo DERIVADO do estado, ADR-0037), a galeria de
 * conquistas (desbloqueadas + silhuetas das bloqueadas) e as Temporadas. Tom
 * adulto: sem mascote, sem confete — a celebração é tipográfica. Toda métrica
 * traz "como calculamos": a tabela de pontos e a curva de nível ficam à mostra.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  gamificationOverview,
  listAreas,
  listChallenges,
  syncAchievements,
  syncChallenges,
  type Area,
  type GalleryEntry,
  type Level,
} from "../../lib/ipc";
import { Card, PageHeader, PAGE_CONTAINER, cx } from "../../design-system/primitives";
import { MonoLabel, SegBar } from "../../design-system/instruments";
import { DynamicIcon } from "../../design-system/DynamicIcon";
import { TIER_COLOR, TIER_LABEL, TIER_ORDER, tierColor } from "../../design-system/tiers";
import { Formula } from "../../design-system/Formula";
import { ChallengesSection } from "./ChallengesSection";

export function GamificationScreen() {
  const overview = useQuery({
    queryKey: ["gamification"],
    queryFn: async () => {
      await syncAchievements();
      return gamificationOverview();
    },
  });
  const areas = useQuery({ queryKey: ["areas", "all"], queryFn: () => listAreas(true) });
  const challenges = useQuery({
    queryKey: ["challenges"],
    queryFn: async () => {
      await syncChallenges();
      return listChallenges();
    },
  });

  const areaById = useMemo(() => {
    const map = new Map<string, Area>();
    for (const a of areas.data ?? []) map.set(a.id, a);
    return map;
  }, [areas.data]);

  const data = overview.data;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Conquistas"
        subtitle="XP, níveis e temporadas — derivado do que você fez, nada de caixa-preta"
      />

      <div className={`${PAGE_CONTAINER} min-h-0 flex-1 space-y-8 pb-16`}>
        {data && (
          <>
            <OverallCard level={data.overall} />

            {data.spheres.length > 0 && (
              <section>
                <SectionTitle>XP por Esfera</SectionTitle>
                <div className="grid gap-3 md:grid-cols-2">
                  {data.spheres.map((s) => (
                    <SphereXpRow key={s.areaId} area={areaById.get(s.areaId)} level={s.level} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionTitle>Galeria de conquistas</SectionTitle>
              <Gallery entries={data.achievements} />
            </section>
          </>
        )}

        <section>
          <SectionTitle>Temporadas</SectionTitle>
          <ChallengesSection
            challenges={challenges.data ?? []}
            loading={challenges.isLoading}
          />
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
      {children}
    </h2>
  );
}

function OverallCard({ level }: { level: Level }) {
  return (
    <Card className="p-6">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Nível geral
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="tabular font-mono text-[52px] leading-none font-semibold text-[var(--text-primary)]">
              {level.level}
            </span>
            <span className="tabular text-[13px] text-[var(--text-tertiary)]">
              {level.xp.toLocaleString("pt-BR")} XP
            </span>
          </div>
        </div>
        <p className="tabular pb-1 text-[12px] text-[var(--text-tertiary)]">
          {level.intoLevel.toLocaleString("pt-BR")} / {level.span.toLocaleString("pt-BR")} para o
          nível {level.level + 1}
        </p>
      </div>
      {/* SegBar, não ProgressBar: o medidor do COCKPIT. E ele cabe aqui porque
          há denominador de verdade — quanto falta para o próximo nível. */}
      <SegBar
        value={level.span > 0 ? level.intoLevel / level.span : 0}
        segments={32}
        height={10}
        color="var(--accent)"
        className="mt-4"
      />
      <Formula>
        XP soma o que você fez: hábito cumprido 10 · tarefa concluída 15 · checkpoint de meta 20 ·
        sub-desafio 25 · livro terminado 60 · caixinha fechada 80 · temporada vencida 120 · meta
        anual concluída 200. Cada nível n custa 100·n^1,5 XP (a curva sobe: os primeiros vêm rápido,
        os altos viram conquista de longo prazo). Tudo derivado do estado — recomputável, nunca gravado.
      </Formula>
    </Card>
  );
}

function SphereXpRow({ area, level }: { area: Area | undefined; level: Level }) {
  const color = area?.color ?? "var(--accent)";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
          <span className="text-[13px] font-medium text-[var(--text-primary)]">
            {area?.name ?? "Sem Esfera"}
          </span>
        </div>
        <span
          className="tabular rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
        >
          Nível {level.level}
        </span>
      </div>
      <SegBar
        value={level.span > 0 ? level.intoLevel / level.span : 0}
        segments={20}
        height={8}
        color={color}
        className="mt-3"
      />
      <p className="tabular mt-2 text-[11px] text-[var(--text-tertiary)]">
        {level.xp.toLocaleString("pt-BR")} XP
        {/* Quanto falta para o próximo nível — a mesma frase do card geral, que
            aqui faltava: a barra mostrava a fração e nenhum número a explicava. */}
        {level.span > 0 && (
          <span className="text-[var(--text-tertiary)]">
            {" · "}
            {(level.span - level.intoLevel).toLocaleString("pt-BR")} para o nível {level.level + 1}
          </span>
        )}
      </p>
    </Card>
  );
}

function Gallery({ entries }: { entries: GalleryEntry[] }) {
  const unlocked = entries.filter((e) => e.unlocked).length;

  /* Agrupada por TIER, e dentro do tier as desbloqueadas primeiro. Uma galeria
     em ordem de catálogo não responde "o que eu já tenho" nem "o que vem a
     seguir"; agrupada por raridade, as duas perguntas se leem de relance. */
  const byTier = useMemo(() => {
    const groups = new Map<string, GalleryEntry[]>();
    for (const t of TIER_ORDER) groups.set(t, []);
    for (const e of entries) {
      if (!groups.has(e.tier)) groups.set(e.tier, []);
      groups.get(e.tier)!.push(e);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
    }
    return [...groups.entries()].filter(([, list]) => list.length > 0);
  }, [entries]);

  return (
    <>
      {/* A fração TEM denominador (o catálogo é fechado), então ela ganha
          medidor — é o critério do ADR-0088. */}
      {entries.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <span className="tabular shrink-0 text-[12px] text-[var(--text-secondary)]">
            {unlocked} de {entries.length}
          </span>
          <SegBar value={unlocked / entries.length} segments={24} height={8} className="flex-1" />
        </div>
      )}

      <div className="flex flex-col gap-5">
        {byTier.map(([tier, list]) => {
          const feitas = list.filter((e) => e.unlocked).length;
          return (
            <section key={tier}>
              <div className="mb-2 flex items-baseline gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ background: TIER_COLOR[tier] ?? "var(--accent)" }}
                  aria-hidden
                />
                <MonoLabel>{TIER_LABEL[tier] ?? tier}</MonoLabel>
                <span className="tabular text-[10.5px] text-[var(--text-tertiary)]">
                  {feitas}/{list.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {list.map((a) => (
                  <AchievementTile key={a.key} entry={a} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** "12 mar 2026" — quando a conquista caiu. */
function unlockedDay(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function AchievementTile({ entry }: { entry: GalleryEntry }) {
  const color = tierColor(entry.tier);
  return (
    <div
      className={cx(
        "flex flex-col gap-1.5 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-3",
        entry.unlocked ? "border-[var(--border-subtle)]" : "border-dashed border-[var(--border-subtle)]",
      )}
    >
      <div className="flex items-center gap-2">
        {/* A bloqueada mostra o PRÓPRIO ícone em silhueta, não um cadeado. Um
            cadeado é igual para todas e não diz o que se está perdendo — a
            galeria existe justamente para responder "o que ainda dá para
            conquistar" (ADR-0098). */}
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{
            background: entry.unlocked
              ? `color-mix(in oklab, ${color} 18%, transparent)`
              : "var(--bg-base)",
            color: entry.unlocked ? color : "var(--text-tertiary)",
            opacity: entry.unlocked ? 1 : 0.55,
          }}
        >
          <DynamicIcon name={entry.icon} size={18} />
        </span>
        <h3
          className={cx(
            "min-w-0 flex-1 text-[12px] leading-tight font-semibold",
            entry.unlocked ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
        >
          {entry.title}
        </h3>
      </div>

      {/* A descrição é o CRITÉRIO — o que falta fazer. Ela aparece bloqueada ou
          não: escrever "Bloqueada" no lugar dela troca a única informação útil
          do card por uma que o próprio desenho já dá. */}
      <p className="text-[11px] leading-[15px] text-[var(--text-tertiary)]">{entry.description}</p>

      {/* Quando caiu — o dado já vinha do backend e a tela o descartava. */}
      {entry.unlocked && entry.unlockedAt != null && (
        <p className="tabular mt-auto text-[10px] text-[var(--text-tertiary)]">
          {unlockedDay(entry.unlockedAt)}
        </p>
      )}
    </div>
  );
}
