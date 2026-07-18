/**
 * Um card de Esfera no Hub.
 *
 * O card tem que responder "como vai esta parte da minha vida?" em um olhar,
 * sem clique. Por isso ele carrega dado real (§2.1): progresso de hoje, o streak
 * vivo, o que está em aberto e a forma dos últimos 30 dias. Um card com número
 * de mentira seria pior que um card vazio — o Hub inteiro perderia a
 * credibilidade junto.
 *
 * A cor tinge tudo (aurora, ícone, anel, sparkline), mas NUNCA é a única pista:
 * o nome e o ícone estão sempre lá. Duas Esferas de cor parecida continuam
 * distinguíveis — inclusive para quem não separa violeta de azul (ADR-0008).
 */

import { useNavigate } from "react-router-dom";
import { Flame } from "lucide-react";

import type { Level, SphereCard as SphereCardData } from "../../lib/ipc";
import { cx } from "../../design-system/primitives";
import { CountUp } from "../../design-system/cards";
import { ProgressRing, Sparkline } from "../../design-system/charts";
import { SphereIcon } from "./SphereIcon";

export function SphereCard({
  sphere,
  index,
  level,
}: {
  sphere: SphereCardData;
  /** Posição no grid — vira o atalho numérico (1–9). */
  index: number;
  /** XP/nível da Esfera (M4.6). Ausente enquanto a gamificação carrega. */
  level?: Level;
}) {
  const navigate = useNavigate();
  const { habitsTodayDone: done, habitsTodayTotal: total } = sphere;
  const ratio = total > 0 ? done / total : 0;

  return (
    <button
      onClick={() => navigate(`/sphere/${sphere.id}`)}
      // `--sphere` definida aqui é o truque que faz tudo lá dentro se tingir
      // sozinho: o anel, o sparkline e a aurora leem a variável, não a prop.
      style={{ "--sphere": sphere.color } as React.CSSProperties}
      className={cx(
        "group relative flex h-[196px] flex-col overflow-hidden rounded-[var(--radius-lg)] p-5 text-left",
        "border border-[var(--border-subtle)] bg-[var(--bg-surface)]",
        "transition-[transform,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease)]",
        "hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
        "hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--sphere)_20%,transparent),0_14px_40px_color-mix(in_srgb,var(--sphere)_16%,transparent)]",
      )}
    >
      {/* A aurora do card: o mesmo gradiente radial do fundo das páginas, na cor
          da Esfera. Estático; o hover só aumenta a opacidade. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-[var(--dur-base)] group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(420px 200px at 85% -20%, color-mix(in srgb, var(--sphere) 20%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="grid size-10 place-items-center rounded-[var(--radius-md)]"
            style={{ background: "color-mix(in srgb, var(--sphere) 14%, transparent)" }}
          >
            <SphereIcon name={sphere.icon} size={19} style={{ color: "var(--sphere)" }} />
          </div>
          <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            {sphere.name}
          </h3>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Nível da Esfera (M4.6) — a cor tinge, mas o "Nv" nomeia. */}
          {level && level.xp > 0 && (
            <span
              className="tabular rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: "color-mix(in srgb, var(--sphere) 16%, transparent)",
                color: "var(--sphere)",
              }}
              title={`${level.xp.toLocaleString("pt-BR")} XP`}
            >
              Nv {level.level}
            </span>
          )}
          {/* O atalho numérico. Aparece no hover: presente para quem procura,
              silencioso para quem não. */}
          {index < 9 && (
            <kbd className="grid size-5 place-items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] font-mono text-[10px] text-[var(--text-tertiary)] opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100">
              {index + 1}
            </kbd>
          )}
        </div>
      </div>

      {/* Uma Esfera vazia convida em vez de exibir uma parede de zeros. O ícone
          d'água ocupa o espaço que o dado ocuparia: sem ele, quatro Esferas
          novas viram quatro buracos com uma frase solta no canto — que foi
          exatamente o que a primeira versão desta tela parecia. */}
      {sphere.isEmpty && (
        <div
          aria-hidden
          className="pointer-events-none absolute right-4 -bottom-5 opacity-[0.07] transition-opacity duration-[var(--dur-base)] group-hover:opacity-[0.13]"
        >
          <SphereIcon name={sphere.icon} size={120} style={{ color: "var(--sphere)" }} />
        </div>
      )}

      <div className="relative mt-auto flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {sphere.isEmpty ? (
            <p className="text-[12px] leading-[18px] text-[var(--text-tertiary)]">
              Nada por aqui ainda.
              <br />
              <span className="font-medium text-[var(--sphere)]">Abrir e começar →</span>
            </p>
          ) : (
            <>
              {total > 0 && (
                <div className="flex items-center gap-2.5">
                  <ProgressRing value={ratio} size={38} thickness={3.5}>
                    <span className="tabular text-[10px] font-semibold text-[var(--text-secondary)]">
                      {Math.round(ratio * 100)}
                    </span>
                  </ProgressRing>
                  <div>
                    <p className="tabular text-[19px] leading-none font-semibold tracking-[-0.02em]">
                      <CountUp to={done} />
                      <span className="text-[var(--text-tertiary)]">/{total}</span>
                    </p>
                    <p className="mt-1 text-[10px] font-medium tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
                      hoje
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                {sphere.bestStreak > 0 && (
                  <Streak days={sphere.bestStreak} title={sphere.bestStreakTitle} />
                )}
                {sphere.openTasks > 0 && (
                  <span className="tabular">
                    {sphere.openTasks} {sphere.openTasks === 1 ? "tarefa" : "tarefas"}
                  </span>
                )}
                {sphere.openProjects > 0 && (
                  <span className="tabular">
                    {sphere.openProjects}{" "}
                    {sphere.openProjects === 1 ? "projeto" : "projetos"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {!sphere.isEmpty && (
          <Sparkline data={sphere.spark} width={104} height={36} className="shrink-0" />
        )}
      </div>

      {/* A barra de XP no fio da borda: o progresso dentro do nível, tingido. */}
      {level && level.span > 0 && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--bg-base)]">
          <div
            className="h-full"
            style={{
              width: `${(level.intoLevel / level.span) * 100}%`,
              background: "var(--sphere)",
            }}
          />
        </div>
      )}
    </button>
  );
}

/**
 * O contador de sequência.
 *
 * A chama esquenta nos marcos (7, 30, 100): a cor é a recompensa, e ela tem que
 * chegar em degraus para significar alguma coisa. Um gradiente contínuo faria
 * "12 dias" e "13 dias" parecerem a mesma conquista — que é o oposto do ponto.
 */
function Streak({ days, title }: { days: number; title: string | null }) {
  const tier = days >= 100 ? 3 : days >= 30 ? 2 : days >= 7 ? 1 : 0;
  const color = ["var(--text-tertiary)", "var(--warning)", "#FB923C", "#FB7185"][tier];

  return (
    <span
      className="tabular flex items-center gap-1 font-medium"
      style={{ color }}
      title={title ? `${title}: ${days} dias seguidos` : undefined}
    >
      <Flame size={11} strokeWidth={2.5} fill={tier > 0 ? color : "none"} />
      {days}
    </span>
  );
}
