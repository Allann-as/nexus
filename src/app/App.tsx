import { useEffect, useState } from "react";
import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import { Shell } from "./Shell";
import { HubScreen } from "../features/hub/HubScreen";
import { SphereScreen } from "../features/spheres/SphereScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { InboxScreen } from "../features/inbox/InboxScreen";
import { AreasScreen } from "../features/areas/AreasScreen";
import { HabitsScreen } from "../features/habits/HabitsScreen";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import { GoalsScreen } from "../features/goals/GoalsScreen";
import { CalendarScreen } from "../features/calendar/CalendarScreen";
import { InsightsScreen } from "../features/insights/InsightsScreen";
import { GamificationScreen } from "../features/gamification/GamificationScreen";
import { AnnualGoalsScreen } from "../features/annual-goals/AnnualGoalsScreen";
import { ObjectivesScreen } from "../features/objectives/ObjectivesScreen";
import { PerfectWeeksScreen } from "../features/perfect-weeks/PerfectWeeksScreen";
import { RecordsScreen } from "../features/records/RecordsScreen";
import { YearPixelsScreen } from "../features/year-pixels/YearPixelsScreen";
import { CompareScreen } from "../features/compare/CompareScreen";
import { RetrospectiveScreen } from "../features/retrospective/RetrospectiveScreen";
import { NotesScreen } from "../features/notes/NotesScreen";
import { TimelineScreen } from "../features/timeline/TimelineScreen";
import { FocusScreen } from "../features/focus/FocusScreen";
import { WeeklyReviewScreen } from "../features/weekly-review/WeeklyReviewScreen";
import { DesignSystemScreen } from "../features/design-system/DesignSystemScreen";
import {
  useUi,
  applyTheme,
  applyDensity,
  applyReducedMotion,
  applyBackgroundMotion,
} from "../stores/ui";
import { useLock } from "../stores/lock";
import { lockStatus } from "../lib/ipc";
import { LockScreen } from "../features/lock/LockScreen";
import { OnboardingScreen } from "../features/lock/OnboardingScreen";
import { Starfield } from "../design-system/Starfield";
import { NexusMark } from "../design-system/NexusMark";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend is a local SQLite file, not a network service: there is no
      // flaky link to retry across, and a failure here is a real bug worth
      // surfacing immediately rather than masking with retries.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

// Hash routing: the production app loads over the tauri:// protocol, where
// history-based routing has no server to resolve deep paths against.
const router = createHashRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <HubScreen /> },
      { path: "sphere/:id", element: <SphereScreen /> },
      { path: "inbox", element: <InboxScreen /> },
      // `/areas` é a tela de GERÊNCIA (criar, renomear, arquivar). A tela de
      // uso de uma Esfera é `/sphere/:id`, e é para lá que todo link do produto
      // aponta. Duas telas porque são duas perguntas: "quero usar a Saúde" e
      // "quero mexer nas minhas Esferas" não são o mesmo gesto.
      { path: "areas", element: <AreasScreen /> },
      // Rota antiga: `/areas/:id` era a "visão da Área" prometida para o M2.
      // Ela existe — virou o Hub e a tela de Esfera. Redireciona em vez de
      // deixar um link velho (num favorito, num atalho) cair numa tela morta.
      { path: "areas/:id", element: <SphereRedirect /> },
      // `/today` (stub do M0) morreu no M2.5: o Hub É o hoje. A rota some junto
      // com a tela — uma rota que não está em nenhuma navegação nem em nenhum
      // atalho é código que ninguém executa.
      { path: "calendar", element: <CalendarScreen /> },
      { path: "habits", element: <HabitsScreen /> },
      { path: "goals", element: <GoalsScreen /> },
      { path: "projects", element: <ProjectsScreen /> },
      { path: "notes", element: <NotesScreen /> },
      { path: "timeline", element: <TimelineScreen /> },
      { path: "focus", element: <FocusScreen /> },
      { path: "review", element: <WeeklyReviewScreen /> },
      { path: "insights", element: <InsightsScreen /> },
      { path: "game", element: <GamificationScreen /> },
      { path: "annual-goals", element: <AnnualGoalsScreen /> },
      { path: "objectives", element: <ObjectivesScreen /> },
      { path: "perfect-weeks", element: <PerfectWeeksScreen /> },
      { path: "records", element: <RecordsScreen /> },
      { path: "year-pixels", element: <YearPixelsScreen /> },
      { path: "compare", element: <CompareScreen /> },
      { path: "retrospective", element: <RetrospectiveScreen /> },
      { path: "settings", element: <SettingsScreen /> },
      // A vitrine do design system Cockpit (§1). Fora da rail; alcançável por
      // `G+d` e pela paleta. É o banco de provas da linguagem visual.
      { path: "design-system", element: <DesignSystemScreen /> },
    ],
  },
]);

/** `/areas/:id` (rota do M0) → `/sphere/:id`. `replace` para o Voltar não pingar. */
function SphereRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/sphere/${id}` : "/areas"} replace />;
}

export function App() {
  const theme = useUi((s) => s.theme);
  const density = useUi((s) => s.density);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const backgroundMotion = useUi((s) => s.backgroundMotion);
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyDensity(density), [density]);
  useEffect(() => applyReducedMotion(reducedMotion), [reducedMotion]);
  useEffect(() => applyBackgroundMotion(backgroundMotion), [backgroundMotion]);

  // A6 — higiene de segundo plano. O navegador só pausa animações com a janela
  // MINIMIZADA (document.hidden); atrás do trabalho pesado ela segue visível e
  // sem foco, e o compositor gira o astrolábio e corre as listras à toa. Marca
  // `data-window-idle` quando a janela perde o foco ou some; o CSS congela só as
  // animações em loop (`.nx-loop`), nunca as transições de gesto (tokens.css).
  useEffect(() => {
    const root = document.documentElement;
    const setIdle = (idle: boolean) => {
      root.dataset.windowIdle = idle ? "true" : "false";
    };
    const onVisibility = () => setIdle(document.hidden);
    const onBlur = () => setIdle(true);
    const onFocus = () => setIdle(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    setIdle(document.hidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <LockGate />
    </QueryClientProvider>
  );
}

/**
 * A cortina do boot (M5.5 §3.5 · fase 9). No boot, lê `lock_status` e decide entre
 * TRÊS aberturas: o ONBOARDING (nunca houve senha — primeiro acesso), o BLOQUEIO
 * (há PIN ativo) ou direto para o app (PIN desligado). `Ctrl+L` bloqueia à mão a
 * qualquer momento. Fica ACIMA do router — cobre o app inteiro, topbar incluída.
 */
function LockGate() {
  const locked = useLock((s) => s.locked);
  const setEnabled = useLock((s) => s.setEnabled);
  const qc = useQueryClient();
  // `true` = primeiro acesso, sem senha cadastrada. `null` até o boot responder —
  // não pisca uma tela antes de saber qual das três abrir.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    lockStatus()
      .then((s) => {
        if (!alive) return;
        setEnabled(s.enabled);
        setOnboarding(!s.configured);
        if (s.configured && s.enabled) useLock.setState({ locked: true });
      })
      .catch(() => {
        if (alive) setOnboarding(false);
      });
    return () => {
      alive = false;
    };
  }, [setEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        useLock.getState().lock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // BOOT sem flash (fase 11, BUG 5): enquanto `lock_status` não respondeu
  // (`onboarding === null`), NÃO deixamos o Hub aparecer atrás. Uma cortina neutra
  // com a marca cobre tudo até sabermos qual das três aberturas mostrar. Como a
  // resolução "há PIN ativo" seta `onboarding=false` e `locked=true` no mesmo tick,
  // a cortina dá lugar ao BLOQUEIO direto — nunca ao Hub. O router segue montado
  // atrás (preserva o estado ao bloquear com Ctrl+L no meio do uso).
  if (onboarding === null) return <BootSplash />;

  if (onboarding) {
    return (
      <OnboardingScreen
        onDone={() => {
          // A senha e o nome já estão gravados. Entra no app: passa a existir
          // cadastro (bloqueio LIGADO), mas desbloqueado agora. As telas que leem
          // essas fontes revalidam.
          setOnboarding(false);
          setEnabled(true);
          useLock.setState({ locked: false });
          qc.invalidateQueries({ queryKey: ["lock-status"] });
          qc.invalidateQueries({ queryKey: ["app-settings"] });
        }}
      />
    );
  }

  return locked ? <LockScreen /> : null;
}

/**
 * A CORTINA de boot (fase 11, BUG 5) — a marca sobre a poeira estelar, enquanto o
 * `lock_status` não respondeu. Neutra de propósito: sem teclado (ainda não sabemos
 * se há PIN) e sem Hub (que seria o "flash de conteúdo autenticado" que este ecrã
 * existe para matar). Fica no ar por uma fração de segundo — o tempo de uma leitura
 * local ao SQLite — e some assim que a abertura certa é decidida.
 */
function BootSplash() {
  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[var(--bg-base)]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Starfield color="var(--accent)" />
      </div>
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-5">
        <NexusMark size={76} plate glow />
        <span className="font-mono text-[13px] font-bold tracking-[0.28em] text-[var(--text-secondary)]">
          NEXUS
        </span>
      </div>
    </div>
  );
}
