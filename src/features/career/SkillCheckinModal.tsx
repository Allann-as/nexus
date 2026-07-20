/**
 * O check-in mensal de uma competência (v1.2, ADR-0037).
 *
 * Três perguntas, uma vez por mês: estudou? aplicou quantas vezes? como avalia a
 * evolução? Delas o backend DERIVA o nível 1-10 — o frontend não calcula nada,
 * só pergunta e mostra a fórmula pronta.
 *
 * Reinformar um mês que já tem check-in CORRIGE o retrato (upsert), não empilha.
 * Por isso a modal pré-carrega a resposta daquele mês e troca o texto inteiro
 * para "corrigir": o usuário precisa saber que está mexendo no que já disse.
 *
 * O seletor de mês só anda para trás — o backend recusa o futuro, e uma UI que
 * deixa pedir o que vai ser negado é uma UI que mente.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";

import { Modal, ModalHeader } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useSphereColor } from "../../design-system/useSphereColor";
import { useToasts } from "../../stores/toasts";
import { Stars } from "../studies/Stars";
import { recordSkillCheckin, skillCheckins, type Skill } from "../../lib/ipc";
import { currentMonth, monthLabel, shiftMonth } from "./skillMonth";

export function SkillCheckinModal({
  skill,
  areaId,
  onClose,
}: {
  skill: Skill;
  areaId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  // A modal sai da árvore da página pelo portal; `--sphere` não atravessa.
  const sphere = useSphereColor(areaId);

  const today = currentMonth();
  const [month, setMonth] = useState(today);
  const [studied, setStudied] = useState(false);
  const [applied, setApplied] = useState("0");
  const [stars, setStars] = useState(3);

  const checkins = useQuery({
    queryKey: ["skill-checkins", skill.id],
    queryFn: () => skillCheckins(skill.id),
  });

  const existing = (checkins.data ?? []).find((c) => c.month === month) ?? null;
  const first = (checkins.data ?? [])[0]?.month ?? null;

  // O mês escolhido manda no formulário: trocar de mês recarrega a resposta
  // daquele mês (ou volta ao formulário em branco, se ainda não houver).
  useEffect(() => {
    if (checkins.isPending) return;
    setStudied(existing?.studied ?? false);
    setApplied(String(existing?.applied ?? 0));
    setStars(existing?.stars ?? 3);
  }, [month, existing, checkins.isPending]);

  const appliedNum = Math.trunc(Number(applied));
  const validApplied = applied.trim() !== "" && Number.isFinite(appliedNum) && appliedNum >= 0;
  const valid = validApplied && stars >= 1 && stars <= 5;

  const save = useMutation({
    mutationFn: () => recordSkillCheckin(skill.id, month, studied, appliedNum, stars),
    onSuccess: () => {
      push("success", existing ? "Check-in corrigido" : "Check-in registrado");
      void client.invalidateQueries({ queryKey: ["skills", areaId] });
      void client.invalidateQueries({ queryKey: ["skill-track", skill.id] });
      void client.invalidateQueries({ queryKey: ["skill-checkins", skill.id] });
      void client.invalidateQueries({ queryKey: ["skill-level", skill.id] });
      void client.invalidateQueries({ queryKey: ["skill-level-history", skill.id] });
      void client.invalidateQueries({ queryKey: ["skills-evolving", areaId] });
      // O check-in vira XP e move a Esfera (ADR-0045).
      void client.invalidateQueries({ queryKey: ["gamification"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
      onClose();
    },
    onError: pushError,
  });

  // Não faz sentido andar para antes do primeiro check-in por um lado, nem para
  // o futuro pelo outro. O passado sem registro fica a um mês de distância —
  // o suficiente para corrigir o mês que virou.
  const floor = shiftMonth(first ?? today, -1);
  const canPrev = month > floor;
  const canNext = month < today;

  return (
    <Modal onClose={onClose} size="md" sphereColor={sphere}>
      <div className="p-5">
        <ModalHeader
          icon={CalendarCheck}
          title={existing ? "Corrigir o check-in" : "Check-in mensal"}
          subtitle={skill.title}
          onClose={onClose}
          tone="var(--sphere)"
        />

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronLeft}
              disabled={!canPrev}
              onClick={() => setMonth((m) => shiftMonth(m, -1))}
              aria-label="Mês anterior"
            />
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {monthLabel(month)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronRight}
              disabled={!canNext}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
              aria-label="Mês seguinte"
            />
          </div>

          {existing && (
            <p className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sphere)_30%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_8%,transparent)] px-3 py-2 text-[12px] leading-[17px] text-[var(--text-secondary)]">
              Este mês já tem check-in. Salvar CORRIGE a resposta de{" "}
              {monthLabel(month)} — não soma um segundo registro.
            </p>
          )}

          <Field label="Estudou esta habilidade este mês?">
            <div className="flex gap-1.5">
              <Choice active={studied} onClick={() => setStudied(true)} label="Sim" />
              <Choice active={!studied} onClick={() => setStudied(false)} label="Não" />
            </div>
          </Field>

          <Field label="Quantas vezes aplicou/desenvolveu na prática?">
            <input
              type="number"
              min={0}
              step={1}
              value={applied}
              onChange={(e) => setApplied(e.target.value)}
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 font-mono text-[14px] tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--sphere)]"
            />
          </Field>

          <Field label="Como avalia a sua evolução?">
            <div className="flex items-center gap-2">
              {/* O clique na estrela atual zeraria a nota; aqui ela é
                  obrigatória (1..5), então o zero é ignorado. */}
              <Stars value={stars} onChange={(n) => setStars(n === 0 ? stars : n)} size={20} />
              <span className="font-mono text-[12px] tabular-nums text-[var(--text-tertiary)]">
                {stars}/5
              </span>
            </div>
          </Field>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={() => valid && !save.isPending && save.mutate()}
              disabled={!valid || save.isPending}
            >
              {existing ? "Corrigir check-in" : "Registrar check-in"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
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

function Choice({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "h-9 flex-1 rounded-[var(--radius-md)] border text-[13px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
      )}
    >
      {label}
    </button>
  );
}
