/**
 * O conteúdo de uma Esfera 'simple' — o template do que o usuário cria.
 *
 * Deliberadamente raso (§2.4): Agenda (compromissos no calendário) + Checklists
 * (listas de checkboxes) + o painel genérico. É o template de "Espiritualidade",
 * "Casa", "Pets" — sem dashboard complexo, só a cor da Esfera e o essencial.
 */

import type { Area, SphereCard } from "../../lib/ipc";
import { SphereDashboard } from "../spheres/SphereDashboard";
import { AgendaTab } from "./AgendaTab";
import { ChecklistsTab } from "./ChecklistsTab";

export function SimpleContent({
  sphere,
  card,
  tab,
}: {
  sphere: Area;
  card: SphereCard | undefined;
  tab: string;
}) {
  if (tab === "agenda") return <AgendaTab areaId={sphere.id} />;
  if (tab === "checklists") return <ChecklistsTab areaId={sphere.id} />;
  return <SphereDashboard sphere={sphere} card={card} />;
}
