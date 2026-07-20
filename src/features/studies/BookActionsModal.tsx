/**
 * O modal de ações de um livro, aberto do card.
 *
 * Aqui o livro se move pela vida: muda de status, avança as páginas, ganha uma
 * estante e — o gesto de honra — termina. "Terminar livro" abre o
 * `FinishBookModal`, que grava a conquista e vira a resenha em nota.
 *
 * Mesma casca (GlassPanel + Escape) do DepositModal.
 */

import { useState } from "react";
import { CheckCircle2, X } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Modal } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  deleteNode,
  setBookProgress,
  setBookRating,
  setBookShelf,
  setBookStatus,
  type Book,
  type BookStatus,
} from "../../lib/ipc";
import { coverStyle, bookInitials } from "./bookCover";
import { STATUS_META } from "./BookCard";
import { Stars } from "./Stars";
import { FinishBookModal } from "./FinishBookModal";

/** Os status que o usuário troca à mão. 'lido' não está aqui — vai pelo finish. */
const STATUS_PILLS: BookStatus[] = ["fila", "lendo", "abandonado"];

export function BookActionsModal({
  book,
  shelves,
  onClose,
  onChanged,
}: {
  book: Book;
  /** As estantes que já existem — viram pills de atalho. */
  shelves: string[];
  onClose: () => void;
  /** Chamado após qualquer mutação (o pai revalida e recarrega o `book`). */
  onChanged: () => void;
}) {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [page, setPage] = useState(String(book.currentPage || ""));
  const [newShelf, setNewShelf] = useState("");
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Cada ação segue o mesmo esqueleto: trava, chama o IPC, avisa e revalida.
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      push("success", msg);
      onChanged();
    } catch (e) {
      pushError(e);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = (s: BookStatus) => {
    if (s === book.status) return;
    void run(() => setBookStatus(book.id, s), "Status atualizado");
  };

  const saveProgress = () => {
    const n = Number(page);
    if (!Number.isFinite(n) || n < 0) return;
    void run(() => setBookProgress(book.id, Math.round(n)), "Página atualizada");
  };

  const chooseShelf = (shelf: string | null) => {
    const next = shelf === book.shelf ? null : shelf;
    void run(() => setBookShelf(book.id, next), next ? "Estante definida" : "Estante removida");
  };

  const rate = (n: number) => {
    void run(() => setBookRating(book.id, n > 0 ? n : null), "Avaliação salva");
  };

  /* "Abandonado" era a única saída de um livro, e ela mente: abandonar é uma
     leitura que aconteceu e parou, não um livro digitado errado. Excluir é para o
     segundo caso — tira o livro do ESTADO da estante e fecha o modal, porque a
     tela por trás não tem mais o que mostrar. O que já foi lido nele continua no
     ledger (ADR-0056). */
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteNode(book.id);
      push("success", "Livro excluído");
      onChanged();
      onClose();
    } catch (e) {
      pushError(e);
      setBusy(false);
    }
  };

  return (
    <>
      <Modal onClose={onClose}>
        <div className="p-5">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)]"
                style={coverStyle(book.title)}
              >
                <span className="text-[20px] font-bold text-white/85">
                  {bookInitials(book.title)}
                </span>
              </div>
              <div className="min-w-0">
                <h2 className="line-clamp-2 text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
                  {book.title}
                </h2>
                {book.author && (
                  <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-tertiary)]">
                    {book.author}
                  </p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            {/* ===== Status ===== */}
            <Field label="Status">
              <div className="flex flex-wrap gap-1.5">
                {STATUS_PILLS.map((s) => (
                  <Pill key={s} active={book.status === s} onClick={() => changeStatus(s)}>
                    {STATUS_META[s].label}
                  </Pill>
                ))}
                {book.status === "lido" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--sphere)]">
                    <CheckCircle2 size={12} />
                    Lido
                  </span>
                )}
              </div>
            </Field>

            {/* ===== Página atual ===== */}
            <Field
              label={
                book.totalPages
                  ? `Página atual (de ${book.totalPages})`
                  : "Página atual"
              }
            >
              <div className="flex items-center gap-2">
                <input
                  value={page}
                  onChange={(e) => setPage(e.target.value.replace(/[^\d]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProgress();
                  }}
                  inputMode="numeric"
                  placeholder="0"
                  className="tabular h-10 w-28 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[15px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
                />
                <Button variant="secondary" size="sm" onClick={saveProgress} disabled={busy}>
                  Salvar página
                </Button>
              </div>
            </Field>

            {/* ===== Avaliação ===== */}
            <Field label="Sua nota">
              <Stars value={book.rating} onChange={rate} size={22} />
            </Field>

            {/* ===== Estante ===== */}
            <Field label="Estante">
              <div className="flex flex-wrap gap-1.5">
                {shelves.map((s) => (
                  <Pill key={s} active={book.shelf === s} onClick={() => chooseShelf(s)}>
                    {s}
                  </Pill>
                ))}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  value={newShelf}
                  onChange={(e) => setNewShelf(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newShelf.trim()) {
                      chooseShelf(newShelf.trim());
                      setNewShelf("");
                    }
                  }}
                  placeholder="Nova estante…"
                  className="h-9 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !newShelf.trim()}
                  onClick={() => {
                    chooseShelf(newShelf.trim());
                    setNewShelf("");
                  }}
                >
                  Definir
                </Button>
              </div>
            </Field>

            {/* ===== Terminar ===== */}
            {book.status !== "lido" && (
              <Button
                variant="primary"
                icon={CheckCircle2}
                onClick={() => setFinishing(true)}
                className="mt-1 w-full"
              >
                Terminar livro
              </Button>
            )}

            {/* A saída fica no pé, separada por uma linha: é o último gesto do
                modal, e o único que não tem volta pela tela. */}
            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-3">
              <ArmedDelete
                onConfirm={() => void remove()}
                pending={busy}
                question="Excluir este livro?"
                label="Excluir livro"
                ariaLabel="Excluir livro"
              />
            </div>
          </div>
        </div>
      </Modal>

      {finishing && (
        <FinishBookModal
          book={book}
          onClose={() => setFinishing(false)}
          onDone={() => {
            setFinishing(false);
            onChanged();
            onClose();
          }}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
      )}
    >
      {children}
    </button>
  );
}
