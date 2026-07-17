/**
 * Quick Capture (Ctrl+Shift+N).
 *
 * Um único input. Enter salva, Esc fecha. Sem área, sem tipo, sem prioridade —
 * decidir onde algo vive é justamente o trabalho que a captura adia. Exigir a
 * decisão agora é o que faz as pessoas simplesmente não capturarem.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";

import { captureInbox } from "../../lib/ipc";
import { Kbd } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

export function QuickCapture({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const capture = useMutation({
    mutationFn: captureInbox,
    onSuccess: (node) => {
      // Ambas as chaves: o badge do Inbox e a lista do Inbox.
      qc.invalidateQueries({ queryKey: ["nodes"] });
      qc.invalidateQueries({ queryKey: ["system-info"] });
      push("success", `Capturado: ${node.title}`);
      setTitle("");
      onClose();
    },
    onError: (e) => {
      // Não fecha e não limpa: o texto continua lá para a pessoa corrigir e
      // tentar de novo. Fechar aqui perderia o que ela escreveu.
      pushError(e);
    },
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || capture.isPending) return;
    capture.mutate(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[22vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Captura rápida"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[520px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-raised)]"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-center gap-2.5 px-4 pt-3.5">
          <Inbox size={13} className="text-[var(--text-tertiary)]" />
          <span className="text-[11px] font-medium tracking-[0.06em] text-[var(--text-tertiary)] uppercase">
            Captura rápida
          </span>
        </div>

        <input
          ref={inputRef}
          value={title}
          disabled={capture.isPending}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="O que está na sua cabeça?"
          className="w-full bg-transparent px-4 py-3 text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] disabled:opacity-50"
        />

        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
          <span className="flex items-center gap-1">
            <Kbd>enter</Kbd> salvar
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> fechar
          </span>
          <span className="flex-1" />
          <span>Vai para o Inbox — decida depois</span>
        </div>
      </div>
    </div>
  );
}
