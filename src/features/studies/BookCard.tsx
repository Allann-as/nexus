/**
 * Um card da estante: a capa gerada (com as iniciais e um chip de status), o
 * título, o autor, as estrelas e — para quem está lendo — uma barra fina de
 * páginas. Clicar abre o modal de ações.
 *
 * "lido" ganha um tratamento tingido de discreto; o hover eleva, como todo card
 * clicável do Midnight.
 */

import type { BookStatus, Book } from "../../lib/ipc";
import { ProgressBar } from "../../design-system/charts";
import { cx } from "../../design-system/primitives";
import { coverStyle, bookInitials } from "./bookCover";
import { Stars } from "./Stars";

/** O rótulo e o tom de cada status — um lugar só, reusado nos pills e chips. */
export const STATUS_META: Record<BookStatus, { label: string }> = {
  fila: { label: "Na fila" },
  lendo: { label: "Lendo" },
  lido: { label: "Lido" },
  abandonado: { label: "Abandonado" },
};

export function BookCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const done = book.status === "lido";
  const reading = book.status === "lendo";
  const pct =
    book.totalPages && book.totalPages > 0
      ? book.currentPage / book.totalPages
      : 0;

  return (
    <button
      onClick={onOpen}
      className={cx(
        "group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border text-left",
        "transition-[border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:-translate-y-0.5",
        done
          ? "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_8%,var(--bg-surface))]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-glow)]",
      )}
    >
      {/* ===== A capa ===== */}
      <div
        className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden"
        style={coverStyle(book.title)}
      >
        {/* As iniciais, gigantes e translúcidas — a "tipografia de capa". */}
        <span className="select-none text-[52px] font-bold tracking-[-0.04em] text-white/85">
          {bookInitials(book.title)}
        </span>

        {/* O chip de status, canto superior. */}
        <span
          className={cx(
            "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm",
            done
              ? "bg-[color-mix(in_srgb,var(--sphere)_75%,black)] text-white"
              : "bg-black/45 text-white/90",
          )}
        >
          {STATUS_META[book.status].label}
        </span>

        {/* Um véu embaixo para o gradiente não competir com o texto do corpo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
          style={{ background: "linear-gradient(to top, rgb(0 0 0 / 0.35), transparent)" }}
        />
      </div>

      {/* ===== O corpo ===== */}
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-tight text-[var(--text-primary)]">
          {book.title}
        </h3>
        {book.author && (
          <p className="truncate text-[11.5px] text-[var(--text-tertiary)]">{book.author}</p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1.5">
          {book.rating != null && book.rating > 0 && (
            <Stars value={book.rating} size={13} />
          )}

          {reading && book.totalPages != null && book.totalPages > 0 && (
            <div className="flex flex-col gap-1">
              <ProgressBar value={pct} height={5} />
              <span className="tabular text-[10.5px] text-[var(--text-tertiary)]">
                {book.currentPage}/{book.totalPages} págs · {Math.round(pct * 100)}%
              </span>
            </div>
          )}

          {book.shelf && (
            <span className="w-fit rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
              {book.shelf}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
