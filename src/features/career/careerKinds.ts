/** Metadados dos tipos de marco de carreira — emoji e rótulo, num lugar só. */

import type { CareerMilestoneKind } from "../../lib/ipc";

export const CAREER_KIND_META: Record<
  CareerMilestoneKind,
  { emoji: string; label: string }
> = {
  promotion: { emoji: "📈", label: "Promoção" },
  certification: { emoji: "📜", label: "Certificação" },
  new_job: { emoji: "🚀", label: "Novo emprego" },
  raise: { emoji: "💰", label: "Aumento" },
  award: { emoji: "🏅", label: "Prêmio" },
  other: { emoji: "⭐", label: "Marco" },
};

export const CAREER_KINDS: CareerMilestoneKind[] = [
  "promotion",
  "certification",
  "new_job",
  "raise",
  "award",
  "other",
];
