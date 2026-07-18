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
import { Lock } from "lucide-react";

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
import { Card, PageHeader } from "../../design-system/primitives";
import { ProgressBar } from "../../design-system/charts";
import { DynamicIcon } from "../../design-system/DynamicIcon";
import { Formula } from "../../design-system/Formula";
import { ChallengesSection } from "./ChallengesSection";

const TIER_COLOR: Record<string, string> = {
  bronze: "#C08457",
  silver: "#A8B0BC",
  gold: "#E0B34D",
  platinum: "#C4B5FD",
};

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

      <div className="min-h-0 flex-1 space-y-8 pb-16">
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
      <ProgressBar value={level.span > 0 ? level.intoLevel / level.span : 0} height={10} className="mt-4" />
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
      <ProgressBar
        value={level.span > 0 ? level.intoLevel / level.span : 0}
        color={color}
        className="mt-3"
      />
      <p className="tabular mt-2 text-[11px] text-[var(--text-tertiary)]">
        {level.xp.toLocaleString("pt-BR")} XP
      </p>
    </Card>
  );
}

function Gallery({ entries }: { entries: GalleryEntry[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {entries.map((a) => (
        <AchievementTile key={a.key} entry={a} />
      ))}
    </div>
  );
}

function AchievementTile({ entry }: { entry: GalleryEntry }) {
  const color = TIER_COLOR[entry.tier] ?? "var(--accent)";
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-center"
      style={{ opacity: entry.unlocked ? 1 : 0.55 }}
    >
      <div
        className="flex size-12 items-center justify-center rounded-full"
        style={{
          background: entry.unlocked
            ? `color-mix(in oklab, ${color} 18%, transparent)`
            : "var(--bg-base)",
          color: entry.unlocked ? color : "var(--text-tertiary)",
        }}
      >
        {entry.unlocked ? (
          <DynamicIcon name={entry.icon} size={22} />
        ) : (
          <Lock size={18} aria-hidden />
        )}
      </div>
      <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">{entry.title}</h3>
      <p className="text-[11px] leading-[15px] text-[var(--text-tertiary)]">
        {entry.unlocked ? entry.description : "Bloqueada"}
      </p>
    </div>
  );
}
