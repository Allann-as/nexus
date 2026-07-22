/**
 * Notas — o editor Markdown do NEXUS (M4).
 *
 * Duas colunas: à esquerda, a lista de notas (busca, fixadas no topo, "Nova
 * nota"); à direita, o editor CodeMirror com preview ao vivo, wiki-links e
 * backlinks. Notas é uma tela GLOBAL (mora na rail), então ela não se tinge de
 * Esfera — fica no azul neutro do accent, como o resto do que é do app inteiro.
 *
 * A lista vem pinned-first, newest-first do backend, e cada linha carrega a
 * TEIA daquela nota: quantos elos ela emite, quantas notas a mencionam e
 * quantos anexos ela tem. Numa tela cuja tese é a teia, uma linha que só sabe
 * dizer título e data não diz se a nota está ligada a alguma coisa.
 *
 * **A busca é FTS, não filtro de título.** O placeholder sempre disse "Buscar
 * notas…", mas o filtro olhava só o `title`: procurar "sono" não achava a nota
 * que fala de sono da primeira à última linha, e nada na tela dizia que a busca
 * era só do título. O `search` do backend já existia desde o M1 —
 * acento-insensível, por prefixo, com a entrada do usuário nunca interpretada
 * como sintaxe — e devolve o TRECHO onde bateu. Ver ADR-0106.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  FileText,
  Link2,
  Paperclip,
  Pin,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Button, EmptyState, PageHeader, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  createNote,
  deleteNode,
  getNote,
  listNotes,
  pinNote,
  search,
  type NoteFull,
  type NoteSummary,
  type SearchHit,
} from "../../lib/ipc";
import { NoteEditor } from "./NoteEditor";

const DAY_MS = 86_400_000;

/**
 * Tempo relativo curto para a lista — "hoje", "há 3 dias", "12/03", "12/03/24".
 *
 * O ano entra quando a nota é de OUTRO ano. Sem ele, "12/03" servia igual para
 * uma nota de março passado e uma de 2024, e a promessa da tela é justamente um
 * arquivo eterno: a única data que distingue duas notas velhas some.
 */
function relativeTime(ms: number): string {
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 7) return `há ${days} dias`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

export function NotesScreen() {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const list = useQuery({
    queryKey: ["notes", "list"],
    queryFn: () => listNotes(),
  });

  const notes = useMemo(() => list.data ?? [], [list.data]);

  /* A BUSCA vai ao FTS do backend, não ao título em memória. Só dispara com 2+
     caracteres: uma letra casa com quase tudo e o resultado não é uma busca, é
     a lista embaralhada por relevância. */
  const trimmed = query.trim();
  const searching = trimmed.length >= 2;
  const hits = useQuery({
    queryKey: ["notes", "search", trimmed],
    queryFn: () => search(trimmed, 50),
    enabled: searching,
  });

  /** Os resultados que são NOTA, na ordem de relevância do bm25. */
  const results = useMemo(() => {
    if (!searching) return [];
    const byId = new Map(notes.map((n) => [n.id, n]));
    return (hits.data ?? [])
      .filter((h) => h.kind === "note")
      .map((h) => ({ hit: h, note: byId.get(h.nodeId) }))
      // Uma nota arquivada pode voltar do índice sem estar na lista; sem o
      // resumo não há linha para desenhar, e inventar uma seria pior.
      .filter((r): r is { hit: SearchHit; note: NoteSummary } => Boolean(r.note));
  }, [searching, hits.data, notes]);

  // Sem seleção, abre a primeira nota — a tela nunca fica com o painel direito
  // vazio quando há o que mostrar.
  useEffect(() => {
    if (!selectedId && notes.length > 0) setSelectedId(notes[0].id);
    if (selectedId && notes.length > 0 && !notes.some((n) => n.id === selectedId)) {
      setSelectedId(notes[0].id);
    }
  }, [notes, selectedId]);

  const selected = useQuery({
    queryKey: ["notes", selectedId],
    queryFn: () => getNote(selectedId as string),
    enabled: !!selectedId,
  });

  // Sem busca, a lista é a do backend: fixadas primeiro, recentes depois.
  const filtered = useMemo(
    () => ({
      pinned: notes.filter((n) => n.isPinned),
      rest: notes.filter((n) => !n.isPinned),
    }),
    [notes],
  );

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNote("Nova nota");
      qc.setQueryData<NoteFull>(["notes", note.id], note);
      await qc.invalidateQueries({ queryKey: ["notes", "list"] });
      setQuery("");
      setSelectedId(note.id);
    } catch (e) {
      pushError(e);
    } finally {
      setCreating(false);
    }
  };

  const togglePin = async (n: NoteSummary) => {
    try {
      await pinNote(n.id, !n.isPinned);
      await qc.invalidateQueries({ queryKey: ["notes", "list"] });
    } catch (e) {
      pushError(e);
    }
  };

  /* Excluir a nota ABERTA. O gesto vive no cabeçalho, ao lado de "Nova nota", e
     não em cada linha da lista: a lista é para navegar, e um alvo destrutivo em
     cada item de uma lista que se percorre com o mouse é um acidente esperando
     acontecer. Aqui a nota que some é sempre a que está à vista.

     A seleção NÃO é escolhida à mão depois: o `useEffect` que já existe repara
     que o `selectedId` sumiu da lista e salta para a primeira nota sozinho — a
     mesma regra que vale quando a lista muda por qualquer outro motivo.

     Apagar corrige o ESTADO; o ledger guarda que a nota existiu (ADR-0056). */
  const handleDelete = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteNode(id);
      qc.removeQueries({ queryKey: ["notes", id] });
      await qc.invalidateQueries({ queryKey: ["notes", "list"] });
      // Os backlinks de OUTRAS notas apontavam para esta; a teia mudou.
      await qc.invalidateQueries({ queryKey: ["links"] });
      push("success", "Nota excluída");
    } catch (e) {
      pushError(e);
    } finally {
      setDeleting(false);
    }
  };

  const hasNotes = notes.length > 0;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-hidden">
      <NotesPreviewStyles />
      <PageHeader
        title="Notas"
        subtitle="Markdown puro, wiki-links e backlinks — um formato eterno"
        actions={
          hasNotes ? (
            <div className="flex items-center gap-2">
              {selected.data && (
                <ArmedDelete
                  onConfirm={() => void handleDelete(selected.data.id)}
                  pending={deleting}
                  question="Excluir esta nota?"
                  ariaLabel="Excluir nota"
                />
              )}
              <Button variant="primary" size="sm" icon={Plus} onClick={handleCreate}>
                Nova nota
              </Button>
            </div>
          ) : undefined
        }
      />

      {list.isLoading ? (
        <div className="flex min-h-0 flex-1 gap-0 px-8 pb-8">
          <div className="w-[280px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
          <div className="ml-4 flex-1 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
        </div>
      ) : !hasNotes ? (
        <div className="min-h-0 flex-1 pb-16">
          <EmptyState
            icon={FileText}
            title="Nenhuma nota ainda"
            hint="Escreva em Markdown, ligue ideias com [[wiki-links]] e deixe os backlinks tecerem a teia. Comece pela primeira."
            action={
              <Button variant="primary" size="sm" icon={Plus} onClick={handleCreate}>
                Nova nota
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 border-t border-[var(--border-subtle)]">
          {/* ===== Sidebar ===== */}
          <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border-subtle)]">
            <div className="flex flex-col gap-2.5 p-3">
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 focus-within:border-[var(--border-glow)]">
                <Search size={14} className="shrink-0 text-[var(--text-tertiary)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar no texto…"
                  className="h-8 w-full bg-transparent text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={Plus}
                onClick={handleCreate}
                className="w-full"
              >
                Nova nota
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {searching ? (
                /* MODO BUSCA: a lista vira resultado, e o cabeçalho diz que a
                   busca varre o texto — senão "3 resultados" para uma palavra
                   que não está em nenhum título parece defeito. */
                hits.isLoading ? (
                  <p className="px-2 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
                    Buscando…
                  </p>
                ) : results.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[12px] text-[var(--text-tertiary)]">
                    Nenhuma nota contém “{trimmed}”.
                  </p>
                ) : (
                  <>
                    <SectionLabel>
                      {results.length === 1
                        ? "1 nota no texto"
                        : `${results.length} notas no texto`}
                    </SectionLabel>
                    {results.map(({ hit, note }) => (
                      <NoteRow
                        key={note.id}
                        note={note}
                        snippet={hit.snippet}
                        active={note.id === selectedId}
                        onOpen={() => setSelectedId(note.id)}
                        onPin={() => togglePin(note)}
                      />
                    ))}
                  </>
                )
              ) : (
                <>
                  {filtered.pinned.length > 0 && (
                    <>
                      <SectionLabel>Fixadas</SectionLabel>
                      {filtered.pinned.map((n) => (
                        <NoteRow
                          key={n.id}
                          note={n}
                          active={n.id === selectedId}
                          onOpen={() => setSelectedId(n.id)}
                          onPin={() => togglePin(n)}
                        />
                      ))}
                      {filtered.rest.length > 0 && <SectionLabel>Todas</SectionLabel>}
                    </>
                  )}
                  {filtered.rest.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      active={n.id === selectedId}
                      onOpen={() => setSelectedId(n.id)}
                      onPin={() => togglePin(n)}
                    />
                  ))}
                </>
              )}
            </div>
          </aside>

          {/* ===== Editor ===== */}
          <main className="min-h-0 flex-1">
            {selected.data ? (
              <NoteEditor key={selected.data.id} note={selected.data} onOpenNote={setSelectedId} />
            ) : selectedId && selected.isLoading ? (
              <div className="h-full animate-pulse bg-[var(--bg-surface)]" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-[13px] text-[var(--text-tertiary)]">
                  Selecione uma nota à esquerda.
                </p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

/** Um contador da teia — some quando é zero. */
function NoteMeta({
  icon: Icon,
  n,
  title,
}: {
  icon: LucideIcon;
  n: number;
  title: string;
}) {
  if (n <= 0) return null;
  return (
    <span
      title={`${n} ${title}`}
      className="inline-flex items-center gap-0.5 text-[10.5px] text-[var(--text-tertiary)]"
    >
      <Icon size={10} strokeWidth={2.2} aria-hidden />
      <span className="tabular">{n}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
      {children}
    </p>
  );
}

function NoteRow({
  note,
  snippet,
  active,
  onOpen,
  onPin,
}: {
  note: NoteSummary;
  /** O trecho onde a busca bateu. Só no modo busca. */
  snippet?: string;
  active: boolean;
  onOpen: () => void;
  onPin: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={cx(
        "group flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border-l-2 px-2.5 py-2 transition-[background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        active
          ? "border-l-[var(--accent)] bg-[var(--bg-surface)]"
          : "border-l-transparent hover:bg-[var(--bg-surface)]",
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            "truncate text-[13px]",
            active ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
        >
          {note.title || "Sem título"}
        </p>

        {snippet && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-[15px] text-[var(--text-tertiary)]">
            {snippet}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="tabular text-[10.5px] text-[var(--text-tertiary)]">
            {relativeTime(note.updatedAt)}
          </span>
          {/* A teia da nota. Cada contador só aparece quando é MAIOR QUE ZERO:
              uma fileira de "0 · 0 · 0" em toda nota nova seria ruído afirmando
              ausência, e a linha existe para mostrar o que a nota TEM. */}
          <NoteMeta icon={ArrowUpRight} n={note.outgoingCount} title="elos que saem" />
          <NoteMeta icon={Link2} n={note.backlinkCount} title="notas que mencionam esta" />
          <NoteMeta icon={Paperclip} n={note.attachmentCount} title="anexos" />
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        title={note.isPinned ? "Desafixar" : "Fixar"}
        aria-label={note.isPinned ? "Desafixar" : "Fixar"}
        className={cx(
          "shrink-0 rounded-[var(--radius-sm)] p-1 transition-[opacity,color,background-color] duration-[var(--dur-fast)]",
          note.isPinned
            ? "text-[var(--accent)] opacity-100"
            : "text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] group-hover:opacity-100",
        )}
      >
        <Pin size={13} fill={note.isPinned ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

/**
 * As regras da preview de Markdown.
 *
 * O renderizador emite classes `nx-md-*` numa string de HTML — que o Tailwind não
 * varre —, então o estilo mora aqui, em CSS de verdade, só com tokens do tema
 * (nada de hex cru). É injetado uma vez pela tela.
 */
function NotesPreviewStyles() {
  return (
    <style>{`
.nx-md { color: var(--text-secondary); font-size: 13.5px; line-height: 1.7; }
.nx-md > *:first-child { margin-top: 0; }
.nx-md .nx-md-h { color: var(--text-primary); font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; margin: 1.2em 0 0.5em; }
.nx-md .nx-md-h1 { font-size: 22px; }
.nx-md .nx-md-h2 { font-size: 18px; }
.nx-md .nx-md-h3 { font-size: 15px; }
.nx-md .nx-md-h4, .nx-md .nx-md-h5, .nx-md .nx-md-h6 { font-size: 13.5px; }
.nx-md .nx-md-p { margin: 0.5em 0; }
.nx-md strong { color: var(--text-primary); font-weight: 600; }
.nx-md em { font-style: italic; }
.nx-md a.nx-md-link { color: var(--accent); text-decoration: none; }
.nx-md a.nx-md-link:hover { text-decoration: underline; }
.nx-md a.nx-md-wiki { color: var(--accent); font-weight: 500; text-decoration: none; cursor: pointer; border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
.nx-md a.nx-md-wiki:hover { background: var(--accent-muted); border-radius: 3px; }
.nx-md .nx-md-wiki-pending { color: var(--text-tertiary); cursor: help; border-bottom: 1px dashed var(--text-tertiary); }
.nx-md .nx-md-code { font-family: var(--font-mono); font-size: 0.86em; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 0.1em 0.35em; }
.nx-md .nx-md-pre { margin: 0.7em 0; padding: 12px 14px; overflow-x: auto; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.nx-md .nx-md-pre code { font-family: var(--font-mono); font-size: 12px; color: var(--text-secondary); }
.nx-md .nx-md-list { margin: 0.5em 0; padding-left: 1.4em; }
.nx-md ul.nx-md-list { list-style: disc; }
.nx-md ol.nx-md-list { list-style: decimal; }
.nx-md .nx-md-list li { margin: 0.2em 0; }
.nx-md li.nx-md-task { list-style: none; margin-left: -1.4em; display: flex; align-items: flex-start; gap: 0.5em; }
.nx-md .nx-md-check { margin-top: 0.28em; width: 14px; height: 14px; accent-color: var(--accent); cursor: pointer; }
.nx-md .nx-md-task-done { color: var(--text-tertiary); text-decoration: line-through; }
.nx-md .nx-md-quote { margin: 0.7em 0; padding-left: 12px; color: var(--text-tertiary); font-style: italic; border-left: 2px solid var(--border-strong); }
.nx-md .nx-md-hr { margin: 1.2em 0; border: none; border-top: 1px solid var(--border-subtle); }
.nx-md .nx-md-img { max-width: 100%; margin: 0.5em 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    `}</style>
  );
}
