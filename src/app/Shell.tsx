import { useState } from "react";
import { Outlet } from "react-router-dom";

import { Rail } from "./Rail";
import { Topbar } from "./Topbar";
import { useKeyboard } from "./useKeyboard";
import { CommandPalette } from "../features/command-palette/CommandPalette";
import { QuickCapture } from "../features/inbox/QuickCapture";
import { AporteHost } from "../features/finance/AporteHost";
import { Toaster } from "../design-system/Toaster";

export function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  useKeyboard({
    // Os dois overlays são mutuamente exclusivos: abrir um fecha o outro.
    // Empilhá-los deixaria dois campos disputando o foco e o Esc — e, desde o
    // Midnight, também dois `backdrop-filter` compondo (ver `.nx-glass`).
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
    <div className="flex h-screen overflow-hidden bg-[var(--bg-void)]">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenPalette={() => setPaletteOpen(true)}
          onQuickCapture={() => setCaptureOpen(true)}
        />
        {/* `overflow-hidden` e não `overflow-y-auto`: cada tela é dona da própria
            rolagem agora. O `.nx-page` pinta o fundo em camadas, e um container
            rolante por fora arrastaria a aurora para fora da viewport junto com
            o conteúdo — o fundo tem que ficar parado enquanto o texto rola. */}
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <QuickCapture open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <AporteHost />
      <Toaster />
    </div>
  );
}
