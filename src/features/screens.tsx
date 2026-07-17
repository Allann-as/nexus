/**
 * M0 module screens.
 *
 * Each module owns a route, a header and a designed empty state from day one,
 * so the shell is navigable and honest about what is not built yet. As each
 * milestone lands, its screen moves out into `features/<module>/` and gains
 * real content. The Dashboard is already live against the backend.
 */

import {
  Sun,
  Calendar,
  FileText,
  History,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { EmptyState, PageHeader } from "../design-system/primitives";

function Module({
  title,
  subtitle,
  icon,
  emptyTitle,
  hint,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  emptyTitle: string;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="min-h-0 flex-1 pb-16">
        <EmptyState icon={icon} title={emptyTitle} hint={hint} />
      </div>
    </div>
  );
}

export const TodayScreen = () => (
  <Module
    title="Hoje"
    subtitle="Seus eventos, tarefas e hábitos de hoje"
    icon={Sun}
    emptyTitle="Nada agendado"
    hint="Eventos, tarefas com horário e hábitos do dia aparecem aqui em ordem cronológica, a partir do M2."
  />
);

export const CalendarScreen = () => (
  <Module
    title="Calendário"
    subtitle="Mês, semana e dia com timeblocking"
    icon={Calendar}
    emptyTitle="Nenhum evento"
    hint="Timeblocking por arrasto, recorrência RFC-5545 e detecção de conflitos chegam no M3."
  />
);

export const NotesScreen = () => (
  <Module
    title="Notas"
    subtitle="Markdown puro — um formato eterno"
    icon={FileText}
    emptyTitle="Nenhuma nota ainda"
    hint="Editor Markdown com preview ao vivo, [[wiki-links]] para qualquer node e backlinks automáticos. Chegam no M4."
  />
);

export const TimelineScreen = () => (
  <Module
    title="Timeline"
    subtitle="A máquina do tempo"
    icon={History}
    emptyTitle="Sua história começa agora"
    hint="Cada ação registrada vira um evento imutável no ledger. Quando houver história, ela aparece aqui — M4."
  />
);

export const InsightsScreen = () => (
  <Module
    title="Insights"
    subtitle="Estatística determinística — zero IA"
    icon={Sparkles}
    emptyTitle="Ainda sem dados suficientes"
    hint="Correlações entre hábitos, ofensores por dia da semana e tendências de metas exigem ao menos 30 dias de dados. Motor no M4."
  />
);
