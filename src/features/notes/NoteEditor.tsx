/**
 * O editor de uma nota: CodeMirror 6 à esquerda, preview ao vivo à direita.
 *
 * O padrão CodeMirror-em-React aplicado com disciplina: a `EditorView` nasce UMA
 * vez num `useEffect` (a nota é a `key` deste componente, então trocar de nota o
 * remonta em vez de reconfigurar o doc na mão) e morre no unmount. Tudo que muda
 * a cada tecla — o corpo, a lista de nós do autocomplete, o handler de anexo —
 * viaja por `ref`, para o closure do editor nunca ficar velho e a view nunca ser
 * recriada por um re-render.
 *
 * Salvamento é debounced (~600ms): o backend re-parseia os `[[wiki-links]]` a
 * cada gravação, e a resposta traz `outgoing`/`backlinks` frescos — que voltam
 * para o cache do react-query e descem de novo como props.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, Paperclip } from "lucide-react";

import { EditorView, keymap, placeholder, MatchDecorator, ViewPlugin, Decoration } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { convertFileSrc } from "@tauri-apps/api/core";

import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  attachToNote,
  dataRoot,
  listNodes,
  renameNode,
  saveNoteBody,
  type NoteFull,
  type Node,
} from "../../lib/ipc";
import { renderMarkdown, toggleCheckbox } from "./markdown";
import { Backlinks } from "./Backlinks";

/* ===== Extensões estáticas (criadas uma vez no módulo) ===== */

// O realce de `[[...]]` no PRÓPRIO editor: um decorador que pinta os spans na
// cor do accent. Resolvido-vs-pendente é assunto da preview; aqui só marcamos
// que aquilo é um elo.
const wikiMatcher = new MatchDecorator({
  regexp: /\[\[[^\]\n]+\]\]/g,
  decoration: Decoration.mark({ class: "cm-wikilink" }),
});
const wikiHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = wikiMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = wikiMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

// Um tema mínimo que casa com o Midnight: fundo transparente (o `bg-surface` do
// painel aparece por baixo), texto primário, cursor e seleção no accent. Sem
// caixa branca, sem gutter — é uma folha de escrever, não uma IDE.
const nexusTheme = EditorView.theme(
  {
    "&": { color: "var(--text-primary)", backgroundColor: "transparent", height: "100%" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-sans)",
      fontSize: "13.5px",
      lineHeight: "1.7",
      padding: "2px 0 40px",
    },
    ".cm-content": { caretColor: "var(--accent)", padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent-muted)",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-wikilink": { color: "var(--accent)", fontWeight: "500" },
    ".cm-placeholder": { color: "var(--text-tertiary)" },
    ".cm-tooltip": {
      backgroundColor: "var(--bg-raised)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden",
      boxShadow: "var(--shadow-float)",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-sans)",
      fontSize: "12.5px",
      maxHeight: "220px",
    },
    ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", color: "var(--text-secondary)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--accent-muted)",
      color: "var(--text-primary)",
    },
  },
  { dark: true },
);

export function NoteEditor({
  note,
  onOpenNote,
}: {
  note: NoteFull;
  /** Abrir outra nota (clique num wiki-link/backlink que aponta para nota). */
  onOpenNote: (id: string) => void;
}) {
  // A nota é a `key` deste componente no pai — então o `id` é constante durante
  // toda a vida desta instância, e os efeitos que dependem só dele rodam uma vez.
  const noteId = note.id;
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.bodyMd);
  const [previewOn, setPreviewOn] = useState(true);
  const [status, setStatus] = useState<"saved" | "saving">("saved");
  const [appDir, setAppDir] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef(note.bodyMd);
  const nodesRef = useRef<Node[]>([]);
  const saveTimer = useRef<number | null>(null);

  // Os nós do universo, para o autocomplete de `[[`. Guardados num ref para o
  // closure do editor ler sempre a lista fresca sem ser recriado.
  const { data: nodes } = useQuery({
    queryKey: ["notes", "nodes-index"],
    queryFn: () => listNodes({ limit: 500 }),
    staleTime: 60_000,
  });
  nodesRef.current = nodes ?? [];

  useEffect(() => {
    // A raiz REAL dos dados (`.../Nexus`), não a do identificador do bundle que
    // `appDataDir()` devolveria — é sob ela que os anexos moram.
    dataRoot().then(setAppDir).catch(() => setAppDir(null));
  }, []);

  /* ----- Persistência (debounced) ----- */

  const persist = (text: string) => {
    setStatus("saving");
    saveNoteBody(noteId, text)
      .then((updated) => {
        qc.setQueryData(["notes", noteId], updated);
        void qc.invalidateQueries({ queryKey: ["notes", "list"] });
        setStatus("saved");
      })
      .catch((e) => {
        pushError(e);
        setStatus("saved");
      });
  };

  const scheduleSave = (text: string) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(text), 600);
  };

  // O handler de mudança do doc vive num ref e é reatribuído a cada render, para
  // o `updateListener` (montado uma vez) chamar sempre a versão atual.
  const onDocChangeRef = useRef<(text: string) => void>(() => {});
  onDocChangeRef.current = (text) => {
    bodyRef.current = text;
    setBody(text);
    setStatus("saving");
    scheduleSave(text);
  };

  /* ----- Anexos ----- */

  const attachRef = useRef<(file: File) => void>(() => {});
  attachRef.current = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const att = await attachToNote(noteId, file.name, bytes);
      insertAtCursor(`\n![${att.title}](${att.relativePath})\n`);
      void qc.invalidateQueries({ queryKey: ["notes", noteId] });
      push("success", "Anexo adicionado");
    } catch (e) {
      pushError(e);
    }
  };

  /* ----- Criação da EditorView (uma vez) ----- */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const wikiSource = (ctx: CompletionContext): CompletionResult | null => {
      const before = ctx.matchBefore(/\[\[[^\]\n]*/);
      if (!before || before.from === before.to) return null;
      const typed = ctx.state.sliceDoc(before.from + 2, ctx.pos).toLowerCase();
      const options = nodesRef.current
        .filter((n) => n.title.toLowerCase().includes(typed))
        .slice(0, 30)
        .map((n) => ({
          label: n.title,
          type: n.kind === "note" ? "text" : "variable",
          // Fecha o `]]` — a menos que já exista logo à frente, para não duplicar.
          apply: (view: EditorView, _c: unknown, from: number, to: number) => {
            const closed = view.state.sliceDoc(to, to + 2) === "]]";
            const insert = closed ? n.title : `${n.title}]]`;
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length + (closed ? 2 : 0) },
            });
          },
        }));
      if (options.length === 0) return null;
      return { from: before.from + 2, to: ctx.pos, options, filter: false };
    };

    const view = new EditorView({
      doc: bodyRef.current,
      parent: host,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        markdown(),
        EditorView.lineWrapping,
        syntaxHighlighting(oneDarkHighlightStyle),
        nexusTheme,
        wikiHighlighter,
        placeholder("Escreva em Markdown…  Use [[ para linkar outra nota."),
        autocompletion({ override: [wikiSource], icons: false, activateOnTyping: true }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onDocChangeRef.current(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste: (event) => {
            const items = event.clipboardData?.items;
            if (!items) return false;
            for (const it of items) {
              if (it.kind === "file" && it.type.startsWith("image/")) {
                const file = it.getAsFile();
                if (file) {
                  event.preventDefault();
                  const ext = it.type.split("/")[1] || "png";
                  const named =
                    file.name && file.name !== "image.png"
                      ? file
                      : new File([file], `colado-${Date.now()}.${ext}`, { type: it.type });
                  attachRef.current(named);
                  return true;
                }
              }
            }
            return false;
          },
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // Sem deps: a view é montada uma vez por nota (o pai remonta via `key`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Insere texto no cursor — usado pela colagem e pelo botão Anexar. */
  const insertAtCursor = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  };

  /** Reescreve o doc inteiro — usado pelo toggle de checkbox na preview. */
  const replaceDoc = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  };

  /* ----- Título (renomeia no blur / Enter) ----- */

  const commitTitle = () => {
    const next = title.trim();
    if (!next || next === note.title) return;
    setStatus("saving");
    renameNode(noteId, next)
      .then(() => {
        qc.setQueryData<NoteFull>(["notes", noteId], (prev) =>
          prev ? { ...prev, title: next } : prev,
        );
        void qc.invalidateQueries({ queryKey: ["notes", "list"] });
        void qc.invalidateQueries({ queryKey: ["notes", "nodes-index"] });
        setStatus("saved");
      })
      .catch((e) => {
        pushError(e);
        setStatus("saved");
      });
  };

  /* ----- Preview ----- */

  const html = useMemo(
    () =>
      renderMarkdown(body, {
        resolveWikiLink: (t) => {
          const link = note.outgoing.find(
            (l) => l.title.toLowerCase() === t.toLowerCase(),
          );
          return link ? { nodeId: link.nodeId, kind: link.kind } : null;
        },
        resolveAsset: (path) => {
          if (!appDir) return path;
          const base = appDir.replace(/[\\/]+$/, "");
          return convertFileSrc(`${base}/${path}`);
        },
      }),
    [body, note.outgoing, appDir],
  );

  const onPreviewClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const check = el.closest<HTMLInputElement>(".nx-md-check");
    if (check) {
      const line = Number(check.dataset.line);
      if (Number.isInteger(line)) replaceDoc(toggleCheckbox(bodyRef.current, line));
      return;
    }
    const wiki = el.closest<HTMLElement>(".nx-md-wiki");
    if (wiki) {
      e.preventDefault();
      const target = wiki.dataset.wikiNode;
      if (target && wiki.dataset.wikiKind === "note") onOpenNote(target);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho: título editável + estado + ferramentas. */}
      <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-6 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Sem título"
          className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        <SaveState status={status} />
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) attachRef.current(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Paperclip}
          onClick={() => fileInput.current?.click()}
        >
          Anexar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={previewOn ? EyeOff : Eye}
          onClick={() => setPreviewOn((v) => !v)}
        >
          {previewOn ? "Ocultar" : "Preview"}
        </Button>
      </div>

      {/* Corpo: editor à esquerda, preview à direita. */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cx(
            "min-h-0 overflow-hidden",
            previewOn ? "w-1/2 border-r border-[var(--border-subtle)]" : "w-full",
          )}
        >
          <div ref={hostRef} className="h-full overflow-auto px-6 py-4" />
        </div>

        {previewOn && (
          <div className="min-h-0 w-1/2 overflow-auto px-7 py-4">
            {body.trim() ? (
              <div
                className="nx-md"
                onClick={onPreviewClick}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <p className="text-[13px] italic text-[var(--text-tertiary)]">
                A preview aparece aqui conforme você escreve.
              </p>
            )}
            <Backlinks note={note} attachments={note.attachments} appDir={appDir} onOpenNote={onOpenNote} />
          </div>
        )}
      </div>

      {/* Sem preview, os backlinks ainda precisam de um lugar. */}
      {!previewOn && (
        <div className="border-t border-[var(--border-subtle)] px-6 py-3">
          <Backlinks note={note} attachments={note.attachments} appDir={appDir} onOpenNote={onOpenNote} />
        </div>
      )}
    </div>
  );
}

/** O selinho discreto de "salvando…/salvo" ao lado do título. */
function SaveState({ status }: { status: "saved" | "saving" }) {
  if (status === "saving") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
        <span
          className="size-1.5 rounded-full bg-[var(--accent)]"
          style={{ animation: "nexus-pulse 900ms var(--ease) infinite" }}
        />
        salvando…
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
      <Check size={12} className="text-[var(--success)]" />
      salvo
    </span>
  );
}
