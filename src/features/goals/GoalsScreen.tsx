/**
 * A visão agregada das Metas: todas as Esferas numa tela.
 *
 * Ela existe porque "como vão minhas metas?" é uma pergunta que atravessa as
 * Esferas — a mesma razão que põe o Calendário e o Inbox na rail. O caminho
 * contextual continua sendo a tab "Metas" da Esfera dona; esta é a visão de
 * cima, e o filtro é o que liga uma na outra.
 *
 * Sem `--sphere` no container: como o calendário, esta tela é de todas as
 * Esferas, então o fundo fica neutro e cada CARD se tinge da sua. Escolher uma
 * cor para a tela seria dizer que as metas são de uma Esfera só.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PageHeader, cx } from "../../design-system/primitives";
import { listAreas } from "../../lib/ipc";
import { SphereIcon } from "../hub/SphereIcon";
import { GoalsList } from "./GoalsList";

export function GoalsScreen() {
  const [areaId, setAreaId] = useState<string | null>(null);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", "all"],
    queryFn: () => listAreas(true),
    staleTime: 5 * 60_000,
  });

  const active = areas.filter((a) => !a.archivedAt);

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 pb-12">
        <PageHeader title="Metas" subtitle="A métrica, o caminho e a projeção" />

        <nav className="mb-5 flex flex-wrap gap-1.5">
          <Filter active={areaId === null} onClick={() => setAreaId(null)}>
            Todas
          </Filter>
          {active.map((a) => (
            <Filter
              key={a.id}
              active={areaId === a.id}
              colour={a.color}
              onClick={() => setAreaId(a.id)}
            >
              {/* Ícone + nome junto da cor: ela tinge, nunca codifica (ADR-0017). */}
              <SphereIcon name={a.icon} size={12} />
              {a.name}
            </Filter>
          ))}
        </nav>

        <GoalsList areaId={areaId} />
      </div>
    </div>
  );
}

function Filter({
  active,
  colour,
  onClick,
  children,
}: {
  active: boolean;
  colour?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={colour ? ({ "--sphere": colour } as React.CSSProperties) : undefined}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium",
        "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        active
          ? colour
            ? "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--text-primary)]"
            : "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </button>
  );
}
