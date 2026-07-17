import { useState } from "react";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useKeyboard } from "./useKeyboard";
import { CommandPalette } from "../features/command-palette/CommandPalette";
import { QuickCapture } from "../features/inbox/QuickCapture";
import { Toaster } from "../design-system/Toaster";

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  useKeyboard({
    // Os dois overlays são mutuamente exclusivos: abrir um fecha o outro.
    // Empilhá-los deixaria dois campos disputando o foco e o Esc.
    onOpenPalette: () => {
      setCaptureOpen(false);
      setPaletteOpen(true);
    },
    onQuickCapture: () => {
      setPaletteOpen(false);
      setCaptureOpen(true);
    },
  });

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenPalette={() => setPaletteOpen(true)}
          onQuickCapture={() => setCaptureOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickCapture open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <Toaster />
    </div>
  );
}
