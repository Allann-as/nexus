/**
 * As trilhas de Estudos: rótulo e ícone de cada uma, num lugar só.
 *
 * `SubjectTrack` é a coluna que separa as quatro seções da Esfera (livre,
 * idioma, faculdade, curso). O rótulo em português e o ícone viviam soltos
 * dentro do `LegacyStudyProjects`; quando o Painel passou a listar matérias de
 * TODAS as trilhas juntas, ele precisou dos mesmos pares — e duas listas de
 * rótulos é como uma trilha vira "Curso" numa tela e "Cursos" na outra.
 */

import { BookMarked, GraduationCap, Languages, MonitorPlay, type LucideIcon } from "lucide-react";

import type { SubjectTrack } from "../../lib/ipc";

export const TRACK_META: Record<SubjectTrack, { label: string; icon: LucideIcon }> = {
  livre: { label: "Matéria", icon: BookMarked },
  idioma: { label: "Idioma", icon: Languages },
  faculdade: { label: "Faculdade", icon: GraduationCap },
  curso: { label: "Curso", icon: MonitorPlay },
};
