/**
 * A LISTA de uma matéria (0020): os TEMAS de dificuldade de uma matéria
 * ("Matemática → regra de 3, Bháskara") e a CHECKLIST de conteúdos de um curso.
 *
 * É um componente só porque é uma forma só (ADR-0092). Duas cópias — uma em
 * Matérias, outra em Cursos — divergiriam no dia em que uma ganhasse contagem e a
 * outra não, e o usuário leria a mesma lista de dois jeitos.
 *
 * O que muda entre as duas é só o VOCABULÁRIO (um "tema", um "conteúdo"), que
 * entra por prop. O mecanismo, a ordem, a fração e o excluir são os mesmos.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";

import { Checkbox } from "../../design-system/Checkbox";
import { SegBar } from "../../design-system/instruments";
import { cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  addSubjectItem,
  deleteSubjectItem,
  setSubjectItemDone,
  subjectItems,
  type SubjectItem,
  type SubjectTrack,
} from "../../lib/ipc";

/**
 * O vocabulário da lista — indexado pela TRILHA da matéria, não pela tela.
 *
 * A distinção é o que a dirigida cobrou: a aba "Matérias" lista TODAS as trilhas
 * (ADR-0072), então um curso aparece nela E em "Cursos". Se o substantivo viesse
 * da tela, a MESMA lista se chamaria "temas" num lugar e "conteúdos" no outro —
 * exatamente a divergência que a tabela única existiu para evitar (ADR-0092).
 *
 * A frase do vazio também não é template: "quebre no que trava" serve a uma
 * matéria e mente num curso, onde a lista são os módulos da ementa.
 */
const VOCAB: Record<SubjectTrack, { noun: string; plural: string; empty: string }> = {
  livre: {
    noun: "tema",
    plural: "temas",
    empty: "Sem temas ainda — quebre a matéria no que trava.",
  },
  faculdade: {
    noun: "tema",
    plural: "temas",
    empty: "Sem temas ainda — quebre a matéria no que trava.",
  },
  idioma: {
    noun: "tema",
    plural: "temas",
    empty: "Sem temas ainda — liste o que ainda não sai na fala.",
  },
  curso: {
    noun: "conteúdo",
    plural: "conteúdos",
    empty: "Sem conteúdos listados — anote os módulos do curso.",
  },
};

export function SubjectChecklist({
  subjectId,
  /** A trilha da MATÉRIA — é ela que dá nome à lista, em qualquer tela. */
  track,
}: {
  subjectId: string;
  track: SubjectTrack;
}) {
  const { noun, plural: nounPlural, empty: emptyHint } = VOCAB[track];
  const client = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const items = useQuery({
    queryKey: ["subject-items", subjectId],
    queryFn: () => subjectItems(subjectId),
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["subject-items", subjectId] });
  };

  const add = useMutation({
    mutationFn: () => addSubjectItem(subjectId, title.trim()),
    onSuccess: () => {
      setTitle("");
      // O campo FICA aberto: quem decompõe uma matéria escreve vários de uma vez
      // ("regra de 3", "divisão", "Bháskara"), e fechar a cada item obrigaria a
      // reabrir três vezes.
      invalidate();
    },
    onError: pushError,
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => setSubjectItemDone(v.id, v.done),
    onSuccess: invalidate,
    onError: pushError,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteSubjectItem(id),
    onSuccess: invalidate,
    onError: pushError,
  });

  /* Enquanto carrega, a seção não desenha NADA: um "nenhum tema ainda" piscando
     é uma afirmação falsa sobre a matéria de quem tem dez (ADR-0090). */
  if (!items.data) return null;

  const list = items.data;
  const done = list.filter((i) => i.done).length;
  const canAdd = title.trim().length > 0 && !add.isPending;

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
          {nounPlural}
        </span>
        {/* A fração só existe quando há denominador: "0 de 0" não é 0% (ADR-0087),
            é "ainda não decomposto" — e isso a lista abaixo já diz com palavras. */}
        {list.length > 0 && (
          <span className="tabular text-[11px] text-[var(--text-secondary)]">
            {done} de {list.length}
          </span>
        )}
      </div>

      {/* Os segmentos acompanham a LISTA, não um número fixo. Doze segmentos para
          dois itens desenhariam uma precisão que o dado não tem — cada item
          acenderia seis casas de uma régua que só sabe contar até dois. É o
          mesmo critério que reprovou o BarSpark na distribuição por hora
          (ADR-0091): instrumento genérico cuja semântica não bate com o dado
          mente. Acima de 12 itens a régua para de crescer, porque aí a leitura
          já é de proporção e não de contagem. */}
      {list.length > 0 && (
        <SegBar value={done / list.length} segments={Math.min(12, list.length)} height={6} />
      )}

      {list.length === 0 ? (
        /* Existir e não estar decomposto é INFORMAÇÃO: a matéria aparece dizendo
           que não tem temas, em vez de esconder a seção e fingir que não cabia. */
        <p className="text-[11px] text-[var(--text-tertiary)]">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {list.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              onToggle={() => toggle.mutate({ id: item.id, done: !item.done })}
              onRemove={() => remove.mutate(item.id)}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAdd) add.mutate();
              if (e.key === "Escape") {
                setAdding(false);
                setTitle("");
              }
            }}
            placeholder={`Novo ${noun}…`}
            aria-label={`Novo ${noun}`}
            className="h-7 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <button
            onClick={() => add.mutate()}
            disabled={!canAdd}
            aria-label={`Adicionar ${noun}`}
            className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] text-[var(--sphere)] transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] disabled:opacity-40"
          >
            <Check size={13} strokeWidth={2.4} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 self-start text-[11px] font-medium text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:text-[var(--sphere)]"
        >
          <Plus size={12} strokeWidth={2.4} />
          Adicionar {noun}
        </button>
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onRemove,
}: {
  item: SubjectItem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="group flex items-center gap-2">
      {/* O `Checkbox` do design system, não um quadrado próprio: marcar é o gesto
          mais repetido do app e ele já resolve o pulinho, o halo e o aro. Um
          segundo desenho de checkbox seria uma segunda gramática. */}
      <Checkbox checked={item.done} onChange={onToggle} size={16} title={item.title} />
      {/* O título também alterna: a mira de 16px é pequena para a lista mais
          clicada da tela, e o texto ao lado é o alvo natural do dedo. */}
      <button
        onClick={onToggle}
        tabIndex={-1}
        aria-hidden
        className={cx(
          "min-w-0 flex-1 truncate py-0.5 text-left text-[12px] transition-colors duration-[var(--dur-fast)]",
          item.done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-secondary)]",
        )}
      >
        {item.title}
      </button>
      {/* Excluir é um direito (ADR-0056), inclusive de um item. Sem armadilha de
          confirmação: um tema é barato de reescrever, e o modal custaria mais que
          o erro. */}
      <button
        onClick={onRemove}
        aria-label={`Excluir ${item.title}`}
        className="grid size-5 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] opacity-0 transition-[opacity,color] duration-[var(--dur-fast)] group-hover:opacity-100 hover:text-[var(--danger)] focus-visible:opacity-100"
      >
        <X size={12} strokeWidth={2.4} />
      </button>
    </li>
  );
}
