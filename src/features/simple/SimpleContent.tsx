/**
 * O conteúdo de uma Esfera 'simple' — a Casa, e toda Esfera que o usuário criar.
 *
 * Alinhada ao padrão do app na fase 4 (ADR-0096): Painel, Checkpoints, Metas e
 * Notas. Nada aqui é uma tela própria do template — os Checkpoints são os MESMOS
 * de todas as Esferas e as Notas são as mesmas da tela global, recortadas por
 * Esfera. Uma Esfera genérica não merece componentes genéricos piores: merece os
 * mesmos.
 */

import type { Area, SphereCard } from "../../lib/ipc";
import { SphereCheckpoints } from "../spheres/SphereCheckpoints";
import { SphereDashboard } from "../spheres/SphereDashboard";
import { SphereNotes } from "./SphereNotes";

export function SimpleContent({
  sphere,
  card,
  tab,
}: {
  sphere: Area;
  card: SphereCard | undefined;
  tab: string;
}) {
  if (tab === "checkpoints") return <SphereCheckpoints areaId={sphere.id} />;
  if (tab === "notes") return <SphereNotes areaId={sphere.id} />;
  return <SphereDashboard sphere={sphere} card={card} />;
}
