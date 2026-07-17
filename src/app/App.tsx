import { useEffect } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Shell } from "./Shell";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import {
  InboxScreen,
  TodayScreen,
  CalendarScreen,
  HabitsScreen,
  GoalsScreen,
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
      { path: "today", element: <TodayScreen /> },
      { path: "calendar", element: <CalendarScreen /> },
      { path: "habits", element: <HabitsScreen /> },
      { path: "goals", element: <GoalsScreen /> },
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
