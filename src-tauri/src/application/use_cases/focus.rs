//! Casos de uso do Modo Foco (M5): blocos de foco e suas estatísticas.
//!
//! Um **bloco de foco** (um pomodoro concluído) é um LOG (`focus_sessions`), não
//! um node — como a sessão de estudo (ADR-0027/0047): registrá-lo grava estado + o
//! evento `focus_session_logged` na mesma transação, e vale XP. Só um bloco
//! COMPLETO é registrado — o timer do frontend só chama isto ao zerar; abandonar
//! não loga nada (o guard contra o farm, e a semântica do pomodoro).
//!
//! As **estatísticas** seguem o padrão dos insights (constituição §2): números
//! determinísticos, cada um com a fórmula à mostra e o tamanho da amostra. Sem
//! dado, o campo volta vazio e a UI omite — nunca um zero inventado. E onde a
//! resposta pode EMPATAR, o campo é uma lista: eleger um vencedor pela ordem da
//! varredura seria inventar um desempate que o dado não tem (ADR-0105).

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    Clock, FocusSession, FocusSessionRepository, IdGen, NewFocusSession, NodeRepository,
};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};

/// Quantos blocos recentes o painel de foco mostra.
const RECENT_LIMIT: i64 = 8;

/// As horas do dia no TOPO, e quantos minutos elas somam.
///
/// Pura, e separada do serviço, para o empate ter teste próprio. A versão
/// anterior era um `max_by_key`, que devolve o ÚLTIMO máximo quando há empate —
/// e a tela apresentava esse desempate por ordem de varredura como se fosse a
/// resposta: *"melhor hora de foco: 17h"* com 9h tendo exatamente os mesmos
/// minutos. Os blocos são de 15/25/50 min, então empate não é hipótese remota:
/// duas horas com um bloco de 50 cada já empatam.
///
/// Devolve `(vazio, 0)` sem dado — nunca uma hora inventada. Ver ADR-0105.
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

pub struct FocusService {
    pub sessions: Arc<dyn FocusSessionRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

/// Minutos somados numa hora do dia (0–23) — a base de "melhores horas de foco".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusHourBucket {
    pub hour: i64,
    pub minutes: i64,
}

/// As estatísticas de foco, determinísticas e com fórmula (constituição §2).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusStats {
    /// Minutos dos últimos 7 dias (hoje inclusive).
    pub minutes_last_7: i64,
    /// Minutos dos 7 dias ANTERIORES — a base da tendência semanal.
    pub minutes_prev_7: i64,
    /// Dias DISTINTOS com bloco nos últimos 30 — a constância.
    pub active_days_30: i64,
    /// As horas do dia com mais minutos de foco acumulados.
    ///
    /// Uma lista, e não um `Option<i64>`, porque um EMPATE não é uma resposta:
    /// vazia = sem dado; um elemento = a melhor hora; vários = as horas que
    /// empatam no topo, e a UI diz que empatam em vez de eleger uma delas por
    /// ordem de varredura. Ver ADR-0105.
    pub best_hours: Vec<i64>,
    pub best_hour_minutes: i64,
    /// A distribuição por hora (só as horas com minutos) — para o gráfico.
    pub by_hour: Vec<FocusHourBucket>,
    /// Total de minutos focados de sempre.
    pub total_minutes: i64,
    /// Total de blocos de sempre — o tamanho da amostra.
    pub total_sessions: i64,
    pub formula: String,
}

impl FocusService {
    /// Registra um bloco de foco concluído — um FATO no ledger que vale XP. Só
    /// blocos completos chegam aqui; o `minutes` é a duração real do bloco.
    pub fn log_session(
        &self,
        task_id: Option<String>,
        label: Option<String>,
        minutes: i64,
        day: Option<String>,
    ) -> Result<FocusSession> {
        self.log_session_at(task_id, label, minutes, day, None)
    }

    /// O mesmo, com o INSTANTE explícito — a hora do dia em que o bloco aconteceu.
    ///
    /// Existe para o **seed**, e só para ele: `focus_stats` responde "quando você
    /// foca" somando `ts` por hora, e um seed que registrasse tudo pelo relógio
    /// da máquina empilharia meses de foco na hora em que o seed rodou. O
    /// gráfico de 24 barras viraria uma barra só — uma tela cuja tese inteira é
    /// a distribuição, provada com uma distribuição falsa.
    ///
    /// **Não é exposto como command, de propósito.** A UI nunca deve poder
    /// escolher o instante de um bloco: o pomodoro vale XP e só conta quando o
    /// tempo passa de verdade (ADR-0052), e um instante à escolha do cliente é
    /// exatamente o caminho do farm que o "só o bloco completo conta" fecha.
    pub fn log_session_at(
        &self,
        task_id: Option<String>,
        label: Option<String>,
        minutes: i64,
        day: Option<String>,
        at: Option<i64>,
    ) -> Result<FocusSession> {
        if minutes <= 0 {
            return Err(NexusError::Validation(
                "um bloco de foco precisa ter ao menos 1 minuto".into(),
            ));
        }
        // O dia é do usuário; o futuro é recusado, como o `day` de um tick.
        let today = self.clock.today_local();
        let day = match day {
            Some(d) => {
                let parsed = format_day(parse_day(&d)?);
                if parsed > today {
                    return Err(NexusError::Validation(
                        "não dá para registrar foco no futuro".into(),
                    ));
                }
                parsed
            }
            None => today,
        };
        let label = label
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty());

        // Um snapshot legível para a Timeline: a tarefa, ou o rótulo, ou genérico.
        let task_title = match &task_id {
            Some(tid) => self.nodes.get(tid).ok().map(|n| n.title),
            None => None,
        };
        let what = task_title
            .clone()
            .or_else(|| label.clone())
            .unwrap_or_else(|| "foco".to_string());
        let title_snapshot = format!("Focou {minutes} min · {what}");

        let id = self.ids.new_id();
        let now = at.unwrap_or_else(|| self.clock.now_ms());
        let event = NewLedgerEvent {
            ts: now,
            day: day.clone(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::FocusSession,
            event_type: EventType::FocusSessionLogged,
            payload: json!({ "minutes": minutes, "taskId": task_id }),
            title_snapshot,
        };
        self.sessions.log_with_event(
            &id,
            &NewFocusSession {
                task_id,
                label,
                minutes,
                day,
            },
            now,
            &event,
        )
    }

    pub fn recent_sessions(&self, area_id: Option<String>) -> Result<Vec<FocusSession>> {
        self.sessions.recent(area_id.as_deref(), RECENT_LIMIT)
    }

    /// Apaga um bloco registrado por engano — corrige o ESTADO (XP, estatísticas),
    /// sem tocar no ledger (a história fica). Ver `delete` no repo.
    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.sessions.delete(id)
    }

    /// As estatísticas de foco — minutos na semana, tendência, constância e as
    /// melhores horas de foco.
    pub fn focus_stats(&self, area_id: Option<String>) -> Result<FocusStats> {
        let a = area_id.as_deref();
        let today = parse_day(&self.clock.today_local())?;
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
            .map(|(hour, minutes)| FocusHourBucket { hour, minutes })
            .collect();

        let (total_minutes, total_sessions) = self.sessions.totals(a)?;

        Ok(FocusStats {
            minutes_last_7,
            minutes_prev_7,
            active_days_30,
            best_hours,
            best_hour_minutes,
            by_hour,
            total_minutes,
            total_sessions,
            formula: "Minutos na semana = soma dos minutos dos blocos dos últimos 7 dias. \
                      Constância = dias distintos com ao menos um bloco nos últimos 30. \
                      Melhor hora de foco = a hora do dia (local) com mais minutos somados; \
                      se mais de uma hora empata no topo, todas são mostradas — um empate \
                      não é uma resposta."
                .to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::top_hours;

    #[test]
    fn a_clear_winner_is_a_single_hour() {
        let (hours, minutes) = top_hours(&[(9, 120), (14, 50), (20, 25)]);
        assert_eq!(hours, vec![9]);
        assert_eq!(minutes, 120);
    }

    #[test]
    fn a_tie_returns_every_hour_at_the_top() {
        // Dois blocos de 50 min em horas diferentes empatam — e o `max_by_key`
        // anterior elegeria só o ÚLTIMO, calado.
        let (hours, minutes) = top_hours(&[(9, 50), (14, 25), (17, 50)]);
        assert_eq!(hours, vec![9, 17], "as duas, não a de maior índice");
        assert_eq!(minutes, 50);
    }

    #[test]
    fn the_hours_come_ordered_by_the_clock() {
        let (hours, _) = top_hours(&[(20, 30), (7, 30), (13, 30)]);
        assert_eq!(
            hours,
            vec![7, 13, 20],
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
