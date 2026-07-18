/**
 * A trilha de competências da Carreira (M4.6, item 6).
 *
 * Uma competência tem um NÍVEL que sobe. Subir de nível é um FATO que entra no
 * ledger para sempre e vale XP (ADR-0037/0045) — por isso o botão pede uma
 * confirmação leve (um clique arma, o segundo confirma; nada de modal). A trilha
 * de evolução vem da série do ledger; uma competência nova (um ponto só) NÃO
 * desenha sparkline — o padrão "número real, omitido sem dado" vale para gráfico.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Plus, ChevronsUp, Check } from "lucide-react";

import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { Sparkline } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import {
  createSkill,
  levelUpSkill,
  listSkills,
  skillTrack,
  type Skill,
} from "../../lib/ipc";

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
            Suba de nível quando evoluir de verdade — cada nível é um marco no seu histórico.
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
          hint="Uma competência é uma capacidade que você desenvolve — System Design, inglês, liderança. Suba de nível conforme evolui, e a trilha guarda a jornada."
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
  const pushError = useToasts((s) => s.pushError);
  const [armed, setArmed] = useState(false);
  const armedTimer = useRef<number | null>(null);

  const track = useQuery({
    queryKey: ["skill-track", skill.id],
    queryFn: () => skillTrack(skill.id),
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

  // A confirmação leve: o primeiro clique arma; se o segundo não vem em 3.5s, desarma.
  useEffect(() => {
    if (!armed) return;
    armedTimer.current = window.setTimeout(() => setArmed(false), 3500);
    return () => {
      if (armedTimer.current) window.clearTimeout(armedTimer.current);
    };
  }, [armed]);

  const atMax = skill.maxLevel != null && skill.level >= skill.maxLevel;
  const points = track.data ?? [];
  // Um ponto só = competência nova: omitir o sparkline (não desenhar um ponto solto).
  const series = points.length >= 2 ? normalize(points.map((p) => p.level)) : null;

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
            {skill.level}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {skill.maxLevel != null ? `/ ${skill.maxLevel}` : "nível"}
          </span>
        </div>
        {series && (
          <Sparkline data={series} width={84} height={28} className="shrink-0" />
        )}
      </div>

      {skill.maxLevel != null && <LevelPips level={skill.level} max={skill.maxLevel} />}

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
              : "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] text-[var(--sphere)] hover:bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)]",
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
            Subir de nível
          </>
        )}
      </button>
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
