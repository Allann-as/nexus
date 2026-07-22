/**
 * A aba MARCOS da Carreira — a linha do tempo dos cargos, com a duração de cada
 * fase.
 *
 * Ela morava embutida no rodapé do Painel. Uma história profissional de dez anos
 * não é rodapé de dashboard: é uma das coisas que a Esfera GUARDA, e cresce para
 * sempre. No Painel ela empurrava tudo para baixo e ainda assim aparecia
 * espremida; aqui ela é a tela.
 *
 * O que ficou no Painel é o RESUMO que já estava lá: o tile "No marco atual"
 * (há quanto tempo dura a fase corrente) e "Marcos em {ano}". Resumo no painel,
 * história na aba — sem a mesma lista desenhada duas vezes.
 *
 * A EXCLUSÃO aqui é de um tipo raro: o marco não tem linha de estado nenhuma —
 * ele É um fato do ledger. Então "excluir" não remove nada: acrescenta um evento
 * de RETRATAÇÃO, e é a leitura do ledger que passa a ignorar o marco retratado
 * (ADR-0056). O passado fica inteiro; só a linha da carreira se corrige.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, CalendarClock, Plus } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { MonoLabel } from "../../design-system/instruments";
import { Button, EmptyState, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { careerMilestones, deleteCareerMilestone, type LedgerEntry } from "../../lib/ipc";
import { CAREER_KIND_META } from "./careerKinds";
import { RecordMilestoneModal } from "./RecordMilestoneModal";
import { daysBetween, formatDay, humanize, parseMilestone, todayLocal } from "./careerTime";

export function CareerMilestones() {
  const client = useQueryClient();
  const [recording, setRecording] = useState(false);

  const milestonesQ = useQuery({
    queryKey: ["career", "milestones"],
    queryFn: careerMilestones,
  });

  // Do mais recente ao mais antigo (o ledger por entity_kind já entrega assim).
  const milestones = useMemo(
    () => (milestonesQ.data ?? []).map(parseMilestone),
    [milestonesQ.data],
  );
  const today = todayLocal();

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["career"] });
    void client.invalidateQueries({ queryKey: ["ledger"] });
    setRecording(false);
  };

  return (
    <div className="nx-enter">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <MonoLabel>Linha da carreira</MonoLabel>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            Promoções, certificações e conquistas — com quanto durou cada fase.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {milestones.length > 0 && (
            <span className="tabular text-[11px] text-[var(--text-tertiary)]">
              {milestones.length} {milestones.length === 1 ? "marco" : "marcos"}
            </span>
          )}
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)}>
            Registrar marco
          </Button>
        </div>
      </header>

      {milestones.length === 0 ? (
        <EmptyState
          icon={Award}
          title="Sua história profissional começa aqui"
          hint="Registre promoções, certificações e conquistas — elas ficam para sempre na Timeline, e a linha do tempo mostra quanto durou cada fase."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)}>
              Registrar marco
            </Button>
          }
        />
      ) : (
        <ol className="relative ml-2 border-l border-[var(--border-subtle)]">
          {milestones.map((m, i) => {
            // A fase deste marco durou dele até o PRÓXIMO mais recente (o de
            // índice i-1); o mais recente de todos corre até hoje ("atual").
            const isCurrent = i === 0;
            const spanDays = isCurrent
              ? daysBetween(m.entry.day, today)
              : daysBetween(m.entry.day, milestones[i - 1].entry.day);
            const Icon = CAREER_KIND_META[m.kind].icon;
            return (
              <li key={m.entry.seq} className="relative py-3 pl-6">
                <span
                  className={cx(
                    "absolute -left-[13px] top-3.5 grid size-6 place-items-center rounded-full text-[var(--sphere)]",
                    isCurrent
                      ? "bg-[color-mix(in_srgb,var(--sphere)_18%,var(--bg-surface))] ring-2 ring-[color-mix(in_srgb,var(--sphere)_55%,transparent)]"
                      : "bg-[var(--bg-surface)] ring-1 ring-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
                  )}
                  aria-hidden
                >
                  <Icon size={12} />
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[14px] font-medium text-[var(--text-primary)]">
                    {m.entry.titleSnapshot}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    {formatDay(m.entry.day)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-[var(--sphere)]">
                    {CAREER_KIND_META[m.kind].label}
                  </span>
                  <span
                    className={cx(
                      "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                      isCurrent
                        ? "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--sphere)]"
                        : "border-[var(--border-subtle)] text-[var(--text-tertiary)]",
                    )}
                  >
                    <CalendarClock size={10} />
                    {isCurrent ? `atual · há ${humanize(spanDays)}` : `durou ${humanize(spanDays)}`}
                  </span>
                  <MilestoneDelete entry={m.entry} />
                </div>
                {m.note && (
                  <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--text-secondary)]">
                    {m.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {recording && <RecordMilestoneModal onClose={() => setRecording(false)} onSaved={refresh} />}
    </div>
  );
}

/**
 * O gesto de retratar um marco, ao lado da duração da fase.
 *
 * ["career"] redesenha a linha e os tiles do Painel; ["ledger"] redesenha a
 * Timeline, que é onde o evento de correção também aparece.
 */
function MilestoneDelete({ entry }: { entry: LedgerEntry }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const remove = useMutation({
    mutationFn: () => deleteCareerMilestone(entry.entityId),
    onSuccess: () => {
      push("success", "Marco excluído");
      void client.invalidateQueries({ queryKey: ["career"] });
      void client.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: pushError,
  });

  return (
    <ArmedDelete
      className="ml-auto"
      onConfirm={() => remove.mutate()}
      pending={remove.isPending}
      question="Excluir este marco?"
      ariaLabel={`Excluir o marco ${entry.titleSnapshot}`}
    />
  );
}
