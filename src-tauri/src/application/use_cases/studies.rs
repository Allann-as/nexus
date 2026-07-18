//! Casos de uso dos Estudos (M4.6, item 7): matérias, sessões e estatísticas.
//!
//! Uma **matéria** (`subject`) é um node; seu progresso é COMPUTADO das sessões,
//! nunca gravado. Uma **sessão** é um LOG (`study_sessions`), não um node — como o
//! aporte (ADR-0027/0045): registrá-la grava estado + o evento `study_session_logged`
//! na mesma transação, e vale XP (ADR-0047).
//!
//! As **estatísticas** seguem o padrão dos insights (constituição §2): números
//! determinísticos, cada um com a fórmula à mostra e o tamanho da amostra. Nada
//! inventado — sem dado, o campo volta `None` e a UI omite.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, IdGen, NewNode, NewStudySession, NewSubject, StudySession,
    StudySessionRepository, Subject, SubjectRepository,
};
use crate::domain::entities::{validate_title, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};

/// Quantas sessões recentes o painel e o card de matéria mostram.
const RECENT_LIMIT: i64 = 8;
/// Quantas sessões recentes um card de matéria mostra.
const SUBJECT_RECENT: i64 = 5;

pub struct StudyService {
    pub subjects: Arc<dyn SubjectRepository>,
    pub sessions: Arc<dyn StudySessionRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

/// O progresso de uma matéria — tudo COMPUTADO das sessões.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectProgress {
    pub subject: Subject,
    pub total_minutes: i64,
    pub session_count: i64,
    /// O dia da última sessão, ou `None` se a matéria ainda não foi estudada.
    pub last_day: Option<String>,
    pub books_touched: i64,
    /// Itens vinculados por `links` (uma meta de carreira, um livro) — omitido se 0.
    pub linked_count: i64,
    /// `total_minutes / target_minutes`, saturado em 1 — `None` se não há meta.
    pub target_progress: Option<f64>,
    /// As últimas sessões da matéria (as mais recentes primeiro).
    pub recent: Vec<StudySession>,
}

/// Minutos somados numa hora do dia (0–23) — a base de "melhores horários".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HourBucket {
    pub hour: i64,
    pub minutes: i64,
}

/// As estatísticas de estudo, determinísticas e com fórmula (constituição §2).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyStats {
    /// Minutos dos últimos 7 dias (hoje inclusive).
    pub minutes_last_7: i64,
    /// Minutos dos 7 dias ANTERIORES — a base da tendência semanal.
    pub minutes_prev_7: i64,
    /// Dias DISTINTOS com sessão nos últimos 30 — a constância.
    pub active_days_30: i64,
    /// A hora do dia com mais minutos acumulados, ou `None` sem dado.
    pub best_hour: Option<i64>,
    pub best_hour_minutes: i64,
    /// A distribuição por hora (só as horas com minutos) — para o gráfico.
    pub by_hour: Vec<HourBucket>,
    /// Total de minutos de sempre.
    pub total_minutes: i64,
    /// Total de sessões de sempre — o tamanho da amostra.
    pub total_sessions: i64,
    pub formula: String,
}

impl StudyService {
    /* ===== Matérias ===== */

    pub fn create_subject(
        &self,
        title: &str,
        area_id: Option<String>,
        category: Option<String>,
        target_minutes: Option<i64>,
    ) -> Result<Subject> {
        let title = validate_title(title)?;
        if let Some(a) = &area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a}")));
            }
        }
        if let Some(t) = target_minutes {
            if t <= 0 {
                return Err(NexusError::Validation(
                    "a meta de estudo precisa ser positiva".into(),
                ));
            }
        }
        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::Subject),
            event_type: EventType::Created,
            payload: json!({ "category": category }),
            title_snapshot: title.clone(),
        };
        self.subjects.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Subject,
                title,
                area_id,
                parent_id: None,
            },
            &NewSubject {
                title: String::new(), // o título mora no node; o satélite não o repete
                area_id: None,
                category,
                target_minutes,
            },
            &event,
        )
    }

    pub fn subjects(&self, area_id: Option<String>) -> Result<Vec<Subject>> {
        self.subjects.list(area_id.as_deref())
    }

    /// Ajusta a meta de minutos (configuração — não grava no ledger, ADR-0023).
    pub fn set_subject_target(&self, id: &str, target_minutes: Option<i64>) -> Result<Subject> {
        if let Some(t) = target_minutes {
            if t <= 0 {
                return Err(NexusError::Validation(
                    "a meta de estudo precisa ser positiva".into(),
                ));
            }
        }
        self.subjects
            .set_target(id, target_minutes, self.clock.now_ms())
    }

    pub fn archive_subject(&self, id: &str) -> Result<()> {
        self.subjects.archive(id, self.clock.now_ms())
    }

    /// O progresso agregado de uma matéria: minutos, sessões, meta e as últimas.
    pub fn subject_progress(&self, id: &str) -> Result<SubjectProgress> {
        let subject = self.subjects.get(id)?;
        let summary = self.sessions.subject_summary(id)?;
        let linked_count = self.subjects.linked_count(id)?;
        let recent = self.sessions.recent_for_subject(id, SUBJECT_RECENT)?;
        let target_progress = subject.target_minutes.and_then(|t| {
            if t > 0 {
                Some((summary.total_minutes as f64 / t as f64).min(1.0))
            } else {
                None
            }
        });
        Ok(SubjectProgress {
            subject,
            total_minutes: summary.total_minutes,
            session_count: summary.session_count,
            last_day: summary.last_day,
            books_touched: summary.books_touched,
            linked_count,
            target_progress,
            recent,
        })
    }

    /* ===== Sessões ===== */

    /// Registra uma sessão de estudo — um FATO no ledger que vale XP (ADR-0047).
    pub fn log_session(
        &self,
        subject_id: Option<String>,
        book_id: Option<String>,
        skill_id: Option<String>,
        topic: Option<String>,
        minutes: i64,
        day: Option<String>,
    ) -> Result<StudySession> {
        if minutes <= 0 {
            return Err(NexusError::Validation(
                "a sessão precisa ter ao menos 1 minuto".into(),
            ));
        }
        // O dia é do usuário (uma sessão pode ser lançada retroativa); o futuro é
        // recusado, como o `day` de um tick — uma data futura envenena as médias.
        let today = self.clock.today_local();
        let day = match day {
            Some(d) => {
                let parsed = format_day(parse_day(&d)?);
                if parsed > today {
                    return Err(NexusError::Validation(
                        "não dá para registrar estudo no futuro".into(),
                    ));
                }
                parsed
            }
            None => today,
        };
        let topic = topic
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());

        // Um snapshot legível para a Timeline: a matéria, ou o tópico, ou genérico.
        let subject_title = match &subject_id {
            Some(sid) => self.subjects.get(sid).ok().map(|s| s.title),
            None => None,
        };
        let label = subject_title
            .clone()
            .or_else(|| topic.clone())
            .unwrap_or_else(|| "estudo".to_string());
        let title_snapshot = format!("Estudou {minutes} min · {label}");

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: day.clone(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::StudySession,
            event_type: EventType::StudySessionLogged,
            payload: json!({
                "minutes": minutes,
                "subjectId": subject_id,
                "bookId": book_id,
                "skillId": skill_id,
            }),
            title_snapshot,
        };
        self.sessions.log_with_event(
            &id,
            &NewStudySession {
                subject_id,
                book_id,
                skill_id,
                topic,
                minutes,
                day,
            },
            now,
            &event,
        )
    }

    pub fn recent_sessions(&self, area_id: Option<String>) -> Result<Vec<StudySession>> {
        self.sessions.recent(area_id.as_deref(), RECENT_LIMIT)
    }

    /// Apaga uma sessão registrada por engano — corrige o ESTADO (progresso, XP,
    /// estatísticas), sem tocar no ledger (a história fica). Ver `delete` no repo.
    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.sessions.delete(id)
    }

    /* ===== Estatísticas ===== */

    /// As estatísticas de estudo — horas na semana, tendência, constância e horários.
    pub fn study_stats(&self, area_id: Option<String>) -> Result<StudyStats> {
        let a = area_id.as_deref();
        let today = parse_day(&self.clock.today_local())?;
        // Janela dos últimos 7 dias (hoje inclusive) e a anterior, para a tendência.
        let last_from = format_day(today - chrono::Duration::days(6));
        let to = format_day(today);
        let prev_from = format_day(today - chrono::Duration::days(13));
        let prev_to = format_day(today - chrono::Duration::days(7));

        let minutes_last_7 = self.sessions.minutes_between(a, &last_from, &to)?;
        let minutes_prev_7 = self.sessions.minutes_between(a, &prev_from, &prev_to)?;
        let active_days_30 = self
            .sessions
            .active_days_since(a, &format_day(today - chrono::Duration::days(29)))?;

        let by_hour_raw = self.sessions.minutes_by_hour(a)?;
        let (best_hour, best_hour_minutes) = by_hour_raw
            .iter()
            .max_by_key(|(_, m)| *m)
            .map(|(h, m)| (Some(*h), *m))
            .unwrap_or((None, 0));
        let by_hour = by_hour_raw
            .into_iter()
            .map(|(hour, minutes)| HourBucket { hour, minutes })
            .collect();

        let (total_minutes, total_sessions) = self.sessions.totals(a)?;

        Ok(StudyStats {
            minutes_last_7,
            minutes_prev_7,
            active_days_30,
            best_hour,
            best_hour_minutes,
            by_hour,
            total_minutes,
            total_sessions,
            formula: "Horas na semana = soma dos minutos das sessões dos últimos 7 dias ÷ 60. \
                      Constância = dias distintos com ao menos uma sessão nos últimos 30. \
                      Melhor horário = a hora do dia (local) com mais minutos somados."
                .to_string(),
        })
    }
}
