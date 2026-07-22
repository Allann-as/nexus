/**
 * O conteúdo da Esfera Carreira, por tab. Ponto único que o SphereScreen invoca.
 */

import { CareerDashboard } from "./CareerDashboard";
import { CareerMilestones } from "./CareerMilestones";
import { CareerProjects } from "./CareerProjects";
import { SkillsTrack } from "./SkillsTrack";

export function CareerContent({ areaId, tab }: { areaId: string; tab: string }) {
  // Os marcos são um fato do LEDGER, não um node de Esfera: a aba não recebe
  // `areaId` porque não há por onde filtrar — a carreira é uma só.
  if (tab === "milestones") {
    return <CareerMilestones />;
  }
  if (tab === "projects") {
    return (
      <CareerProjects
        areaId={areaId}
        label="Projetos"
        hint="Projetos profissionais: uma migração, um lançamento, uma iniciativa que você lidera."
      />
    );
  }
  if (tab === "skills") {
    return <SkillsTrack areaId={areaId} />;
  }
  return <CareerDashboard areaId={areaId} />;
}
