//! O catálogo de conquistas — e o crivo que decide quais estão desbloqueadas.
//!
//! O catálogo vive no CÓDIGO, não numa tabela: uma conquista é uma regra ("30
//! dias de streak"), e regras são código. O DESBLOQUEIO, esse sim, é um fato da
//! vida do usuário e vira uma linha no ledger (`achievement_unlocked`), pela qual
//! a galeria sabe o que já caiu e a Timeline o mostra. Ver ADR-0038.
//!
//! Cada conquista traz um ícone **Lucide** (string), nunca um emoji — a galeria é
//! tipográfica e séria (M4.6 §3.2). A `key` é estável e gravada no ledger para
//! sempre: renomear o título é livre; mudar a `key` reescreveria o passado.
//!
//! Puro e determinístico: `evaluate` é uma função dos contadores do usuário. Zero
//! IA.

use serde::Serialize;

/// A métrica que uma conquista observa. O crivo é sempre "essa métrica alcançou
/// o limiar?" — simples de propósito: uma conquista é uma linha que o usuário
/// cruza, não um cálculo que ele precise auditar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Metric {
    /// Maior streak de hábito já atingido (dias).
    HabitStreak,
    /// Metas (comuns) concluídas.
    GoalsCompleted,
    /// Caixinhas (objetivos financeiros) fechadas.
    FinGoalsCompleted,
    /// Livros terminados.
    BooksFinished,
    /// Revisões semanais completadas.
    WeeklyReviews,
    /// Meses seguidos com aporte.
    ContributionMonthStreak,
    /// Temporadas/desafios vencidos.
    ChallengesCompleted,
    /// Metas anuais concluídas.
    AnnualGoalsCompleted,
}

/// Os contadores do usuário — a entrada do crivo. Tudo vem de query; nada é
/// estimado. O serviço os preenche a partir do estado e do ledger.
#[derive(Debug, Clone, Copy, Default)]
pub struct AchievementStats {
    pub max_habit_streak: u32,
    pub goals_completed: u32,
    pub fin_goals_completed: u32,
    pub books_finished: u32,
    pub weekly_reviews: u32,
    pub contribution_month_streak: u32,
    pub challenges_completed: u32,
    pub annual_goals_completed: u32,
}

impl AchievementStats {
    fn value(&self, m: Metric) -> u32 {
        match m {
            Metric::HabitStreak => self.max_habit_streak,
            Metric::GoalsCompleted => self.goals_completed,
            Metric::FinGoalsCompleted => self.fin_goals_completed,
            Metric::BooksFinished => self.books_finished,
            Metric::WeeklyReviews => self.weekly_reviews,
            Metric::ContributionMonthStreak => self.contribution_month_streak,
            Metric::ChallengesCompleted => self.challenges_completed,
            Metric::AnnualGoalsCompleted => self.annual_goals_completed,
        }
    }
}

/// O "grau" da conquista — puramente visual (a galeria pinta o quadro por ele),
/// nunca uma pontuação. Ouro não vale mais que bronze; é mais raro.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Tier {
    Bronze,
    Silver,
    Gold,
    Platinum,
}

/// Uma conquista do catálogo. Serializa sem a `metric` e o `threshold` — a UI só
/// precisa do que mostrar; o crivo é do backend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub key: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// Nome do ícone Lucide (ex.: "flame"). Nunca um emoji.
    pub icon: &'static str,
    pub tier: Tier,
    #[serde(skip)]
    pub metric: Metric,
    #[serde(skip)]
    pub threshold: u32,
}

impl Achievement {
    pub fn is_unlocked_by(&self, stats: &AchievementStats) -> bool {
        stats.value(self.metric) >= self.threshold
    }
}

macro_rules! ach {
    ($key:literal, $title:literal, $desc:literal, $icon:literal, $tier:expr, $metric:expr, $threshold:expr) => {
        Achievement {
            key: $key,
            title: $title,
            description: $desc,
            icon: $icon,
            tier: $tier,
            metric: $metric,
            threshold: $threshold,
        }
    };
}

/// O catálogo inteiro. A ORDEM é a da galeria (grau crescente por família).
pub fn catalog() -> Vec<Achievement> {
    use Metric::*;
    use Tier::*;
    vec![
        // --- Streaks de hábito ---
        ach!(
            "streak_7",
            "Uma semana",
            "7 dias seguidos de um hábito.",
            "flame",
            Bronze,
            HabitStreak,
            7
        ),
        ach!(
            "streak_30",
            "Um mês inteiro",
            "30 dias seguidos de um hábito.",
            "flame",
            Silver,
            HabitStreak,
            30
        ),
        ach!(
            "streak_100",
            "Cem dias",
            "100 dias seguidos de um hábito.",
            "flame",
            Gold,
            HabitStreak,
            100
        ),
        ach!(
            "streak_365",
            "Um ano sem falhar",
            "365 dias seguidos de um hábito.",
            "flame",
            Platinum,
            HabitStreak,
            365
        ),
        // --- Metas ---
        ach!(
            "goal_first",
            "Primeira meta",
            "Você bateu a sua primeira meta.",
            "target",
            Bronze,
            GoalsCompleted,
            1
        ),
        ach!(
            "goal_10",
            "Realizadora",
            "Dez metas concluídas.",
            "target",
            Gold,
            GoalsCompleted,
            10
        ),
        // --- Objetivos financeiros ---
        ach!(
            "fin_goal_first",
            "Caixinha cheia",
            "Você completou a sua primeira caixinha.",
            "piggy-bank",
            Bronze,
            FinGoalsCompleted,
            1
        ),
        ach!(
            "fin_goal_5",
            "Disciplina financeira",
            "Cinco caixinhas completadas.",
            "piggy-bank",
            Gold,
            FinGoalsCompleted,
            5
        ),
        // --- Aportes seguidos ---
        ach!(
            "contrib_6m",
            "Meio ano investindo",
            "Seis meses seguidos com aporte.",
            "trending-up",
            Silver,
            ContributionMonthStreak,
            6
        ),
        ach!(
            "contrib_12m",
            "Um ano investindo",
            "Doze meses seguidos com aporte.",
            "trending-up",
            Gold,
            ContributionMonthStreak,
            12
        ),
        // --- Leitura ---
        ach!(
            "book_first",
            "Primeira leitura",
            "Você terminou o seu primeiro livro.",
            "book-open",
            Bronze,
            BooksFinished,
            1
        ),
        ach!(
            "book_12",
            "Um livro por mês",
            "Doze livros terminados.",
            "book-open",
            Gold,
            BooksFinished,
            12
        ),
        // --- Revisões semanais ---
        ach!(
            "review_4",
            "Mês revisado",
            "Quatro revisões semanais completadas.",
            "calendar-check",
            Silver,
            WeeklyReviews,
            4
        ),
        ach!(
            "review_52",
            "Um ano revisado",
            "Cinquenta e duas revisões semanais.",
            "calendar-check",
            Platinum,
            WeeklyReviews,
            52
        ),
        // --- Temporadas ---
        ach!(
            "challenge_first",
            "Primeira temporada",
            "Você venceu a sua primeira temporada.",
            "trophy",
            Silver,
            ChallengesCompleted,
            1
        ),
        ach!(
            "challenge_5",
            "Veterana de temporadas",
            "Cinco temporadas vencidas.",
            "trophy",
            Platinum,
            ChallengesCompleted,
            5
        ),
        // --- Metas anuais ---
        ach!(
            "annual_first",
            "Ano cumprido",
            "Você concluiu a sua primeira meta anual.",
            "sparkles",
            Gold,
            AnnualGoalsCompleted,
            1
        ),
    ]
}

/// As `key`s de todas as conquistas que os contadores JÁ satisfazem. O serviço
/// compara este conjunto com o que o ledger já registrou e grava só a diferença
/// (o desbloqueio é idempotente — uma linha por conquista).
pub fn evaluate(stats: &AchievementStats) -> Vec<&'static str> {
    catalog()
        .into_iter()
        .filter(|a| a.is_unlocked_by(stats))
        .map(|a| a.key)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_unique() {
        let cat = catalog();
        let mut keys: Vec<&str> = cat.iter().map(|a| a.key).collect();
        keys.sort_unstable();
        let before = keys.len();
        keys.dedup();
        assert_eq!(before, keys.len(), "chaves de conquista têm que ser únicas");
    }

    #[test]
    fn no_emoji_leaks_into_a_title_or_icon() {
        // M4.6 §3.2: nada de emoji na UI. O ícone é Lucide; o título é texto.
        for a in catalog() {
            for s in [a.title, a.description, a.icon] {
                assert!(
                    s.chars().all(|c| !is_emoji(c)),
                    "'{s}' não pode conter emoji"
                );
            }
        }
    }

    fn is_emoji(c: char) -> bool {
        let u = c as u32;
        (0x1F300..=0x1FAFF).contains(&u) || (0x2600..=0x27BF).contains(&u)
    }

    #[test]
    fn nothing_unlocks_on_an_empty_slate() {
        assert!(evaluate(&AchievementStats::default()).is_empty());
    }

    #[test]
    fn a_streak_unlocks_every_tier_at_or_below_it() {
        // 120 dias: destrava 7, 30 e 100, mas não 365.
        let stats = AchievementStats {
            max_habit_streak: 120,
            ..Default::default()
        };
        let keys = evaluate(&stats);
        assert!(keys.contains(&"streak_7"));
        assert!(keys.contains(&"streak_30"));
        assert!(keys.contains(&"streak_100"));
        assert!(!keys.contains(&"streak_365"));
    }

    #[test]
    fn the_threshold_is_inclusive() {
        let stats = AchievementStats {
            books_finished: 1,
            ..Default::default()
        };
        assert!(evaluate(&stats).contains(&"book_first"));
    }
}
