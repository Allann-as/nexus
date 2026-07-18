//! A Revisão Semanal (M5) — o ritual de 6 passos.
//!
//! Dois cuidados de produto guiam o desenho:
//!
//! 1. **Interrompível e retomável.** O progresso (em que passo você está + o
//!    texto da reflexão) vive num RASCUNHO em disco (`weekly-review-draft.json`),
//!    não no banco. Fechar no passo 3 e voltar continua no passo 3. E o evento
//!    `weekly_review_completed` só entra no ledger quando os 6 passos fecham —
//!    **uma revisão abandonada NÃO vira fato.** O rascunho é chaveado pela semana:
//!    ao virar a semana, um rascunho velho é ignorado (começa do zero).
//!
//! 2. **Números honestos.** O passo dos hábitos devolve o desempenho REAL da
//!    semana (agendados × cumpridos). Os "porquês" estatísticos vêm dos insights
//!    de verdade (o front cruza com as correlações); uma semana sem padrão mostra
//!    "sem padrão detectável", nunca uma narrativa inventada.
//!
//! Idempotência: um review por semana. O `entity_id` do evento é a segunda-feira
//! da semana; concluir de novo a mesma semana é recusado.

use std::sync::Arc;

use chrono::Duration;
use serde::{Deserialize, Serialize};

use crate::application::ports::{Clock, HabitRepository, LedgerRepository};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, LedgerEntry, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day, week_start};
use crate::domain::streak::TickStatus;
use crate::infrastructure::paths::Paths;

/// O número de passos do ritual (triagem, órfãs, hábitos, metas, agenda, reflexão).
pub const STEPS: i64 = 6;

const DRAFT_FILE: &str = "weekly-review-draft.json";

/// O estado da revisão da semana corrente — o que a tela precisa para abrir no
/// lugar certo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReviewState {
    /// A segunda-feira da semana ('YYYY-MM-DD') — o id do review.
    pub week_id: String,
    pub week_start: String,
    pub week_end: String,
    /// Em que passo o rascunho parou (0 = ainda não começou; 1..=6).
    pub step: i64,
    pub reflection: String,
    /// Esta semana já foi revisada? (Idempotência — o evento já está no ledger.)
    pub completed_this_week: bool,
}

/// O desempenho de um hábito na semana — números reais, sem narrativa.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitWeek {
    pub habit_id: String,
    pub title: String,
    /// Dias em que o hábito ESTAVA agendado nesta semana.
    pub scheduled: i64,
    /// Dias em que foi cumprido (tick 'done').
    pub done: i64,
}

/// O rascunho persistido em disco.
#[derive(Debug, Serialize, Deserialize)]
struct Draft {
    week_id: String,
    step: i64,
    reflection: String,
}

pub struct WeeklyReviewService {
    pub ledger: Arc<dyn LedgerRepository>,
    pub habits: Arc<dyn HabitRepository>,
    pub clock: Arc<dyn Clock>,
    pub paths: Paths,
}

impl WeeklyReviewService {
    /// A segunda-feira da semana que contém hoje — o id do review.
    fn current_week_id(&self) -> Result<String> {
        let today = parse_day(&self.clock.today_local())?;
        Ok(format_day(week_start(today)))
    }

    /// O estado da revisão da semana corrente.
    pub fn state(&self) -> Result<WeeklyReviewState> {
        let today = parse_day(&self.clock.today_local())?;
        let monday = week_start(today);
        let sunday = monday + Duration::days(6);
        let week_id = format_day(monday);

        let completed = self.completed_for(&week_id)?;

        // Só retoma um rascunho DESTA semana; um da semana passada é lixo.
        let draft = self.load_draft().filter(|d| d.week_id == week_id);
        let (step, reflection) = draft
            .map(|d| (d.step, d.reflection))
            .unwrap_or((0, String::new()));

        Ok(WeeklyReviewState {
            week_id,
            week_start: format_day(monday),
            week_end: format_day(sunday),
            step,
            reflection,
            completed_this_week: completed,
        })
    }

    /// Salva o progresso do rascunho (passo atual + reflexão). Idempotente.
    pub fn save_progress(&self, step: i64, reflection: String) -> Result<()> {
        let step = step.clamp(0, STEPS);
        let week_id = self.current_week_id()?;
        self.save_draft(&Draft {
            week_id,
            step,
            reflection,
        })
    }

    /// O desempenho de cada hábito ativo nesta semana (segunda a domingo).
    pub fn habits_this_week(&self) -> Result<Vec<HabitWeek>> {
        let today = parse_day(&self.clock.today_local())?;
        let monday = week_start(today);
        let sunday = monday + Duration::days(6);
        let (from, to) = (format_day(monday), format_day(sunday));

        let mut out = Vec::new();
        for habit in self.habits.list(None, false)? {
            // Dias agendados na semana: varre os 7 dias e pergunta à agenda.
            let scheduled = (0..7)
                .filter(|d| habit.schedule.is_scheduled_on(monday + Duration::days(*d)))
                .count() as i64;

            let done = self
                .habits
                .ticks_in_range(&habit.id, &from, &to)?
                .into_iter()
                .filter(|(_, tick)| tick.status == TickStatus::Done)
                .count() as i64;

            out.push(HabitWeek {
                habit_id: habit.id,
                title: habit.title,
                scheduled,
                done,
            });
        }
        Ok(out)
    }

    /// Conclui a revisão: grava `weekly_review_completed` no ledger e apaga o
    /// rascunho. Recusa se a semana já foi revisada (um review por semana).
    pub fn complete(&self, reflection: String) -> Result<LedgerEntry> {
        let today = parse_day(&self.clock.today_local())?;
        let monday = week_start(today);
        let sunday = monday + Duration::days(6);
        let week_id = format_day(monday);

        if self.completed_for(&week_id)? {
            return Err(NexusError::Validation(
                "a revisão desta semana já foi concluída".into(),
            ));
        }

        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: week_id.clone(),
            entity_kind: LedgerEntityKind::WeeklyReview,
            event_type: EventType::WeeklyReviewCompleted,
            payload: serde_json::json!({
                "weekStart": format_day(monday),
                "weekEnd": format_day(sunday),
                "reflection": reflection,
            }),
            title_snapshot: format!("Revisão da semana de {}", format_day(monday)),
        };
        let seq = self.ledger.append(&event)?;

        // O rascunho cumpriu seu papel: some. A partir de agora o FATO está no
        // ledger, e a próxima semana começa com um rascunho limpo.
        let _ = self.clear_draft();

        Ok(LedgerEntry {
            seq,
            ts: event.ts,
            day: event.day,
            entity_id: event.entity_id,
            entity_kind: event.entity_kind.as_str().to_string(),
            event_type: event.event_type.as_str().to_string(),
            payload: event.payload.to_string(),
            title_snapshot: event.title_snapshot,
        })
    }

    /// Já existe um `weekly_review_completed` para esta semana?
    fn completed_for(&self, week_id: &str) -> Result<bool> {
        Ok(self
            .ledger
            .for_entity(week_id, 4)?
            .iter()
            .any(|e| e.event_type == "weekly_review_completed"))
    }

    fn draft_path(&self) -> std::path::PathBuf {
        self.paths.root.join(DRAFT_FILE)
    }

    fn load_draft(&self) -> Option<Draft> {
        let bytes = std::fs::read(self.draft_path()).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    fn save_draft(&self, draft: &Draft) -> Result<()> {
        let json = serde_json::to_vec_pretty(draft)
            .map_err(|e| NexusError::Storage(format!("rascunho da revisão: {e}")))?;
        std::fs::write(self.draft_path(), json).map_err(|e| NexusError::Storage(e.to_string()))
    }

    fn clear_draft(&self) -> Result<()> {
        let _ = std::fs::remove_file(self.draft_path());
        Ok(())
    }
}
