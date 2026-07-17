/**
 * O rodapé de uma nota: quem a menciona (backlinks), para onde ela aponta
 * (outgoing) e o que está anexado a ela.
 *
 * Backlinks são o que transforma notas soltas numa teia — "3 notas mencionam
 * esta" é a pergunta que um grafo de conhecimento responde e uma pasta não. Se
 * as três seções estiverem vazias, o painel não desenha nada: uma nota nova não
 * carrega um esqueleto de relações que ela ainda não tem.
 */

import { ArrowUpRight, Link2, Paperclip } from "lucide-react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { cx } from "../../design-system/primitives";
import { formatBytes } from "../../lib/format";
import type { Attachment, NoteFull, NoteLink } from "../../lib/ipc";

export function Backlinks({
  note,
  attachments,
  appDir,
  onOpenNote,
}: {
  note: NoteFull;
  attachments: Attachment[];
  /** Raiz de dados do app, para montar a URL do asset. `null` até resolver. */
  appDir: string | null;
  onOpenNote: (id: string) => void;
}) {
  const { backlinks, outgoing } = note;
  if (backlinks.length === 0 && outgoing.length === 0 && attachments.length === 0) {
    return null;
  }

  const assetUrl = (path: string) => {
    if (!appDir) return path;
    const base = appDir.replace(/[\\/]+$/, "");
    return convertFileSrc(`${base}/${path}`);
  };

  return (
    <div className="nx-enter mt-8 flex flex-col gap-5 border-t border-[var(--border-subtle)] pt-5">
      {backlinks.length > 0 && (
        <Section
          icon={Link2}
          title={
            backlinks.length === 1
              ? "1 nota menciona esta"
              : `${backlinks.length} notas mencionam esta`
          }
        >
          <div className="flex flex-col gap-1">
            {backlinks.map((l) => (
              <LinkRow key={l.nodeId} link={l} onOpenNote={onOpenNote} />
            ))}
          </div>
        </Section>
      )}

      {outgoing.length > 0 && (
        <Section icon={ArrowUpRight} title="Esta nota aponta para">
          <div className="flex flex-wrap gap-1.5">
            {outgoing.map((l) => (
              <LinkChip key={l.nodeId} link={l} onOpenNote={onOpenNote} />
            ))}
          </div>
        </Section>
      )}

      {attachments.length > 0 && (
        <Section icon={Paperclip} title="Anexos">
          <div className="flex flex-wrap gap-2.5">
            {attachments.map((a) =>
              a.mime.startsWith("image/") ? (
                <img
                  key={a.sha256}
                  src={assetUrl(a.relativePath)}
                  alt={a.title}
                  className="h-20 w-20 rounded-[var(--radius-md)] border border-[var(--border-subtle)] object-cover"
                  loading="lazy"
                />
              ) : (
                <span
                  key={a.sha256}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2.5 py-1.5"
                >
                  <Paperclip size={13} className="text-[var(--text-tertiary)]" />
                  <span className="text-[12px] text-[var(--text-secondary)]">{a.title}</span>
                  <span className="tabular text-[11px] text-[var(--text-tertiary)]">
                    {formatBytes(a.sizeBytes)}
                  </span>
                </span>
              ),
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Link2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        <Icon size={12} />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Uma linha de backlink — clicável quando aponta para uma nota. */
function LinkRow({ link, onOpenNote }: { link: NoteLink; onOpenNote: (id: string) => void }) {
  const isNote = link.kind === "note";
  return (
    <button
      onClick={() => isNote && onOpenNote(link.nodeId)}
      disabled={!isNote}
      className={cx(
        "group flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left transition-colors duration-[var(--dur-fast)]",
        isNote
          ? "hover:bg-[var(--bg-raised)]"
          : "cursor-default",
      )}
    >
      <span
        className={cx(
          "size-1.5 shrink-0 rounded-full",
          isNote ? "bg-[var(--accent)]" : "bg-[var(--text-tertiary)]",
        )}
      />
      <span
        className={cx(
          "truncate text-[13px]",
          isNote
            ? "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
            : "text-[var(--text-tertiary)]",
        )}
      >
        {link.title}
      </span>
    </button>
  );
}

/** Um chip de link de saída. */
function LinkChip({ link, onOpenNote }: { link: NoteLink; onOpenNote: (id: string) => void }) {
  const isNote = link.kind === "note";
  return (
    <button
      onClick={() => isNote && onOpenNote(link.nodeId)}
      disabled={!isNote}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-[var(--dur-fast)]",
        isNote
          ? "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-muted)] text-[var(--accent)] hover:border-[var(--accent)]"
          : "cursor-default border-[var(--border-subtle)] text-[var(--text-tertiary)]",
      )}
    >
      <ArrowUpRight size={12} />
      {link.title}
    </button>
  );
}
