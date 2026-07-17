/**
 * O HUB — a primeira tela do NEXUS.
 *
 * Substitui o Dashboard v1, que era uma tela sobre HOJE (hábitos + tarefas +
 * score). O Hub é uma tela sobre a VIDA: as Esferas, cada uma com sinal vital
 * próprio. O "hoje" não sumiu — virou a faixa de baixo e o gauge do topo.
 *
 * Ordem de leitura, de propósito: saudação (você) → score (seu dia) → Esferas
 * (sua vida) → hoje (seu próximo passo). Quem abre o app às 7h quer o terceiro
 * e o quarto; quem abre às 23h quer o segundo.
 *
 * Custo: duas queries — `sphere_overview` (a grade) e `dashboard_today` (o gauge
 * e a faixa). Nenhuma delas cresce com o tamanho da história.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Info, Plus, Settings } from "lucide-react";

import { dashboardToday, sphereOverview, toNexusError } from "../../lib/ipc";
import { Button, cx } from "../../design-system/primitives";
import { Gauge } from "../../design-system/charts";
import { ScoreDetail } from "./ScoreDetail";
import { SphereCard } from "./SphereCard";
import { TodayStrip } from "./TodayStrip";

export function HubScreen() {
  const navigate = useNavigate();
  const [showMath, setShowMath] = useState(false);

  const spheres = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview });
  const today = useQuery({ queryKey: ["dashboard", "today"], queryFn: dashboardToday });

  // Atalhos 1–9: abre a Esfera daquela posição. O Hub é a tela mais aberta do
  // app, e teclado-primeiro é regra da constituição.
  const list = spheres.data ?? [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const sphere = list[n - 1];
      if (sphere) navigate(`/sphere/${sphere.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, navigate]);

  const error = spheres.error ?? today.error;
  if (error) {
    return (
      <div className="nx-page h-full p-8">
        <div className="rounded-[var(--radius-lg)] border border-[var(--danger)] bg-[var(--bg-surface)] p-4">
          <p className="text-[13px] text-[var(--danger)]">{toNexusError(error).message}</p>
        </div>
      </div>
    );
  }

  const score = today.data?.score;

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-8 pt-10 pb-12">
        {/* ===== saudação + score ===== */}
        <header className="flex items-start justify-between gap-8">
          <div className="pt-2">
            <h1 className="text-[30px] leading-[36px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              {greeting()}, Allan
            </h1>
            <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
              {today.data ? formatDay(today.data.day) : " "}
            </p>

            <div className="mt-5 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={() => navigate("/areas")}
              >
                Nova Esfera
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Settings}
                onClick={() => navigate("/settings")}
              >
                Configurações
              </Button>
            </div>
          </div>

          <div className="relative flex shrink-0 flex-col items-center">
            <Gauge
              value={score?.value ?? null}
              size={140}
              label="Nexus Score"
              color={scoreColor(score?.value ?? null)}
            />
            {score && (
              <button
                onClick={() => setShowMath((s) => !s)}
                className={cx(
                  "mt-1 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px]",
                  "transition-colors duration-[var(--dur-fast)]",
                  showMath
                    ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                )}
              >
                <Info size={10} />
                como calculamos
              </button>
            )}
            {showMath && score && (
              <ScoreDetail score={score} onClose={() => setShowMath(false)} />
            )}
          </div>
        </header>

        {/* ===== a grade de Esferas ===== */}
        <section className="mt-8">
          <SectionLabel>Suas Esferas</SectionLabel>

          {spheres.isPending ? (
            <SkeletonGrid />
          ) : list.length === 0 ? (
            <div className="mt-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] p-10 text-center">
              <p className="text-[13px] text-[var(--text-tertiary)]">
                Nenhuma Esfera ativa. Todas arquivadas?
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => navigate("/areas")}
              >
                Gerenciar Esferas
              </Button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-4">
              {list.map((sphere, i) => (
                <SphereCard key={sphere.id} sphere={sphere} index={i} />
              ))}
            </div>
          )}
        </section>

        {/* ===== hoje ===== */}
        <section className="mt-8">
          <SectionLabel>Hoje</SectionLabel>
          <TodayStrip data={today.data} isPending={today.isPending} />
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
      {children}
    </h2>
  );
}

/** Placeholder com a forma final do card — o layout não pula quando os dados chegam. */
function SkeletonGrid() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cx(
            "h-[196px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]",
            "animate-pulse",
          )}
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

/** A saudação segue o relógio do usuário — é a única parte da tela que fala com ele. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function formatDay(day: string): string {
  const s = new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreColor(v: number | null): string {
  if (v == null) return "var(--text-tertiary)";
  if (v >= 80) return "var(--success)";
  if (v >= 50) return "var(--accent)";
  if (v >= 25) return "var(--warning)";
  return "var(--danger)";
}
