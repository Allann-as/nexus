/**
 * O Painel dos Estudos — a resposta à pergunta "como vai minha leitura?".
 *
 * Um HeroCard com a meta anual (o número gigante de terminados + o anel), a
 * linha de StatCards satélites, a frase determinística e a seção "Lendo agora"
 * com o quanto falta de cada livro em curso.
 */

import { useQuery } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Library } from "lucide-react";

import { CountUp, HeroCard, StatCard, SummaryCard, Val } from "../../design-system/cards";
import { ProgressBar, ProgressRing } from "../../design-system/charts";
import { EmptyState } from "../../design-system/primitives";
import { studiesOverview, type Book } from "../../lib/ipc";
import { coverStyle, bookInitials } from "./bookCover";
import { computePace, SetGoalInline } from "./readingGoal";

export function StudiesDashboard({ areaId }: { areaId: string }) {
  const overview = useQuery({
    queryKey: ["studies", areaId],
    queryFn: () => studiesOverview(areaId),
  });

  if (overview.isLoading) {
    return (
      <div className="nx-enter flex flex-col gap-4">
        <div className="h-36 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            />
          ))}
        </div>
      </div>
    );
  }

  const ov = overview.data;
  if (!ov) return null;

  const goal = ov.readingGoal ?? null;
  const finished = ov.finishedThisYear;
  const readingNow = ov.readingNow;
  const pace = goal && goal > 0 ? computePace(finished, goal) : null;
  const paceColor =
    pace?.tone === "success"
      ? "var(--success)"
      : pace?.tone === "warning"
        ? "var(--warning)"
        : "var(--sphere)";

  return (
    <div className="nx-enter flex flex-col gap-4">
      <HeroCard
        label={`Terminados em ${ov.year}`}
        value={<CountUp to={finished} />}
        unit={goal && goal > 0 ? `de ${goal}` : "livros"}
        hint={
          goal && goal > 0 ? (
            pace && (
              <>
                Você está{" "}
                <span className="font-semibold" style={{ color: paceColor }}>
                  {pace.label}
                </span>{" "}
                para a meta do ano.
              </>
            )
          ) : (
            <span className="mt-1 inline-block">
              <SetGoalInline onSaved={() => overview.refetch()} />
            </span>
          )
        }
        aside={
          goal && goal > 0 ? (
            <ProgressRing value={finished / goal} size={96} thickness={8}>
              <span className="tabular text-[13px] font-bold text-[var(--text-primary)]">
                {Math.round((finished / goal) * 100)}%
              </span>
            </ProgressRing>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={BookOpen}
          label="Lendo agora"
          value={<CountUp to={readingNow.length} />}
        />
        <StatCard
          icon={Library}
          label="Na estante"
          value={<CountUp to={ov.totalBooks} />}
        />
        <StatCard
          icon={CheckCircle2}
          label="Terminados no ano"
          value={<CountUp to={finished} />}
        />
      </div>

      <SummaryCard>
        {ov.totalBooks === 0 ? (
          "sua estante ainda está vazia — adicione um livro na Biblioteca para começar a acompanhar suas leituras."
        ) : (
          <>
            você terminou <Val tone="success">{finished}</Val>{" "}
            {finished === 1 ? "livro" : "livros"} em {ov.year}, está lendo{" "}
            <Val>{readingNow.length}</Val> agora e tem{" "}
            <Val tone="accent">{ov.totalBooks}</Val> na estante
            {pace ? (
              <>
                {" "}
                — <Val tone={pace.tone}>{pace.label}</Val> para a meta.
              </>
            ) : (
              "."
            )}
          </>
        )}
      </SummaryCard>

      {/* ===== Lendo agora ===== */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
          Lendo agora
        </h3>
        {readingNow.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nenhuma leitura em curso"
            hint="Marque um livro como 'lendo' na Biblioteca e ele aparece aqui, com o quanto já andou."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {readingNow.map((book) => (
              <ReadingRow key={book.id} book={book} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Uma linha de "lendo agora": capinha, título e a barra de páginas. */
function ReadingRow({ book }: { book: Book }) {
  const pct =
    book.totalPages && book.totalPages > 0 ? book.currentPage / book.totalPages : 0;
  const known = book.totalPages != null && book.totalPages > 0;

  return (
    <div className="flex items-center gap-3">
      <div
        className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)]"
        style={coverStyle(book.title)}
      >
        <span className="text-[15px] font-bold text-white/85">{bookInitials(book.title)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {book.title}
          </h4>
          {known && (
            <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
              {Math.round(pct * 100)}%
            </span>
          )}
        </div>
        {known ? (
          <div className="mt-1.5 flex flex-col gap-1">
            <ProgressBar value={pct} height={5} />
            <span className="tabular text-[10.5px] text-[var(--text-tertiary)]">
              {book.currentPage}/{book.totalPages} páginas
            </span>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {book.currentPage > 0 ? `página ${book.currentPage}` : "sem contagem de páginas"}
          </p>
        )}
      </div>
    </div>
  );
}
