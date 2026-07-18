//! Gamificação — XP por Esfera, níveis e a galeria de conquistas.
//!
//! Tudo DERIVADO e explicável (ADR-0037): XP é a soma dos pontos do que o usuário
//! fez, não um contador sagrado. Níveis vêm de `domain::xp`; conquistas, do catálogo
//! em `domain::achievements`. O único lado que escreve é `sync_achievements`, que
//! grava no ledger o desbloqueio — idempotente (ADR-0038).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::Serialize;

use crate::application::ports::{
    Clock, GamificationRepository, HabitRepository, LedgerRepository, XpPoints,
};
use crate::domain::achievements::{self, Achievement, AchievementStats, Tier};
use crate::domain::errors::Result;
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};
use crate::domain::streak;
use crate::domain::xp::{self, Level};

pub struct GamificationService {
    pub gami: Arc<dyn GamificationRepository>,
    pub habits: Arc<dyn HabitRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub clock: Arc<dyn Clock>,
}

/// O XP e o nível de uma Esfera.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SphereXp {
    pub area_id: String,
    pub level: Level,
}

/// Uma entrada da galeria: a conquista + se caiu (e quando).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryEntry {
    pub key: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub tier: Tier,
    pub unlocked: bool,
    /// Epoch ms de quando desbloqueou; `None` se ainda é silhueta.
    pub unlocked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GamificationOverview {
    pub spheres: Vec<SphereXp>,
    /// O "nível geral" do Hub — o XP de tudo somado.
    pub overall: Level,
    pub achievements: Vec<GalleryEntry>,
}

/// Uma linha da tabela de pontos — o feito e o que ele vale.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointRow {
    pub label: &'static str,
    pub points: i64,
}

/// A referência da gamificação exibida em Configurações — transparência total
/// (constituição §2): a tabela de pontos e a curva de nível, direto do domínio.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XpReference {
    pub points: Vec<PointRow>,
    pub curve: Vec<xp::LevelStep>,
    pub formula: String,
}

/// Uma conquista recém-desbloqueada, para a celebração da UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unlocked {
    pub key: String,
    pub title: String,
    pub icon: String,
    pub tier: Tier,
}

impl GamificationService {
    fn points() -> XpPoints {
        XpPoints {
            habit_done: xp::XP_HABIT_DONE as i64,
            task_done: xp::XP_TASK_DONE as i64,
            goal_checkpoint: xp::XP_GOAL_CHECKPOINT as i64,
            milestone_done: xp::XP_MILESTONE_DONE as i64,
            skill_level_up: xp::XP_SKILL_LEVEL_UP as i64,
            study_session: xp::XP_STUDY_SESSION as i64,
            focus_session: xp::XP_FOCUS_SESSION as i64,
            book_finished: xp::XP_BOOK_FINISHED as i64,
            fin_goal_done: xp::XP_FIN_GOAL_DONE as i64,
            challenge_done: xp::XP_CHALLENGE_DONE as i64,
            annual_goal_done: xp::XP_ANNUAL_GOAL_DONE as i64,
        }
    }

    /// A tabela de pontos e a curva de nível, para a tela de Gamificação. Os
    /// valores vêm dos MESMOS `const` de `domain::xp` que o `xp_by_area` usa —
    /// uma fonte só, sem divergência entre o que a UI mostra e o que ela soma.
    pub fn reference() -> XpReference {
        let p = Self::points();
        XpReference {
            points: vec![
                PointRow {
                    label: "Hábito cumprido no dia",
                    points: p.habit_done,
                },
                PointRow {
                    label: "Sessão de estudo registrada",
                    points: p.study_session,
                },
                PointRow {
                    label: "Bloco de foco concluído",
                    points: p.focus_session,
                },
                PointRow {
                    label: "Tarefa planejada concluída",
                    points: p.task_done,
                },
                PointRow {
                    label: "Checkpoint de meta",
                    points: p.goal_checkpoint,
                },
                PointRow {
                    label: "Sub-desafio de meta concluído",
                    points: p.milestone_done,
                },
                PointRow {
                    label: "Subir de nível numa competência",
                    points: p.skill_level_up,
                },
                PointRow {
                    label: "Livro terminado",
                    points: p.book_finished,
                },
                PointRow {
                    label: "Objetivo financeiro fechado",
                    points: p.fin_goal_done,
                },
                PointRow {
                    label: "Temporada vencida",
                    points: p.challenge_done,
                },
                PointRow {
                    label: "Meta anual concluída",
                    points: p.annual_goal_done,
                },
            ],
            curve: xp::level_curve(12),
            formula: "XP por Esfera = soma dos pontos de tudo que você fez, agrupado pela \
                      Esfera do item. Nível n custa 100·n^1.5 XP para ser alcançado; o piso \
                      de cada nível é a soma acumulada dos custos até ele. Nada é gravado — \
                      apagar um feito ajusta o XP na recomputação seguinte."
                .to_string(),
        }
    }

    /// A visão da gamificação: XP/nível por Esfera, nível geral e a galeria.
    /// Só leitura — pode ser chamada à vontade.
    pub fn overview(&self) -> Result<GamificationOverview> {
        let by_area = self.gami.xp_by_area(Self::points())?;

        let mut overall_xp: i64 = 0;
        let mut spheres: Vec<SphereXp> = Vec::new();
        for (area, xp_amount) in by_area {
            overall_xp += xp_amount.max(0);
            if let Some(area_id) = area {
                spheres.push(SphereXp {
                    area_id,
                    level: xp::level_from_xp(xp_amount.max(0) as u64),
                });
            }
        }

        // Do mais alto para o mais baixo — o Hub mostra as Esferas mais fortes em cima.
        spheres.sort_by_key(|s| std::cmp::Reverse(s.level.xp));

        let overall = xp::level_from_xp(overall_xp.max(0) as u64);
        let achievements = self.gallery()?;

        Ok(GamificationOverview {
            spheres,
            overall,
            achievements,
        })
    }

    /// A galeria: o catálogo inteiro, marcando o que já caiu (e quando, do ledger).
    fn gallery(&self) -> Result<Vec<GalleryEntry>> {
        let unlocked = self.unlocked_at()?;
        Ok(achievements::catalog()
            .into_iter()
            .map(|a: Achievement| {
                let at = unlocked.get(a.key).copied();
                GalleryEntry {
                    key: a.key.to_string(),
                    title: a.title.to_string(),
                    description: a.description.to_string(),
                    icon: a.icon.to_string(),
                    tier: a.tier,
                    unlocked: at.is_some(),
                    unlocked_at: at,
                }
            })
            .collect())
    }

    /// Desbloqueia as conquistas que os contadores atuais já satisfazem e ainda
    /// não estão no ledger. Idempotente: roda duas vezes, grava uma. Devolve as
    /// recém-desbloqueadas para a UI celebrar. A UI chama na abertura do app.
    pub fn sync_achievements(&self) -> Result<Vec<Unlocked>> {
        let stats = self.stats()?;
        let satisfied: Vec<&'static str> = achievements::evaluate(&stats);
        let already: HashSet<String> = self.unlocked_at()?.into_keys().collect();

        let now = self.clock.now_ms();
        let day = self.clock.today_local();
        let catalog = achievements::catalog();

        let mut newly: Vec<Unlocked> = Vec::new();
        for key in satisfied {
            if already.contains(key) {
                continue;
            }
            let Some(a) = catalog.iter().find(|a| a.key == key) else {
                continue;
            };
            self.ledger.append(&NewLedgerEvent {
                ts: now,
                day: day.clone(),
                entity_id: key.to_string(),
                entity_kind: LedgerEntityKind::Achievement,
                event_type: EventType::AchievementUnlocked,
                payload: serde_json::json!({
                    "tier": tier_str(a.tier),
                    "icon": a.icon,
                }),
                title_snapshot: a.title.to_string(),
            })?;
            newly.push(Unlocked {
                key: a.key.to_string(),
                title: a.title.to_string(),
                icon: a.icon.to_string(),
                tier: a.tier,
            });
        }
        Ok(newly)
    }

    /// key → epoch ms do desbloqueio, lido do ledger (`entity_kind='achievement'`).
    fn unlocked_at(&self) -> Result<HashMap<String, i64>> {
        let entries = self.ledger.by_entity_kind("achievement", 1000)?;
        let mut map: HashMap<String, i64> = HashMap::new();
        for e in entries {
            // Se por algum motivo houver duas linhas, fica a mais antiga (o
            // primeiro desbloqueio é o que a Timeline conta).
            map.entry(e.entity_id)
                .and_modify(|ts| *ts = (*ts).min(e.ts))
                .or_insert(e.ts);
        }
        Ok(map)
    }

    /// Os contadores do crivo de conquistas: os `COUNT` diretos do repo mais os
    /// dois streaks que precisam de cálculo (hábito e aporte).
    fn stats(&self) -> Result<AchievementStats> {
        let counts = self.gami.achievement_counts()?;
        Ok(AchievementStats {
            max_habit_streak: self.max_habit_streak()?,
            goals_completed: counts.goals_completed.max(0) as u32,
            fin_goals_completed: counts.fin_goals_completed.max(0) as u32,
            books_finished: counts.books_finished.max(0) as u32,
            weekly_reviews: counts.weekly_reviews.max(0) as u32,
            contribution_month_streak: self.contribution_month_streak()?,
            challenges_completed: counts.challenges_completed.max(0) as u32,
            annual_goals_completed: counts.annual_goals_completed.max(0) as u32,
        })
    }

    /// O maior recorde de streak entre os hábitos ativos — reusa `domain::streak`,
    /// a mesma conta do painel de cada hábito.
    fn max_habit_streak(&self) -> Result<u32> {
        let today = parse_day(&self.clock.today_local())?;
        let from = format_day(today - chrono::Duration::days(730));
        let to = format_day(today);

        let mut best = 0u32;
        for habit in self.habits.list(None, false)? {
            let ticks: streak::Ticks = self
                .habits
                .ticks_in_range(&habit.id, &from, &to)?
                .into_iter()
                .filter_map(|(day, tick)| parse_day(&day).ok().map(|d| (d, tick.status)))
                .collect();
            let s = streak::compute(&habit.schedule, &ticks, today);
            best = best.max(s.record);
        }
        Ok(best)
    }

    /// O maior número de meses de aporte CONSECUTIVOS já vistos.
    fn contribution_month_streak(&self) -> Result<u32> {
        let months = self.gami.contribution_months()?;
        Ok(max_consecutive_months(&months))
    }
}

fn tier_str(t: Tier) -> &'static str {
    match t {
        Tier::Bronze => "bronze",
        Tier::Silver => "silver",
        Tier::Gold => "gold",
        Tier::Platinum => "platinum",
    }
}

/// O maior corrimento de meses consecutivos numa lista de 'YYYY-MM'.
///
/// Converte cada mês para um índice `ano*12 + mês` e conta o maior trecho em que
/// cada passo é +1. Puro — testado abaixo.
fn max_consecutive_months(months: &[String]) -> u32 {
    let mut idx: Vec<i32> = months.iter().filter_map(|m| month_index(m)).collect();
    idx.sort_unstable();
    idx.dedup();
    if idx.is_empty() {
        return 0;
    }
    let mut best = 1u32;
    let mut run = 1u32;
    for w in idx.windows(2) {
        if w[1] == w[0] + 1 {
            run += 1;
            best = best.max(run);
        } else {
            run = 1;
        }
    }
    best
}

fn month_index(m: &str) -> Option<i32> {
    let (y, mo) = m.split_once('-')?;
    let y: i32 = y.parse().ok()?;
    let mo: i32 = mo.parse().ok()?;
    if (1..=12).contains(&mo) {
        Some(y * 12 + (mo - 1))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consecutive_months_counts_the_longest_run() {
        // jan, fev, mar (run 3), pula abr, mai (run 2). Melhor = 3.
        let months = vec![
            "2026-01".to_string(),
            "2026-02".to_string(),
            "2026-03".to_string(),
            "2026-05".to_string(),
        ];
        assert_eq!(max_consecutive_months(&months), 3);
    }

    #[test]
    fn consecutive_months_spans_the_year_boundary() {
        // nov/2026, dez/2026, jan/2027 são consecutivos.
        let months = vec![
            "2026-11".to_string(),
            "2026-12".to_string(),
            "2027-01".to_string(),
        ];
        assert_eq!(max_consecutive_months(&months), 3);
    }

    #[test]
    fn no_months_is_a_zero_streak() {
        assert_eq!(max_consecutive_months(&[]), 0);
    }

    #[test]
    fn duplicates_do_not_inflate_the_run() {
        let months = vec!["2026-01".to_string(), "2026-01".to_string()];
        assert_eq!(max_consecutive_months(&months), 1);
    }
}
