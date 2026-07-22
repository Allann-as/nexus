//! Retrospectiva anual (ARSENAL) — o ano inteiro num quadro, e um arquivo gerado.
//!
//! Para um ano fechado (ou o corrente, sob demanda): os totais, o score, as
//! semanas perfeitas, e os destaques (conquistas + recordes) — tudo DERIVADO do
//! estado e do ledger, nada novo gravado. A retrospectiva também EXPORTA um
//! arquivo Markdown legível para sempre, com retenção de 2 anos (podado como um
//! backup); o dado-fonte é eterno, o arquivo é uma conveniência regenerável. Ver
//! ADR-0064.

use std::io::Write;
use std::sync::Arc;

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

use crate::application::ports::{
    Clock, Highlight, InsightRepository, LedgerRepository, PeriodStatsRepository,
    RetrospectiveRepository,
};
use crate::application::use_cases::perfect_weeks;
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::LedgerEntityKind;
use crate::domain::schedule::{format_day, parse_day};
use crate::infrastructure::paths::Paths;

pub struct RetrospectiveService {
    pub period: Arc<dyn PeriodStatsRepository>,
    pub retro: Arc<dyn RetrospectiveRepository>,
    pub insights: Arc<dyn InsightRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub clock: Arc<dyn Clock>,
    pub paths: Paths,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Retrospective {
    pub year: i64,
    /// O ÚLTIMO dia coberto. Num ano fechado é 31/12; no ano corrente é hoje —
    /// e sem isso tanto a tela quanto o arquivo exportado chamam de "o ano" um
    /// total que para em julho.
    pub through: String,
    pub study_minutes: i64,
    pub focus_minutes: i64,
    pub contribution_cents: i64,
    pub tasks_completed: i64,
    pub habits_done: i64,
    pub score_avg: Option<f64>,
    pub score_best: Option<u8>,
    pub perfect_weeks: u32,
    pub achievements: i64,
    pub records: i64,
    pub books_finished: i64,
    pub challenges_won: i64,
    pub annual_goals_done: i64,
    pub highlights: Vec<Highlight>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetroFile {
    pub name: String,
    pub path: String,
}

impl RetrospectiveService {
    pub fn retrospective(&self, year: i64) -> Result<Retrospective> {
        let today = parse_day(&self.clock.today_local())?;
        let jan1 = NaiveDate::from_ymd_opt(year as i32, 1, 1)
            .ok_or_else(|| NexusError::Validation(format!("ano {year}")))?;
        let dec31 = NaiveDate::from_ymd_opt(year as i32, 12, 31).unwrap();
        // Ano corrente: até hoje; ano fechado: o ano todo.
        let to = dec31.min(today);
        let from_s = format_day(jan1);
        let to_s = format_day(to);

        let raw = self.period.range_stats(&from_s, &to_s)?;
        let (score_avg, score_best) = self.score(&from_s, &to_s)?;
        let perfect_weeks = perfect_weeks::year_total_from_series(
            self.insights.active_habit_series()?,
            year,
            today,
        );
        let counts = self.retro.year_counts(&from_s, &to_s)?;
        let highlights = self.retro.year_highlights(&from_s, &to_s, 24)?;

        Ok(Retrospective {
            year,
            through: to_s.clone(),
            study_minutes: raw.study_minutes,
            focus_minutes: raw.focus_minutes,
            contribution_cents: raw.contribution_cents,
            tasks_completed: raw.tasks_completed,
            habits_done: raw.habits_done,
            score_avg,
            score_best,
            perfect_weeks,
            achievements: counts.achievements,
            records: counts.records,
            books_finished: counts.books_finished,
            challenges_won: counts.challenges_won,
            annual_goals_done: counts.annual_goals_done,
            highlights,
        })
    }

    /// A média e o melhor score congelado no intervalo.
    fn score(&self, from: &str, to: &str) -> Result<(Option<f64>, Option<u8>)> {
        let mut sum = 0.0;
        let mut n = 0u32;
        let mut best: Option<u8> = None;
        for e in self
            .ledger
            .by_entity_kind(LedgerEntityKind::DailyScore.as_str(), 100_000)?
        {
            if e.day.as_str() < from || e.day.as_str() > to {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&e.payload) {
                if let Some(value) = v.get("value").and_then(|x| x.as_u64()) {
                    sum += value as f64;
                    n += 1;
                    best = Some(best.map_or(value as u8, |b| b.max(value as u8)));
                }
            }
        }
        Ok(((n > 0).then(|| sum / n as f64), best))
    }

    /// Gera o arquivo Markdown da retrospectiva e poda os antigos (retenção 2 anos).
    pub fn export(&self, year: i64) -> Result<RetroFile> {
        let retro = self.retrospective(year)?;
        let md = render_markdown(&retro);
        let name = format!("retrospectiva-{year}.md");
        let path = self.paths.retrospectives.join(&name);
        let mut file = std::fs::File::create(&path)
            .map_err(|e| NexusError::Path(format!("não foi possível criar {name}: {e}")))?;
        file.write_all(md.as_bytes())
            .map_err(|e| NexusError::Path(format!("não foi possível escrever {name}: {e}")))?;

        self.prune()?;
        Ok(RetroFile {
            name,
            path: path.to_string_lossy().to_string(),
        })
    }

    /// Poda as retrospectivas com mais de 2 anos (mantém o corrente e os 2
    /// anteriores). O dado-fonte é eterno; o arquivo é regenerável.
    fn prune(&self) -> Result<()> {
        let this_year = parse_day(&self.clock.today_local())?.year() as i64;
        let floor = this_year - 2;
        let dir = match std::fs::read_dir(&self.paths.retrospectives) {
            Ok(d) => d,
            Err(_) => return Ok(()),
        };
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(y) = year_of(&name) {
                if y < floor {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        Ok(())
    }
}

/// `'AAAA-MM-DD'` → `'DD/MM/AAAA'`, para o texto do arquivo.
fn br_day(day: &str) -> String {
    let p: Vec<&str> = day.split('-').collect();
    if p.len() == 3 {
        format!("{}/{}/{}", p[2], p[1], p[0])
    } else {
        day.to_string()
    }
}

/// Extrai o ano de "retrospectiva-YYYY.md".
fn year_of(name: &str) -> Option<i64> {
    name.strip_prefix("retrospectiva-")?
        .strip_suffix(".md")?
        .parse()
        .ok()
}

fn render_markdown(r: &Retrospective) -> String {
    let hours = |min: i64| format!("{}h", min / 60);
    let money = |cents: i64| format!("R$ {:.2}", cents as f64 / 100.0);
    let mut s = String::new();
    s.push_str(&format!("# NEXUS — Retrospectiva {}\n\n", r.year));
    // O arquivo é permanente: se ele foi gerado em julho, tem que dizer isso na
    // primeira linha. "Retrospectiva 2026" com os números até julho, lida daqui a
    // três anos, é um retrato do ano que não é o ano.
    let closed = r.through == format!("{}-12-31", r.year);
    if !closed {
        s.push_str(&format!(
            "> Ano em andamento: os números vão de 1º de janeiro até {}.\n\n",
            br_day(&r.through)
        ));
    }
    s.push_str(if closed {
        "## Números do ano\n\n"
    } else {
        "## Números do ano até aqui\n\n"
    });
    s.push_str(&format!("- Estudo: {}\n", hours(r.study_minutes)));
    s.push_str(&format!("- Foco: {}\n", hours(r.focus_minutes)));
    s.push_str(&format!("- Aportes: {}\n", money(r.contribution_cents)));
    s.push_str(&format!("- Tarefas concluídas: {}\n", r.tasks_completed));
    s.push_str(&format!("- Hábitos cumpridos: {}\n", r.habits_done));
    if let Some(avg) = r.score_avg {
        s.push_str(&format!(
            "- Nexus Score médio: {} (melhor: {})\n",
            avg.round() as i64,
            r.score_best
                .map(|b| b.to_string())
                .unwrap_or_else(|| "—".into())
        ));
    }
    s.push_str(&format!("- Semanas perfeitas: {}\n", r.perfect_weeks));
    s.push_str("\n## Conquistas do ano\n\n");
    s.push_str(&format!("- Conquistas desbloqueadas: {}\n", r.achievements));
    s.push_str(&format!("- Recordes batidos: {}\n", r.records));
    s.push_str(&format!("- Livros terminados: {}\n", r.books_finished));
    s.push_str(&format!("- Temporadas vencidas: {}\n", r.challenges_won));
    s.push_str(&format!(
        "- Metas anuais concluídas: {}\n",
        r.annual_goals_done
    ));
    if !r.highlights.is_empty() {
        s.push_str("\n## Destaques\n\n");
        for h in &r.highlights {
            s.push_str(&format!("- {} — {}\n", h.day, h.title));
        }
    }
    s.push_str(
        "\n---\n_Gerado pelo NEXUS. O dado-fonte é eterno; este arquivo é uma conveniência._\n",
    );
    s
}
