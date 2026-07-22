/**
 * A Biblioteca — a "estante visual" dos Estudos (§2.2).
 *
 * No topo, a meta anual de leitura: um anel de `terminados / meta` com a linha
 * de ritmo. Embaixo, os filtros (status, estante, nota) e a grade de capas. É a
 * tela que convida a encher a estante e a olhar o quanto já leu no ano.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Library, Plus, Star } from "lucide-react";

import { CountUp } from "../../design-system/cards";
import { ProgressRing } from "../../design-system/charts";
import { Formula } from "../../design-system/Formula";
import { Button, EmptyState, cx } from "../../design-system/primitives";
import {
  listBooks,
  readingStats,
  studiesOverview,
  type Book,
  type BookStatus,
  type ReadingStats,
} from "../../lib/ipc";
import { BookCard, STATUS_META } from "./BookCard";
import { BookActionsModal } from "./BookActionsModal";
import { NewBookModal } from "./NewBookModal";
import { computePace, SetGoalInline } from "./readingGoal";

type StatusFilter = "todos" | BookStatus;

const STATUS_FILTERS: StatusFilter[] = ["todos", "fila", "lendo", "lido", "abandonado"];

export function LibraryTab({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const [openBook, setOpenBook] = useState<Book | null>(null);
  const [creating, setCreating] = useState(false);

  const [status, setStatus] = useState<StatusFilter>("todos");
  const [shelf, setShelf] = useState<string | null>(null);
  const [minStars, setMinStars] = useState(0);

  const books = useQuery({
    queryKey: ["books", areaId],
    queryFn: () => listBooks(areaId),
  });
  const overview = useQuery({
    queryKey: ["studies", areaId],
    queryFn: () => studiesOverview(areaId),
  });
  const stats = useQuery({
    queryKey: ["reading-stats", areaId],
    queryFn: () => readingStats(areaId),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["books"] });
    void client.invalidateQueries({ queryKey: ["studies"] });
    void client.invalidateQueries({ queryKey: ["ledger"] });
    // Um livro que entra, termina ou some da estante mexe no ritmo de leitura,
    // na contagem de nós e no que as Esferas mostram lá fora.
    void client.invalidateQueries({ queryKey: ["reading-stats"] });
    void client.invalidateQueries({ queryKey: ["nodes", "count"] });
    void client.invalidateQueries({ queryKey: ["gamification"] });
    void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
  };

  const all = books.data ?? [];

  // As estantes distintas, para os pills de filtro — memo porque roda a cada
  // render de filtro e a lista de livros não muda no meio disso.
  const shelves = useMemo(() => {
    const set = new Set<string>();
    for (const b of all) if (b.shelf) set.add(b.shelf);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [all]);

  const filtered = useMemo(() => {
    return all.filter((b) => {
      if (status !== "todos" && b.status !== status) return false;
      if (shelf && b.shelf !== shelf) return false;
      if (minStars > 0 && (b.rating ?? 0) < minStars) return false;
      return true;
    });
  }, [all, status, shelf, minStars]);

  // O `book` do modal vem sempre da query fresca: depois de uma mutação o pai
  // revalida, e o modal tem que ver a página nova — não a cópia congelada do
  // clique.
  const activeBook = openBook ? all.find((b) => b.id === openBook.id) ?? openBook : null;

  const ov = overview.data;
  const goal = ov?.readingGoal ?? null;
  const finished = ov?.finishedThisYear ?? 0;

  return (
    <div className="nx-enter">
      {/* ===== Meta anual ===== */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        {goal != null && goal > 0 ? (
          <GoalWidget finished={finished} goal={goal} year={ov?.year ?? ""} />
        ) : (
          <div className="flex flex-col gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Meta de leitura
              </h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary)]">
                Quantos livros você quer ler neste ano?
              </p>
            </div>
            <SetGoalInline onSaved={refresh} />
          </div>
        )}

        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Adicionar livro
        </Button>
      </header>

      {/* ===== Estatísticas de leitura ===== */}
      {stats.data && <ReadingStatsRow stats={stats.data} />}

      {/* ===== Filtros ===== */}
      {all.length > 0 && (
        <div className="mb-5 flex flex-col gap-2.5">
          <FilterRow>
            {STATUS_FILTERS.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s === "todos" ? "Todos" : STATUS_META[s].label}
              </Chip>
            ))}
          </FilterRow>

          {shelves.length > 0 && (
            <FilterRow>
              <Chip active={shelf === null} onClick={() => setShelf(null)}>
                Todas as estantes
              </Chip>
              {shelves.map((s) => (
                <Chip key={s} active={shelf === s} onClick={() => setShelf(shelf === s ? null : s)}>
                  {s}
                </Chip>
              ))}
            </FilterRow>
          )}

          <FilterRow>
            {[0, 3, 4, 5].map((n) => (
              <Chip key={n} active={minStars === n} onClick={() => setMinStars(n)}>
                {n === 0 ? (
                  "Qualquer nota"
                ) : (
                  <span className="inline-flex items-center gap-0.5">
                    {n}
                    <Star size={11} className="fill-current" aria-hidden />+
                  </span>
                )}
              </Chip>
            ))}
          </FilterRow>
        </div>
      )}

      {/* ===== A estante ===== */}
      {books.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-[3/4] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={Library}
          title="Sua estante está vazia"
          hint="Adicione um livro — o que está lendo agora, ou o próximo da fila — e acompanhe as páginas até o fim."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Adicionar livro
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title="Nenhum livro com esses filtros"
          hint="Afrouxe os filtros para ver mais da estante."
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((book) => (
            <BookCard key={book.id} book={book} onOpen={() => setOpenBook(book)} />
          ))}
        </div>
      )}

      {activeBook && (
        <BookActionsModal
          book={activeBook}
          shelves={shelves}
          onClose={() => setOpenBook(null)}
          onChanged={refresh}
        />
      )}

      {creating && (
        <NewBookModal
          areaId={areaId}
          shelves={shelves}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** O widget da meta: o anel + o número + a linha de ritmo. */
function GoalWidget({
  finished,
  goal,
  year,
}: {
  finished: number;
  goal: number;
  year: string;
}) {
  const pace = computePace(finished, goal);
  const paceColor =
    pace.tone === "success"
      ? "var(--success)"
      : pace.tone === "warning"
        ? "var(--warning)"
        : "var(--sphere)";

  return (
    <div className="flex items-center gap-4">
      <ProgressRing value={goal > 0 ? finished / goal : 0} size={64} thickness={6}>
        <span className="tabular text-[15px] font-bold text-[var(--text-primary)]">
          <CountUp to={finished} />
        </span>
      </ProgressRing>
      <div>
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
          Meta de {year || "leitura"}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
          <span className="tabular font-semibold text-[var(--text-primary)]">{finished}</span>{" "}
          de <span className="tabular">{goal}</span> livros ·{" "}
          <span className="font-semibold" style={{ color: paceColor }}>
            {pace.label}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * A faixa de estatísticas de leitura (item 7): ritmo e tempo médio para terminar.
 * Determinística, com a fórmula do backend à mostra. Um número sem dado é omitido
 * — nada de "0 páginas/dia" quando ainda não há livro terminado com páginas.
 */
function ReadingStatsRow({ stats }: { stats: ReadingStats }) {
  const cells: Array<{ label: string; value: string }> = [];
  if (stats.pagesPerDay != null) {
    cells.push({ label: "Páginas por dia", value: stats.pagesPerDay.toFixed(1) });
  }
  if (stats.avgDaysToFinish != null) {
    const d = Math.round(stats.avgDaysToFinish);
    cells.push({
      label: "Tempo médio p/ terminar",
      // "no dia" era honesto e ilegível: como VALOR de 22px sob "tempo médio",
      // ele não se lê como duração nenhuma — parece string quebrada. "< 1 dia"
      // diz o mesmo e se reconhece de relance.
      value: d === 0 ? "< 1 dia" : `${d} ${d === 1 ? "dia" : "dias"}`,
    });
  }
  if (stats.pagesThisYear > 0) {
    cells.push({ label: `Páginas em ${stats.year}`, value: String(stats.pagesThisYear) });
  }
  if (cells.length === 0) return null;

  return (
    <div className="mb-5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="tabular text-[22px] leading-none font-semibold text-[var(--text-primary)]">
              {c.value}
            </div>
            <div className="mt-1 text-[10px] font-medium tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
              {c.label}
            </div>
          </div>
        ))}
      </div>
      <Formula>{stats.formula}</Formula>
    </div>
  );
}

function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

function Chip({
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
        "inline-flex h-7 items-center rounded-full border px-3 text-[11.5px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </button>
  );
}
