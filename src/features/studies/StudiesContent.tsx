/**
 * O ponto único que o SphereScreen liga para a Esfera de Estudos.
 *
 * Troca a tab pelo conteúdo: Biblioteca (a estante visual), os projetos de
 * Idiomas/Faculdade/Cursos (reuso do conceito de projeto) e, no padrão, o
 * Painel. A tab "Metas" é do próprio SphereScreen — não chega aqui.
 */

import { LibraryTab } from "./LibraryTab";
import { StudyProjectsTab } from "./StudyProjectsTab";
import { StudiesDashboard } from "./StudiesDashboard";

export function StudiesContent({ areaId, tab }: { areaId: string; tab: string }) {
  if (tab === "library") return <LibraryTab areaId={areaId} />;
  if (tab === "languages") return <StudyProjectsTab areaId={areaId} label="Idiomas" />;
  if (tab === "college") return <StudyProjectsTab areaId={areaId} label="Faculdade" />;
  if (tab === "courses") return <StudyProjectsTab areaId={areaId} label="Cursos" />;
  return <StudiesDashboard areaId={areaId} />;
}
