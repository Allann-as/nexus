/**
 * Ícone Lucide por NOME (string), para o que vem do backend.
 *
 * As conquistas (`domain::achievements`) carregam o nome do ícone Lucide como
 * texto — nunca um emoji (M4.6 §3.2). Este mapa resolve esse nome para o
 * componente. Fechado de propósito: só os ícones que o catálogo usa entram, e um
 * nome desconhecido cai num fallback visível em vez de quebrar a tela.
 */

import {
  Award,
  BookOpen,
  CalendarCheck,
  CalendarHeart,
  Flame,
  PiggyBank,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  target: Target,
  "piggy-bank": PiggyBank,
  "book-open": BookOpen,
  "calendar-check": CalendarCheck,
  "calendar-heart": CalendarHeart,
  "trending-up": TrendingUp,
  trophy: Trophy,
  sparkles: Sparkles,
};

/**
 * O mesmo mapa, resolvido para o COMPONENTE.
 *
 * A Timeline precisa do ícone como valor (ela monta o `LedgerMeta` de cada
 * evento antes de renderizar), não como elemento pronto — e reimplementar o
 * mapa lá seria a segunda tabela de nomes Lucide do app, livre para divergir.
 */
export function lucideByName(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Award;
}

export function DynamicIcon({
  name,
  className,
  size,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  const Icon = ICONS[name] ?? Award;
  return <Icon className={className} size={size} aria-hidden />;
}
