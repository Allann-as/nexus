//! Recordes pessoais (ARSENAL) — os PRs auto-detectados do estado, e o momento em
//! que a régua sobe, congelado no ledger.
//!
//! Cada recorde é o MÁXIMO histórico de uma métrica (maior sequência, melhor
//! semana de estudo, melhor mês de aportes, melhor score semanal, mais dias de
//! foco num mês). O VALOR é derivado do estado; o FATO de ter batido — esse é
//! congelado (`record_broken` no ledger), com o valor anterior no payload, para a
//! Timeline mostrar "você superou o seu recorde". Ver ADR-0060.
//!
//! `sync_and_list` é um passo de leitura-e-escrita (como `sync_achievements` e o
//! `freeze` do score): computa os máximos, compara com o último recorde gravado, e
//! apenda só o que subiu. Idempotente: rodar de novo sem novidade não grava nada.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{Clock, HabitRepository, LedgerRepository, RecordsRepository};
use crate::domain::errors::Result;
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day, week_start};
use crate::domain::streak;

pub struct RecordsService {
    pub records: Arc<dyn RecordsRepository>,
    pub habits: Arc<dyn HabitRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub clock: Arc<dyn Clock>,
}

/// Como o número é mostrado — o backend dá a régua, o front formata (dinheiro e
/// horas não são texto cru).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordFormat {
    Int,
    Days,
    Hours,
    Money,
}

/// Um recorde pronto para a tela.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalRecord {
    pub key: String,
    pub label: String,
    pub value: f64,
    pub format: RecordFormat,
    /// O período/contexto que alcançou o recorde ("semana de 06/07", "mar/2026",
    /// ou o hábito que segura a sequência).
    pub context: Option<String>,
    /// O recorde anterior, quando este o superou.
    pub previous: Option<f64>,
    /// Batido AGORA (nesta sincronização) — a UI comemora.
    pub is_new: bool,
    /// O dia em que o recorde vigente foi reconhecido/batido ('YYYY-MM-DD').
    pub set_on: Option<String>,
}

/// Um candidato a recorde, antes de comparar com o ledger.
struct Candidate {
    key: &'static str,
    label: &'static str,
    format: RecordFormat,
    value: f64,
    /// O dia do período recordista — vira o `day` do evento (a Timeline o desenha
    /// no tempo certo, não em "hoje").
    day: String,
    context: Option<String>,
}

/// O que o ledger já sabe de um recorde: o valor e o dia em que foi gravado.
struct Stored {
    value: f64,
    day: String,
}

impl RecordsService {
    pub fn sync_and_list(&self) -> Result<Vec<PersonalRecord>> {
        let today = self.clock.today_local();
        let candidates = self.candidates(&today)?;
        let stored = self.stored_records()?;

        let mut out = Vec::new();
        for c in candidates {
            let prior = stored.get(c.key);
            let prior_value = prior.map(|s| s.value);
            // Sobe o recorde quando supera o gravado (ou é o primeiro > 0).
            let beats = c.value > 0.0 && c.value > prior_value.unwrap_or(0.0);

            let (is_new, set_on) = if beats {
                self.append_record(&c, prior_value)?;
                // Comemora só quando havia um recorde ANTES para superar — o
                // primeiro de cada tipo é um marco silencioso, não uma quebra.
                (prior.is_some(), Some(c.day.clone()))
            } else {
                (false, prior.map(|s| s.day.clone()))
            };

            out.push(PersonalRecord {
                key: c.key.to_string(),
                label: c.label.to_string(),
                value: c.value,
                format: c.format,
                context: c.context,
                previous: if beats { prior_value } else { None },
                is_new,
                set_on,
            });
        }
        Ok(out)
    }

    fn append_record(&self, c: &Candidate, previous: Option<f64>) -> Result<()> {
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: c.day.clone(),
            entity_id: c.key.to_string(),
            entity_kind: LedgerEntityKind::PersonalRecord,
            event_type: EventType::RecordBroken,
            payload: json!({ "value": c.value, "previous": previous, "context": c.context }),
            title_snapshot: c.label.to_string(),
        };
        self.ledger.append(&event)?;
        Ok(())
    }

    /// O último recorde gravado por chave (o ledger é append-only; a última linha
    /// de cada chave é o vigente).
    fn stored_records(&self) -> Result<HashMap<String, Stored>> {
        let mut map: HashMap<String, Stored> = HashMap::new();
        // `by_entity_kind` já vem do mais novo ao mais antigo; a primeira vez que
        // vemos uma chave é a vigente.
        for e in self
            .ledger
            .by_entity_kind(LedgerEntityKind::PersonalRecord.as_str(), 2000)?
        {
            if map.contains_key(&e.entity_id) {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&e.payload) {
                if let Some(value) = v.get("value").and_then(|x| x.as_f64()) {
                    map.insert(e.entity_id.clone(), Stored { value, day: e.day });
                }
            }
        }
        Ok(map)
    }

    fn candidates(&self, today: &str) -> Result<Vec<Candidate>> {
        let mut out = Vec::new();

        // 1) Maior sequência de hábito — reusa `domain::streak`.
        if let Some((value, title)) = self.best_streak(today)? {
            out.push(Candidate {
                key: "habit_streak",
                label: "Maior sequência",
                format: RecordFormat::Days,
                value: value as f64,
                day: today.to_string(),
                context: Some(title),
            });
        }

        // 2) Melhor semana de estudo (minutos).
        if let Some(hit) = self.records.best_study_week_minutes()? {
            out.push(Candidate {
                key: "study_week",
                label: "Melhor semana de estudo",
                format: RecordFormat::Hours,
                value: hit.value,
                day: hit.sample_day.clone(),
                context: Some(week_label(&hit.sample_day)),
            });
        }

        // 3) Melhor mês de aportes (centavos).
        if let Some(hit) = self.records.best_contribution_month_cents()? {
            out.push(Candidate {
                key: "contribution_month",
                label: "Melhor mês de aportes",
                format: RecordFormat::Money,
                value: hit.value,
                day: hit.sample_day.clone(),
                context: Some(month_label(&hit.sample_day)),
            });
        }

        // 4) Melhor score semanal (média dos scores congelados na semana).
        if let Some((value, sample)) = self.best_score_week()? {
            out.push(Candidate {
                key: "score_week",
                label: "Melhor score semanal",
                format: RecordFormat::Int,
                value,
                day: sample.clone(),
                context: Some(week_label(&sample)),
            });
        }

        // 5) Mais dias de foco num mês.
        if let Some(hit) = self.records.best_focus_days_month()? {
            out.push(Candidate {
                key: "focus_days_month",
                label: "Mais dias de foco num mês",
                format: RecordFormat::Days,
                value: hit.value,
                day: hit.sample_day.clone(),
                context: Some(month_label(&hit.sample_day)),
            });
        }

        Ok(out)
    }

    /// A maior sequência (recorde) entre os hábitos ativos, e o título do hábito
    /// que a segura — a mesma conta do painel e das conquistas.
    fn best_streak(&self, today: &str) -> Result<Option<(u32, String)>> {
        let today_d = parse_day(today)?;
        let from = format_day(today_d - chrono::Duration::days(730));

        let mut best: Option<(u32, String)> = None;
        for habit in self.habits.list(None, false)? {
            let ticks: streak::Ticks = self
                .habits
                .ticks_in_range(&habit.id, &from, today)?
                .into_iter()
                .filter_map(|(day, tick)| parse_day(&day).ok().map(|d| (d, tick.status)))
                .collect();
            let s = streak::compute(&habit.schedule, &ticks, today_d);
            if best.as_ref().map(|(v, _)| s.record > *v).unwrap_or(true) && s.record > 0 {
                best = Some((s.record, habit.title.clone()));
            }
        }
        Ok(best)
    }

    /// A melhor semana de score: lê os scores diários congelados do ledger e tira
    /// a maior média semanal. Devolve (média arredondada, um dia da semana).
    fn best_score_week(&self) -> Result<Option<(f64, String)>> {
        // Soma e contagem por semana (segunda a domingo).
        let mut sum: HashMap<String, (f64, u32)> = HashMap::new();
        let mut sample: HashMap<String, String> = HashMap::new();
        for e in self
            .ledger
            .by_entity_kind(LedgerEntityKind::DailyScore.as_str(), 4000)?
        {
            let Ok(day) = parse_day(&e.day) else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&e.payload) else {
                continue;
            };
            let Some(value) = v.get("value").and_then(|x| x.as_f64()) else {
                continue;
            };
            let wk = format_day(week_start(day));
            let entry = sum.entry(wk.clone()).or_insert((0.0, 0));
            entry.0 += value;
            entry.1 += 1;
            // Um dia representativo da semana (o mais antigo visto).
            sample
                .entry(wk)
                .and_modify(|d| {
                    if e.day < *d {
                        *d = e.day.clone();
                    }
                })
                .or_insert(e.day.clone());
        }

        let best = sum
            .into_iter()
            .map(|(wk, (total, n))| (wk, total / n as f64))
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        Ok(best.map(|(wk, avg)| {
            let day = sample.get(&wk).cloned().unwrap_or(wk);
            (avg.round(), day)
        }))
    }
}

/// "semana de 06/07" a partir de um dia qualquer da semana.
fn week_label(sample_day: &str) -> String {
    match parse_day(sample_day) {
        Ok(d) => {
            let ws = week_start(d);
            format!("semana de {}", ws.format("%d/%m"))
        }
        Err(_) => sample_day.to_string(),
    }
}

/// "mar/2026" a partir de 'YYYY-MM-DD'.
fn month_label(sample_day: &str) -> String {
    const MESES: [&str; 12] = [
        "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
    ];
    match parse_day(sample_day) {
        Ok(d) => {
            use chrono::Datelike;
            format!("{}/{}", MESES[(d.month0()) as usize], d.year())
        }
        Err(_) => sample_day.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::Db;
    use crate::infrastructure::paths::Paths;
    use crate::infrastructure::repositories::{
        habit_repo::SqliteHabitRepository, ledger_repo::SqliteLedgerRepository,
        records_repo::SqliteRecordsRepository,
    };
    use rusqlite::params;

    struct FixedClock;
    impl Clock for FixedClock {
        fn now_ms(&self) -> i64 {
            1_000
        }
        fn today_local(&self) -> String {
            "2026-07-20".into()
        }
    }

    fn service() -> (tempfile::TempDir, Arc<Db>, RecordsService) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        let svc = RecordsService {
            records: Arc::new(SqliteRecordsRepository::new(db.clone())),
            habits: Arc::new(SqliteHabitRepository::new(db.clone())),
            ledger: Arc::new(SqliteLedgerRepository::new(db.clone())),
            clock: Arc::new(FixedClock),
        };
        (dir, db, svc)
    }

    fn add_study(db: &Db, day: &str, minutes: i64) {
        db.with_write(|c| {
            c.execute(
                "INSERT INTO study_sessions (id, minutes, day, ts)
                 VALUES (?1, ?2, ?3, 1)",
                params![format!("s-{day}-{minutes}"), minutes, day],
            )?;
            Ok(())
        })
        .unwrap();
    }

    fn study_record(recs: &[PersonalRecord]) -> PersonalRecord {
        recs.iter()
            .find(|r| r.key == "study_week")
            .cloned()
            .expect("recorde de estudo presente")
    }

    #[test]
    fn the_first_record_is_a_quiet_baseline_and_a_real_beat_celebrates() {
        let (_d, db, svc) = service();
        // Semana de 13/07: duas sessões, 120 min.
        add_study(&db, "2026-07-14", 60);
        add_study(&db, "2026-07-16", 60);

        // 1ª sincronização: o primeiro recorde é um marco silencioso (is_new=false).
        let first = study_record(&svc.sync_and_list().unwrap());
        assert_eq!(first.value, 120.0);
        assert!(!first.is_new, "o primeiro de cada tipo não comemora");
        assert_eq!(first.previous, None);
        assert_eq!(first.set_on.as_deref(), Some("2026-07-14"));

        // Sem novidade: não grava nada, não comemora.
        let again = study_record(&svc.sync_and_list().unwrap());
        assert!(!again.is_new);
        assert_eq!(again.previous, None);

        // Sobe a régua na mesma semana: 120 -> 180. Agora SIM é um recorde batido.
        add_study(&db, "2026-07-17", 60);
        let beaten = study_record(&svc.sync_and_list().unwrap());
        assert_eq!(beaten.value, 180.0);
        assert!(beaten.is_new, "superar um recorde existente comemora");
        assert_eq!(beaten.previous, Some(120.0));
    }

    #[test]
    fn no_data_yields_no_records() {
        let (_d, _db, svc) = service();
        assert!(svc.sync_and_list().unwrap().is_empty());
    }
}
