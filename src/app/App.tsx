import { useEffect } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Shell } from "./Shell";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { InboxScreen } from "../features/inbox/InboxScreen";
import { AreasScreen } from "../features/areas/AreasScreen";
import { HabitsScreen } from "../features/habits/HabitsScreen";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import {
  TodayScreen,
  CalendarScreen,
  NotesScreen,
  TimelineScreen,
  InsightsScreen,
} from "../features/screens";
import { useUi, applyTheme } from "../stores/ui";

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
      { index: true, element: <DashboardScreen /> },
      { path: "inbox", element: <InboxScreen /> },
      { path: "areas", element: <AreasScreen /> },
      // A tela da Área (visão consolidada) chega no M2, quando existir conteúdo
      // para consolidar. Por ora o id cai na lista — melhor que uma rota morta.
      { path: "areas/:id", element: <AreasScreen /> },
      { path: "today", element: <TodayScreen /> },
      { path: "calendar", element: <CalendarScreen /> },
      { path: "habits", element: <HabitsScreen /> },
      { path: "goals", element: <ProjectsScreen /> },
      { path: "notes", element: <NotesScreen /> },
      { path: "timeline", element: <TimelineScreen /> },
      { path: "insights", element: <InsightsScreen /> },
      { path: "settings", element: <SettingsScreen /> },
    ],
  },
]);

export function App() {
  const theme = useUi((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
