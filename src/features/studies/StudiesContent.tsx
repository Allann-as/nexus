/**
 * O ponto único que o SphereScreen liga para a Esfera de Estudos.
 *
 * Troca a tab pelo conteúdo: Biblioteca (a estante visual), as três TRILHAS de
 * matérias — Idiomas, Faculdade e Cursos, cada uma com o seu próprio componente
 * e a sua própria chave de cache — e, no padrão, o Painel. A tab "Metas" é do
 * próprio SphereScreen — não chega aqui.
 *
 * Até a v1.2 as três trilhas eram O MESMO componente sobre a mesma lista de
 * projetos, mudando só o título: por isso o idioma criado em Idiomas aparecia
 * dentro de Faculdade. Agora cada uma lê a sua `track`.
 */

import { CollegeTrack } from "./CollegeTrack";
import { CoursesTrack } from "./CoursesTrack";
import { LanguagesTrack } from "./LanguagesTrack";
import { LibraryTab } from "./LibraryTab";
import { StudiesDashboard } from "./StudiesDashboard";
import { SubjectsTrack } from "./SubjectsTrack";

export function StudiesContent({ areaId, tab }: { areaId: string; tab: string }) {
  if (tab === "subjects") return <SubjectsTrack areaId={areaId} />;
  if (tab === "library") return <LibraryTab areaId={areaId} />;
  if (tab === "languages") return <LanguagesTrack areaId={areaId} />;
  if (tab === "college") return <CollegeTrack areaId={areaId} />;
  if (tab === "courses") return <CoursesTrack areaId={areaId} />;
  return <StudiesDashboard areaId={areaId} />;
}
