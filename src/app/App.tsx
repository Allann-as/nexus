import { useEffect } from "react";
import { createHashRouter, Navigate, RouterProvider, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
import { NotesScreen } from "../features/notes/NotesScreen";
import { TimelineScreen } from "../features/timeline/TimelineScreen";
import { FocusScreen } from "../features/focus/FocusScreen";
import { WeeklyReviewScreen } from "../features/weekly-review/WeeklyReviewScreen";
import { useUi, applyTheme, applyDensity, applyReducedMotion } from "../stores/ui";

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
      { path: "settings", element: <SettingsScreen /> },
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
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyDensity(density), [density]);
  useEffect(() => applyReducedMotion(reducedMotion), [reducedMotion]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
