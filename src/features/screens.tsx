/**
 * As telas de módulo que ainda não têm conteúdo.
 *
 * Cada módulo é dono de uma rota, um header e um empty state desenhado desde o
 * primeiro dia, para o shell ser navegável e honesto sobre o que ainda não
 * existe. Conforme cada marco entrega, a tela sai daqui para
 * `features/<módulo>/` e ganha conteúdo de verdade — foi o caminho do Dashboard
 * (M2, e agora do Hub) e dos Hábitos.
 *
 * `TodayScreen` morreu no M2.5: a pergunta "o que tenho hoje?" é respondida pelo
 * Hub, que é a tela inicial. Manter um item de menu para uma segunda versão dela
 * seria o app perguntando ao usuário qual das duas telas de hoje ele quis.
 */

import { Sparkles, type LucideIcon } from "lucide-react";

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
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="min-h-0 flex-1 pb-16">
        <EmptyState icon={icon} title={emptyTitle} hint={hint} />
      </div>
    </div>
  );
}

// `CalendarScreen` saiu daqui no M3: virou `features/calendar/CalendarScreen`,
// com mês/semana/dia, timeblocking por arrasto e detecção de conflitos. Foi o
// mesmo caminho do Dashboard (M2) e dos Hábitos — a tela nasce como promessa
// honesta aqui e sai quando o marco a entrega.

// `NotesScreen` saiu daqui no M4: virou `features/notes/NotesScreen`, com editor
// CodeMirror 6, preview ao vivo, [[wiki-links]] + backlinks e anexos por SHA-256.

// `TimelineScreen` saiu daqui no M4: virou `features/timeline/TimelineScreen`,
// com scrubber de ano/mês, feed do ledger agrupado por dia, visão-ano por
// rollups congelados e o "Neste dia". Mesmo caminho do Calendário e dos Hábitos.

export const InsightsScreen = () => (
  <Module
    title="Insights"
    subtitle="Estatística determinística — zero IA"
    icon={Sparkles}
    emptyTitle="Ainda sem dados suficientes"
    hint="Correlações entre hábitos, ofensores por dia da semana e tendências de metas exigem ao menos 30 dias de dados. Motor no M4."
  />
);
