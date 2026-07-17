/**
 * A camada global de teclado. Teclado-primeiro é regra da constituição, então a
 * tabela de atalhos mora no shell em vez de espalhada pelas features.
 *
 * Ctrl+K (paleta), Ctrl+Shift+N (captura rápida) e os chords `G+<tecla>`.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { JUMP_TARGETS } from "./navigation";

/** Janela do chord: longa o bastante para não ser corrida, curta o bastante
 *  para um `G` perdido não teleportar alguém que voltou a digitar depois. */
const CHORD_MS = 800;

/**
 * Um chord `G+<tecla>` está no meio do caminho?
 *
 * Módulo-nível porque o `useKeyboard` é único (vive no Shell) e a pergunta é
 * global: uma tela com atalhos de letra solta precisa saber que a próxima tecla
 * já tem dono. `G` depois `T` é "vá para a Timeline" — sem esta guarda, o
 * calendário ATENDERIA o mesmo `T` como "vá para hoje" e faria as duas coisas
 * com uma tecla só. Vale para o `M` (Metas / mês) pelo mesmo motivo.
 */
let chordPending = false;
export const isChordPending = () => chordPending;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
  );
}

export function useKeyboard({
  onOpenPalette,
  onQuickCapture,
}: {
  onOpenPalette: () => void;
  onQuickCapture: () => void;
}) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Ctrl+Shift+N antes de Ctrl+K: com Shift, `key` é 'n' de qualquer forma,
      // mas a ordem deixa explícito qual atalho ganha.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "n") {
        e.preventDefault();
        onQuickCapture();
        return;
      }

      // Ctrl+K funciona mesmo de dentro de um campo — é a saída de emergência.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Daqui para baixo são letras soltas: nunca podem disparar digitando.
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

      if (pendingG.current) {
        pendingG.current = false;
        chordPending = false;
        window.clearTimeout(timer.current);
        const target = JUMP_TARGETS.find((i) => i.jumpKey === key);
        if (target) {
          e.preventDefault();
          navigate(target.path);
        }
        return;
      }

      if (key === "g") {
        pendingG.current = true;
        chordPending = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          pendingG.current = false;
          chordPending = false;
        }, CHORD_MS);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer.current);
      chordPending = false;
    };
  }, [navigate, onOpenPalette, onQuickCapture]);
}
