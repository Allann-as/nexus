/**
 * Terminar um livro: a nota em estrelas + uma frase de resenha.
 *
 * `finishBook` faz o resto no backend — marca 'lido', grava a conquista no
 * ledger e transforma a resenha numa nota linkada. Aqui é só o gesto: as
 * estrelas, a frase, e o botão que conclui.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { GlassPanel } from "../../design-system/cards";
import { Button } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { finishBook, type Book } from "../../lib/ipc";
import { Stars } from "./Stars";

export function FinishBookModal({
  book,
  onClose,
  onDone,
}: {
  book: Book;
  onClose: () => void;
  onDone: () => void;
}) {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [rating, setRating] = useState<number>(book.rating ?? 0);
  const [review, setReview] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await finishBook(
        book.id,
        rating > 0 ? rating : null,
        review.trim() || null,
      );
      push("success", "Leitura concluída");
      onDone();
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] grid place-items-center bg-[color-mix(in_srgb,black_55%,transparent)] p-4"
    >
      <GlassPanel className="w-full max-w-md">
        <div onClick={(e) => e.stopPropagation()} className="p-5">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Terminar livro
              </h2>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-tertiary)]">
                {book.title}
              </p>
            </div>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] py-4">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                Quantas estrelas?
              </span>
              <Stars value={rating} onChange={setRating} size={30} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                Uma frase (vira nota)
              </span>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                rows={3}
                placeholder="Uma frase sobre o livro…"
                className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[13px] leading-[20px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={saving}>
                Concluir leitura
              </Button>
            </div>
          </div>
        </div>
      </GlassPanel>
    </div>
  );
}
