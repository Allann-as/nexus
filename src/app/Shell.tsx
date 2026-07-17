import { useState } from "react";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useKeyboard } from "./useKeyboard";
import { CommandPalette } from "../features/command-palette/CommandPalette";

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useKeyboard({ onOpenPalette: () => setPaletteOpen(true) });

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
