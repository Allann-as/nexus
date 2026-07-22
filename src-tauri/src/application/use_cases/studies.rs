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
    AreaRepository, Clock, GoalRepository, IdGen, NewNode, NewStudySession, NewSubject,
    StudySession, StudySessionRepository, Subject, SubjectItem, SubjectRepository,
};
use crate::domain::entities::{validate_title, CourseStage, GoalKind, Kind, SubjectTrack};
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
    /// Para VALIDAR o vínculo de um idioma com a meta que descreve o nível dele
    /// (`set_subject_level_goal`): a meta precisa existir e ser `staged`.
    pub goals: Arc<dyn GoalRepository>,
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
    /// As horas do dia com mais minutos acumulados.
    ///
    /// Uma lista, e não um `Option<i64>`, pela mesma razão do Foco (ADR-0105):
    /// um EMPATE não é uma resposta. Vazia = sem dado; um elemento = a melhor
    /// hora; vários = as horas que empatam no topo, e a UI diz que empatam em
    /// vez de eleger uma delas por ordem de varredura. O código do Foco foi
    /// COPIADO daqui com o `max_by_key`; a correção volta agora para a origem.
    pub best_hours: Vec<i64>,
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

    /// Cria uma matéria numa TRILHA (BÚSSOLA, fase D).
    ///
    /// A trilha é o que diz a qual seção de Estudos a matéria pertence. Sem ela,
    /// Idiomas, Faculdade e Cursos rodavam a mesma query e mostravam os mesmos
    /// itens. `None` vira `Livre` — a aba "Matérias" de sempre.
    #[allow(clippy::too_many_arguments)]
    pub fn create_subject(
        &self,
        title: &str,
        area_id: Option<String>,
        category: Option<String>,
        target_minutes: Option<i64>,
        track: Option<SubjectTrack>,
        course_stage: Option<CourseStage>,
        expected_end: Option<String>,
    ) -> Result<Subject> {
        let title = validate_title(title)?;
        let track = track.unwrap_or_default();
        // Um estágio de curso numa matéria que não é curso seria um idioma
        // carregando "concluído" em silêncio. Ver `set_course_stage`.
        if course_stage.is_some() && track != SubjectTrack::Curso {
            return Err(NexusError::Validation(
                "só um curso tem estágio ('quero fazer', 'fazendo', 'concluído')".into(),
            ));
        }
        // O dia é normalizado agora, para o banco nunca guardar 'AAAA-M-D'. Uma
        // previsão de conclusão PODE ser futura — é para isso que ela existe.
        let expected_end = match expected_end {
            Some(d) => Some(format_day(parse_day(&d)?)),
            None => None,
        };
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
            payload: json!({ "category": category, "track": track.as_str() }),
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
                track,
                course_stage,
                expected_end,
            },
            &event,
        )
    }

    /// As matérias de uma Esfera e/ou de uma TRILHA.
    ///
    /// `track = None` devolve todas — a aba "Matérias" sempre listou tudo e
    /// continua listando. Cada seção nova (Idiomas, Faculdade, Cursos) passa a
    /// sua trilha e vê só o que é dela.
    pub fn subjects(
        &self,
        area_id: Option<String>,
        track: Option<SubjectTrack>,
    ) -> Result<Vec<Subject>> {
        self.subjects.list(area_id.as_deref(), track)
    }

    /// Muda o estágio de um CURSO — configuração, não fato (ADR-0023).
    ///
    /// Recusa em qualquer outra trilha: um idioma com `course_stage` gravado
    /// carregaria um status de curso em silêncio, e a tela de Idiomas — que nem
    /// tem esse campo — nunca daria ao usuário como corrigi-lo.
    pub fn set_course_stage(&self, id: &str, stage: Option<CourseStage>) -> Result<Subject> {
        let subject = self.subjects.get(id)?;
        if subject.track != SubjectTrack::Curso {
            return Err(NexusError::Validation(format!(
                "'{}' não é um curso: só um curso tem estágio ('quero fazer', 'fazendo', 'concluído')",
                subject.title
            )));
        }
        self.subjects
            .set_course_stage(id, stage, self.clock.now_ms())
    }

    /// Ajusta a previsão de conclusão. O futuro é BEM-VINDO aqui (ao contrário
    /// do dia de uma sessão): uma previsão que já passou não previa nada.
    pub fn set_subject_expected_end(&self, id: &str, day: Option<String>) -> Result<Subject> {
        let day = match day {
            Some(d) => Some(format_day(parse_day(&d)?)),
            None => None,
        };
        self.subjects
            .set_expected_end(id, day.as_deref(), self.clock.now_ms())
    }

    /// Liga uma matéria (tipicamente um IDIOMA) à meta que descreve o nível dela.
    ///
    /// A meta tem que ser `staged` — a ESCADA de níveis nomeados ("Básico ->
    /// Fluente"), cujo progresso é o degrau atual sobre o total. Uma meta
    /// quantitativa ou uma conquista não têm degraus nomeados para mostrar, e o
    /// card do idioma ficaria pedindo um nível que a meta não sabe dizer.
    ///
    /// `None` desfaz o vínculo.
    pub fn set_subject_level_goal(&self, id: &str, goal_id: Option<String>) -> Result<Subject> {
        // A matéria precisa existir antes de qualquer coisa.
        self.subjects.get(id)?;
        if let Some(g) = &goal_id {
            // `GoalRepository::get` faz JOIN com `goal_details`: um id que não é
            // uma meta já volta NotFound aqui.
            let goal = self.goals.get(g)?;
            if goal.goal_kind != GoalKind::Staged {
                return Err(NexusError::Validation(format!(
                    "'{}' não é uma meta por etapas: o nível de um idioma só pode \
                     apontar para uma meta do tipo escada (Básico -> Fluente)",
                    goal.title
                )));
            }
        }
        self.subjects
            .set_level_goal(id, goal_id.as_deref(), self.clock.now_ms())
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

    /// Grava o texto curto do que um CURSO ensina (a coluna `summary`, viva no
    /// schema desde a 0017 e sem leitor até a 0020).
    ///
    /// Ao contrário do estágio, isto NÃO é recusado fora da trilha `curso`: uma
    /// matéria livre ou uma disciplina da faculdade também podem descrever em
    /// duas linhas do que se tratam, e nada na tela mente se elas o fizerem. O
    /// que a trilha decide é quem OFERECE o campo, não quem pode tê-lo.
    pub fn set_subject_summary(&self, id: &str, summary: Option<String>) -> Result<Subject> {
        // Texto em branco é ausência, não um parágrafo vazio: assim o card não
        // desenha uma linha de descrição com nada dentro.
        let summary = summary
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        self.subjects
            .set_summary(id, summary.as_deref(), self.clock.now_ms())
    }

    pub fn archive_subject(&self, id: &str) -> Result<()> {
        self.subjects.archive(id, self.clock.now_ms())
    }

    /* ===== Os itens de uma matéria (0020) ===== */

    /// Acrescenta um TEMA (ou uma linha da checklist de um curso) à matéria.
    ///
    /// É decomposição, não fato: não grava no ledger. O que vira evento é a
    /// SESSÃO de estudo — riscar "Bháskara" na lista não é uma hora estudada, e
    /// tratá-lo como fato encheria a Timeline de ruído sem nenhuma hora atrás.
    pub fn add_subject_item(&self, subject_id: &str, title: &str) -> Result<SubjectItem> {
        let title = validate_title(title)?;
        self.subjects
            .add_item(&self.ids.new_id(), subject_id, &title, self.clock.now_ms())
    }

    pub fn subject_items(&self, subject_id: &str) -> Result<Vec<SubjectItem>> {
        self.subjects.list_items(subject_id)
    }

    pub fn set_subject_item_done(&self, id: &str, done: bool) -> Result<SubjectItem> {
        self.subjects.set_item_done(id, done)
    }

    pub fn delete_subject_item(&self, id: &str) -> Result<()> {
        self.subjects.delete_item(id)
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
        self.log_session_at(subject_id, book_id, skill_id, topic, minutes, day, None)
    }

    /// O mesmo, com o INSTANTE explícito — a hora do dia em que a sessão aconteceu.
    ///
    /// Existe para o **seed**, e só para ele, pela mesma razão do `focus`
    /// (ADR-0105): `study_stats` responde "quando você estuda" somando `ts` por
    /// hora do dia, e um seed que registrasse tudo pelo relógio da máquina
    /// empilharia meses de estudo na hora em que o seed rodou — o gráfico de 24
    /// barras viraria uma barra, provando a tese da tela com uma distribuição
    /// falsa. **Não é exposto como command**: a UI nunca escolhe o instante de
    /// uma sessão (ela sai do relógio), e um instante à escolha do cliente é o
    /// caminho para uma constância e uns horários fabricados.
    #[allow(clippy::too_many_arguments)]
    pub fn log_session_at(
        &self,
        subject_id: Option<String>,
        book_id: Option<String>,
        skill_id: Option<String>,
        topic: Option<String>,
        minutes: i64,
        day: Option<String>,
        at: Option<i64>,
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
        let now = at.unwrap_or_else(|| self.clock.now_ms());
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
        let (best_hours, best_hour_minutes) = top_hours(&by_hour_raw);
        let by_hour = by_hour_raw
            .into_iter()
            .map(|(hour, minutes)| HourBucket { hour, minutes })
            .collect();

        let (total_minutes, total_sessions) = self.sessions.totals(a)?;

        Ok(StudyStats {
            minutes_last_7,
            minutes_prev_7,
            active_days_30,
            best_hours,
            best_hour_minutes,
            by_hour,
            total_minutes,
            total_sessions,
            formula: "Horas na semana = soma dos minutos das sessões dos últimos 7 dias ÷ 60. \
                      Constância = dias distintos com ao menos uma sessão nos últimos 30. \
                      Melhores horários = as horas do dia (local) com mais minutos somados; \
                      se mais de uma empata no topo, todas aparecem — um empate não é uma \
                      hora só."
                .to_string(),
        })
    }
}

/// As horas do dia no TOPO, e quantos minutos elas somam.
///
/// Pura, e separada do serviço, para o empate ter teste próprio. A versão
/// anterior era um `max_by_key`, que devolve o ÚLTIMO máximo quando há empate —
/// e a tela apresentava esse desempate por ordem de varredura como se fosse a
/// resposta: *"melhor horário: 20h"* com 8h somando exatamente os mesmos
/// minutos. Sessões de estudo são registradas em blocos redondos (25/30/50/60
/// min), então empate no topo não é hipótese remota.
///
/// É a MESMA função de `focus::top_hours` — o Foco a copiou daqui já corrigida
/// (ADR-0105), e agora ela volta para a origem. Devolve `(vazio, 0)` sem dado —
/// nunca uma hora inventada.
fn top_hours(by_hour: &[(i64, i64)]) -> (Vec<i64>, i64) {
    let max = by_hour.iter().map(|(_, m)| *m).max().unwrap_or(0);
    if max <= 0 {
        return (Vec::new(), 0);
    }
    let mut hours: Vec<i64> = by_hour
        .iter()
        .filter(|(_, m)| *m == max)
        .map(|(h, _)| *h)
        .collect();
    hours.sort_unstable();
    (hours, max)
}

#[cfg(test)]
mod tests {
    use super::top_hours;

    #[test]
    fn a_clear_winner_is_a_single_hour() {
        let (hours, minutes) = top_hours(&[(19, 180), (14, 60), (21, 50)]);
        assert_eq!(hours, vec![19]);
        assert_eq!(minutes, 180);
    }

    #[test]
    fn a_tie_returns_every_hour_at_the_top() {
        // Duas horas com 60 min cada empatam — o `max_by_key` anterior elegeria
        // só a ÚLTIMA, calado, e a tela diria "melhor horário: 21h" como se 8h
        // não valesse o mesmo.
        let (hours, minutes) = top_hours(&[(8, 60), (14, 30), (21, 60)]);
        assert_eq!(hours, vec![8, 21], "as duas, não a de maior índice");
        assert_eq!(minutes, 60);
    }

    #[test]
    fn the_hours_come_ordered_by_the_clock() {
        let (hours, _) = top_hours(&[(22, 45), (6, 45), (13, 45)]);
        assert_eq!(
            hours,
            vec![6, 13, 22],
            "a leitura é do dia, não da varredura"
        );
    }

    #[test]
    fn without_data_no_hour_is_invented() {
        assert_eq!(top_hours(&[]), (Vec::new(), 0));
        // Uma hora com zero minuto não chega a ser um pico.
        assert_eq!(top_hours(&[(9, 0), (10, 0)]), (Vec::new(), 0));
    }
}
