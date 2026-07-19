/**
 * O anfitrião global do timer de foco.
 *
 * Vive no Shell, acima de toda rota (como o `AporteHost`), para o botão "Focar"
 * de uma tarefa, o Ctrl+K ou a tela de Foco abrirem o timer de qualquer lugar — e
 * ele continuar correndo enquanto o usuário navega. O relógio é UM só: o
 * `setInterval` mora aqui, e o store guarda o estado (`stores/focus`).
 *
 * O FATO nasce só quando o bloco ZERA: a transição para `done` chama
 * `log_focus_session` UMA vez (o `loggedRef` impede o duplo-registro de um
 * re-render). Abandonar não grava nada — a semântica do pomodoro (ADR-0052).
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Maximize2, Minimize2, Minus, Pause, Play, Target, Timer, X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { useFocus, FOCUS_PRESETS } from "../../stores/focus";
import { logFocusSession, recentFocusSessions } from "../../lib/ipc";
import { toDay } from "../calendar/grid";

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function FocusHost() {
  const {
    open,
    status,
    ctx,
    durationMin,
    remainingSec,
    minimized,
    setDuration,
    setLabel,
    run,
    pause,
    cancel,
    tick,
    dismissDone,
    minimize,
    expand,
  } = useFocus();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const client = useQueryClient();
  const loggedRef = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);

  // "Blocos hoje": os blocos CONCLUÍDOS de hoje, para a estatística ao vivo (C8).
  const today = toDay(new Date());
  const recent = useQuery({
    queryKey: ["recent-focus"],
    queryFn: () => recentFocusSessions(),
    enabled: open,
  });
  const todaySessions = (recent.data ?? []).filter((s) => s.day === today);
  const blocksToday = todaySessions.length;
  const minutesToday = todaySessions.reduce((a, s) => a + s.minutes, 0);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // O relógio: um tick por segundo, só enquanto corre. `tick` vira `done` ao zerar.
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => tick(), 1000);
    return () => window.clearInterval(id);
  }, [status, tick]);

  // A transição para `done` grava o bloco CONCLUÍDO — uma vez só.
  useEffect(() => {
    if (status !== "done") {
      loggedRef.current = false;
      return;
    }
    if (loggedRef.current) return;
    loggedRef.current = true;
    void (async () => {
      try {
        await logFocusSession({
          taskId: ctx.taskId,
          label: ctx.taskId ? null : ctx.label,
          minutes: durationMin,
        });
        push("success", `Bloco de ${durationMin} min concluído · +10 XP`);
        void client.invalidateQueries({ queryKey: ["focus"] });
        void client.invalidateQueries({ queryKey: ["focus-stats"] });
        void client.invalidateQueries({ queryKey: ["recent-focus"] });
        void client.invalidateQueries({ queryKey: ["gamification"] });
        void client.invalidateQueries({ queryKey: ["spheres"] });
      } catch (e) {
        pushError(e);
      }
    })();
  }, [status, ctx, durationMin, push, pushError, client]);

  if (!open) return null;

  const what = ctx.taskTitle ?? ctx.label ?? "Foco livre";
  const total = durationMin * 60;
  const elapsed = total - remainingSec;
  // Correndo/pausado, a tela vira AMBIENTE: o fundo afunda no void e o anel respira.
  const immersive = status === "running" || status === "paused";

  // O anel de progresso — SVG estático que só muda de offset (sem @keyframes).
  const R = 86;
  const C = 2 * Math.PI * R;
  const pct = total > 0 ? elapsed / total : 0;
  const offset = C * (1 - pct);

  // Minimizado: uma pílula flutuante com o tempo e um toque para expandir.
  if (minimized && (status === "running" || status === "paused")) {
    return (
      <button
        onClick={expand}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full border border-[var(--border-glow)] bg-[var(--bg-surface)] px-4 py-2.5 shadow-[var(--glow-accent)]"
        title="Voltar ao Modo Foco"
      >
        <Timer size={15} className="text-[var(--accent)]" />
        <span className="tabular text-[15px] font-semibold text-[var(--text-primary)]">
          {mmss(remainingSec)}
        </span>
        {status === "paused" && (
          <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
            pausado
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={cx(
        "fixed inset-0 z-50 grid place-items-center p-4 transition-[background-color] duration-500",
        immersive
          ? "bg-[color-mix(in_srgb,var(--bg-void)_93%,transparent)]"
          : "bg-[color-mix(in_srgb,black_62%,transparent)]",
      )}
    >
      <GlassPanel className="w-full max-w-md">
        <div className="p-6">
          <header className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
              <Timer size={15} className="text-[var(--accent)]" />
              <span className="text-[11px] font-semibold tracking-[0.14em] uppercase">
                Modo Foco
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={fullscreen ? Minimize2 : Maximize2}
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
              />
              {(status === "running" || status === "paused") && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Minus}
                  onClick={minimize}
                  aria-label="Minimizar"
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={cancel}
                aria-label="Fechar"
              />
            </div>
          </header>

          {/* O que está sendo focado. */}
          <div className="mb-5 flex items-center justify-center gap-2 text-center">
            <Target size={14} className="shrink-0 text-[var(--sphere)]" />
            <span className="truncate text-[13px] text-[var(--text-secondary)]">{what}</span>
          </div>

          {/* O relógio vira AMBIENTE (C8): a geometria da marca ENVOLVE o anel, e o
              anel RESPIRA devagar enquanto corre (`.nx-loop` congela sem foco). */}
          <div className="relative mx-auto mb-5 grid size-[248px] place-items-center">
            <FocusAura />
            <div
              className={cx(
                "relative grid size-[200px] place-items-center",
                immersive &&
                  "nx-loop motion-safe:animate-[nexus-breathe_5s_ease-in-out_infinite]",
              )}
            >
              <svg width={200} height={200} viewBox="0 0 200 200" className="absolute inset-0 -rotate-90">
                <circle cx={100} cy={100} r={R} fill="none" stroke="var(--border-subtle)" strokeWidth={8} />
                <circle
                  cx={100}
                  cy={100}
                  r={R}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={8}
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={offset}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                />
              </svg>
              <div className="text-center">
                <div className="tabular text-[44px] leading-none font-semibold text-[var(--text-primary)]">
                  {mmss(remainingSec)}
                </div>
                {status === "done" ? (
                  <div className="mt-1 flex items-center justify-center gap-1 text-[13px] font-medium text-[var(--success)]">
                    <Check size={14} /> concluído
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    bloco de {durationMin} min
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* estatística da sessão ao vivo (C8): o bloco atual e os blocos de hoje. */}
          <div className="mb-5 flex items-center justify-center gap-6 text-center">
            <div>
              <div className="tabular text-[15px] font-semibold text-[var(--text-primary)]">
                {durationMin} min
              </div>
              <div className="text-[9px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
                bloco atual
              </div>
            </div>
            <div className="h-8 w-px bg-[var(--border-subtle)]" />
            <div>
              <div className="tabular text-[15px] font-semibold text-[var(--text-primary)]">
                {blocksToday}
              </div>
              <div className="text-[9px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
                blocos hoje
              </div>
            </div>
            {minutesToday > 0 && (
              <>
                <div className="h-8 w-px bg-[var(--border-subtle)]" />
                <div>
                  <div className="tabular text-[15px] font-semibold text-[var(--text-primary)]">
                    {minutesToday}
                  </div>
                  <div className="text-[9px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
                    min hoje
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Setup (idle): escolher a duração e (sem tarefa) um rótulo. */}
          {status === "idle" && (
            <div className="mb-5 flex flex-col gap-3">
              <div className="flex justify-center gap-2">
                {FOCUS_PRESETS.map((min) => (
                  <button
                    key={min}
                    onClick={() => setDuration(min)}
                    className={cx(
                      "h-9 min-w-[64px] rounded-[var(--radius-md)] border text-[13px] font-medium transition-colors duration-[var(--dur-fast)]",
                      durationMin === min
                        ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
                    )}
                  >
                    {min} min
                  </button>
                ))}
              </div>
              {!ctx.taskId && (
                <input
                  value={ctx.label ?? ""}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="No que vai focar? (opcional)"
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-center text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
                />
              )}
            </div>
          )}

          {/* Os controles, por fase. */}
          <div className="flex items-center justify-center gap-2">
            {status === "idle" && (
              <Button variant="primary" icon={Play} onClick={run} className="min-w-[140px]">
                Começar
              </Button>
            )}
            {status === "running" && (
              <Button variant="secondary" icon={Pause} onClick={pause} className="min-w-[140px]">
                Pausar
              </Button>
            )}
            {status === "paused" && (
              <>
                <Button variant="primary" icon={Play} onClick={run}>
                  Retomar
                </Button>
                <Button variant="danger" onClick={cancel}>
                  Abandonar
                </Button>
              </>
            )}
            {status === "done" && (
              <Button variant="primary" icon={Check} onClick={dismissDone} className="min-w-[140px]">
                Pronto
              </Button>
            )}
          </div>

          {status === "paused" && (
            <p className="mt-3 text-center text-[11px] text-[var(--text-tertiary)]">
              Abandonar não registra o bloco — só o pomodoro concluído conta.
            </p>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

/**
 * A geometria da marca que ENVOLVE o anel do foco (C8): anéis concêntricos e um
 * limbo graduado, na cor do accent, bem discretos. Estático — é o astrolábio do
 * fundo concentrado à volta do relógio, dando o ar de instrumento em vez de app.
 */
function FocusAura() {
  const size = 248;
  const c = size / 2;
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 6) {
    const major = deg % 30 === 0;
    const a = ((deg - 90) * Math.PI) / 180;
    const r1 = 120;
    const r2 = 120 - (major ? 7 : 3);
    ticks.push(
      <line
        key={deg}
        x1={c + r1 * Math.cos(a)}
        y1={c + r1 * Math.sin(a)}
        x2={c + r2 * Math.cos(a)}
        y2={c + r2 * Math.sin(a)}
        stroke="var(--accent)"
        strokeWidth={major ? 1.2 : 0.7}
        strokeLinecap="round"
        opacity={major ? 0.34 : 0.16}
      />,
    );
  }
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      aria-hidden
    >
      <circle cx={c} cy={c} r={120} stroke="var(--accent)" strokeWidth="0.8" opacity="0.18" />
      <circle
        cx={c}
        cy={c}
        r={106}
        stroke="var(--border-strong)"
        strokeWidth="1"
        strokeDasharray="2 6"
        opacity="0.4"
      />
      <g>{ticks}</g>
    </svg>
  );
}
