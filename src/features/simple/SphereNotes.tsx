/**
 * As NOTAS de uma Esfera.
 *
 * Nada de novo por baixo: é a mesma nota da tela global (`listNotes` aceita
 * `areaId` desde sempre) com o mesmo editor. O que muda é o RECORTE — aqui só as
 * notas desta Esfera, e a nota nova já nasce com a Esfera preenchida.
 *
 * Por que o editor mora aqui dentro, e não um clique que leva à tela global: a
 * tela global de Notas seleciona sozinha a primeira da lista e não tem rota por
 * nota. Mandar o usuário para lá seria um clique que abre OUTRA nota — um botão
 * que responde a coisa errada é pior que um botão que não existe.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";

import { Button, EmptyState, cx } from "../../design-system/primitives";
import { MonoLabel } from "../../design-system/instruments";
import { useToasts } from "../../stores/toasts";
import { createNote, getNote, listNotes, type NoteSummary } from "../../lib/ipc";
import { NoteEditor } from "../notes/NoteEditor";

/** "há 3 dias" — a idade de uma nota, que é o que ordena a lista. */
function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.round(days / 30);
  return months < 24 ? `há ${months} meses` : `há ${Math.round(days / 365)} anos`;
}

export function SphereNotes({ areaId }: { areaId: string }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const notes = useQuery({
    queryKey: ["notes", "area", areaId],
    queryFn: () => listNotes(areaId),
  });

  const list = notes.data ?? [];

  /* A seleção segue a lista: sem nada escolhido, a primeira; e se a escolhida
     sumir (apagada noutra tela), volta para a primeira em vez de ficar apontando
     para uma nota que não existe mais. */
  useEffect(() => {
    if (list.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !list.some((n) => n.id === selectedId)) {
      setSelectedId(list[0].id);
    }
  }, [list, selectedId]);

  const selected = useQuery({
    queryKey: ["notes", selectedId],
    queryFn: () => getNote(selectedId as string),
    enabled: !!selectedId,
  });

  const create = useMutation({
    mutationFn: () => createNote("Nova nota", areaId),
    onSuccess: (n) => {
      push("success", "Nota criada");
      void qc.invalidateQueries({ queryKey: ["notes"] });
      setSelectedId(n.id);
    },
    onError: pushError,
  });

  /* Enquanto carrega, nada é desenhado: um "nenhuma nota ainda" piscando é uma
     afirmação falsa sobre a Esfera de quem tem vinte (ADR-0090). */
  if (!notes.data) return null;

  if (list.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-14">
        <EmptyState
          icon={FileText}
          title="Nenhuma nota nesta Esfera"
          hint="Uma nota é onde mora o que não é tarefa nem hábito: a medida da cortina, o telefone do encanador, o que você quer lembrar da reforma. Ela aceita [[links]] para qualquer outro item."
          action={
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              Nova nota
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-2 lg:w-[240px]">
        <div className="flex items-center justify-between gap-2">
          <MonoLabel>
            {list.length} {list.length === 1 ? "nota" : "notas"}
          </MonoLabel>
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            Nova
          </Button>
        </div>
        <ul className="flex flex-col gap-1">
          {list.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              active={n.id === selectedId}
              onSelect={() => setSelectedId(n.id)}
            />
          ))}
        </ul>
      </aside>

      <div className="min-w-0 flex-1">
        {selected.data && (
          /* A `key` é o id: trocar de nota REMONTA o editor, em vez de deixá-lo
             com o texto da anterior no estado interno. */
          <NoteEditor key={selected.data.id} note={selected.data} onOpenNote={setSelectedId} />
        )}
      </div>
    </div>
  );
}

function NoteRow({
  note,
  active,
  onSelect,
}: {
  note: NoteSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={cx(
          "flex w-full flex-col gap-0.5 rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors duration-[var(--dur-fast)]",
          active
            ? "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_12%,transparent)]"
            : "border-transparent hover:bg-[var(--bg-surface)]",
        )}
      >
        <span
          className={cx(
            "truncate text-[12.5px]",
            active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
        >
          {note.title}
        </span>
        <span className="text-[10.5px] text-[var(--text-tertiary)]">{ago(note.updatedAt)}</span>
      </button>
    </li>
  );
}
