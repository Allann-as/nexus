/** Metadados dos tipos de marco de carreira — ícone Lucide e rótulo, num lugar só. */

import {
  Award,
  Medal,
  Rocket,
  ScrollText,
  Star,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import type { CareerMilestoneKind } from "../../lib/ipc";

export const CAREER_KIND_META: Record<
  CareerMilestoneKind,
  { icon: LucideIcon; label: string }
> = {
  promotion: { icon: TrendingUp, label: "Promoção" },
  certification: { icon: ScrollText, label: "Certificação" },
  new_job: { icon: Rocket, label: "Novo emprego" },
  raise: { icon: Award, label: "Aumento" },
  award: { icon: Medal, label: "Prêmio" },
  other: { icon: Star, label: "Marco" },
};

export const CAREER_KINDS: CareerMilestoneKind[] = [
  "promotion",
  "certification",
  "new_job",
  "raise",
  "award",
  "other",
];
