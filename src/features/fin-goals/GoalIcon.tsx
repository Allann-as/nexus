/**
 * O ícone de uma caixinha — Lucide, nunca emoji (M4.6 §3.2).
 *
 * A coluna `fin_goal_details.emoji` (0011) passou a guardar o NOME de um ícone
 * Lucide em vez de um emoji (ADR-0042 — o nome da coluna é legado, como "Aurora").
 * Caixinhas antigas guardam um emoji de verdade nessa coluna; `GoalIcon` cai num
 * ícone padrão para qualquer valor que não seja um nome conhecido — nada quebra.
 */

import {
  Camera,
  Car,
  Gamepad2,
  Gem,
  GraduationCap,
  Home,
  Laptop,
  Music,
  Palmtree,
  PiggyBank,
  Plane,
  Target,
  type LucideIcon,
} from "lucide-react";

/** O conjunto oferecido no seletor. A ordem é a da grade. */
export const GOAL_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: "target", Icon: Target },
  { name: "gamepad2", Icon: Gamepad2 },
  { name: "plane", Icon: Plane },
  { name: "home", Icon: Home },
  { name: "car", Icon: Car },
  { name: "laptop", Icon: Laptop },
  { name: "camera", Icon: Camera },
  { name: "gem", Icon: Gem },
  { name: "palmtree", Icon: Palmtree },
  { name: "graduation-cap", Icon: GraduationCap },
  { name: "piggy-bank", Icon: PiggyBank },
  { name: "music", Icon: Music },
];

const BY_NAME = new Map(GOAL_ICONS.map((g) => [g.name, g.Icon]));

export function GoalIcon({
  name,
  size = 18,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = BY_NAME.get(name) ?? Target;
  return <Icon size={size} className={className} style={style} aria-hidden />;
}
