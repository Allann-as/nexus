/**
 * O ícone de uma Esfera, resolvido pelo nome kebab-case guardado em `areas.icon`.
 *
 * Por que um mapa explícito e não `lucide[name]`: importar a biblioteca inteira
 * para resolver um nome em runtime traria ~1.500 ícones para o bundle e mataria
 * o tree-shaking — um custo de cold start permanente para dar ao usuário uma
 * escolha que ele faz uma vez. O mapa lista o que o wizard oferece; o que não
 * estiver aqui cai num círculo, que é feio mas não quebra nada.
 */

import {
  Briefcase,
  Circle,
  Dumbbell,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  Landmark,
  Leaf,
  Music,
  PawPrint,
  Plane,
  Sparkles,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "heart-pulse": HeartPulse,
  heart: Heart,
  wallet: Wallet,
  target: Target,
  briefcase: Briefcase,
  "graduation-cap": GraduationCap,
  home: Home,
  landmark: Landmark,
  leaf: Leaf,
  music: Music,
  "paw-print": PawPrint,
  plane: Plane,
  sparkles: Sparkles,
  users: Users,
  dumbbell: Dumbbell,
  circle: Circle,
};

/** Os ícones que o wizard "+ Nova Esfera" oferece. */
export const ICON_CHOICES = Object.keys(ICONS);

export function sphereIcon(name: string): LucideIcon {
  return ICONS[name] ?? Circle;
}

export function SphereIcon({
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
  const Icon = sphereIcon(name);
  return <Icon size={size} strokeWidth={2} className={className} style={style} />;
}
