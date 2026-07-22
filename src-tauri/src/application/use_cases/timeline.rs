//! Casos de uso da Timeline — a Máquina do Tempo.
//!
//! A visão MÊS lê o ledger paginado; a visão ANO lê rollups congelados. O job de
//! fechamento (`ensure_rollups`) congela os meses completos na primeira vez que
//! a Timeline abre num mês novo — o gesto de navegar paga a escrita, como a
//! extensão do calendário (ADR-0026). Sem ledger próprio: congelar não é um fato
//! da vida do usuário.

use std::sync::Arc;

use crate::application::ports::{
    Clock, LedgerRepository, MonthRollup, RangeSummary, TimelineRepository,
};
use crate::domain::errors::Result;
use crate::domain::ledger::LedgerEntry;

pub struct TimelineService {
    pub timeline: Arc<dyn TimelineRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub clock: Arc<dyn Clock>,
}

impl TimelineService {
    /// Os eventos de um intervalo de dias — a visão MÊS, paginada.
    pub fn range(
        &self,
        from_day: &str,
        to_day: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LedgerEntry>> {
        self.ledger.range(from_day, to_day, limit, offset)
    }

    /// A visão ANO: um `MonthRollup` por mês do ano.
    pub fn year(&self, year: &str) -> Result<Vec<MonthRollup>> {
        let current_month = &self.clock.today_local()[..7];
        self.timeline.year(year, current_month)
    }

    /// O censo de um intervalo — o total real e a quebra por tipo.
    pub fn summary(&self, from_day: &str, to_day: &str) -> Result<RangeSummary> {
        self.timeline.summary(from_day, to_day)
    }

    /// Os anos que têm história — as bordas do scrubber.
    pub fn years(&self) -> Result<Vec<String>> {
        self.timeline.years()
    }

    /// "Neste dia" — o que aconteceu no mesmo dia de anos anteriores.
    pub fn on_this_day(&self) -> Result<Vec<LedgerEntry>> {
        self.timeline.on_this_day(&self.clock.today_local())
    }

    /// Congela todo mês completo que ainda não foi congelado. Idempotente e
    /// barato quando não há nada a fazer (o caso normal): compara duas listas.
    ///
    /// Chamado pela UI ao abrir a Timeline — o mesmo padrão da extensão do
    /// calendário (ADR-0026): a escrita mora num comando explícito, disparado
    /// pela navegação, nunca na leitura (o pool de leitura é `query_only`).
    pub fn ensure_rollups(&self) -> Result<usize> {
        let current_month = self.clock.today_local()[..7].to_string();
        let candidates = self.timeline.ledger_months_before(&current_month)?;
        let done: std::collections::HashSet<String> =
            self.timeline.rolled_up_months()?.into_iter().collect();

        let now = self.clock.now_ms();
        let mut frozen = 0;
        for month in candidates {
            if !done.contains(&month) {
                self.timeline.freeze_month(&month, now)?;
                frozen += 1;
            }
        }
        Ok(frozen)
    }
}
