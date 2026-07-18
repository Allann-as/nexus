//! O Hub — a tela que responde "como está a minha vida?".
//!
//! O Dashboard responde sobre o DIA; o Hub responde sobre as ESFERAS. Cada card
//! do Hub carrega estatística real: hábitos de hoje, streak vivo, tarefas em
//! aberto e a série dos últimos 30 dias. Nada de placeholder — um card que
//! mostra número inventado é pior que um card vazio.
//!
//! Custo: DUAS queries em lote (`SphereRepository`) + uma lista de hábitos,
//! independente de quantas Esferas existam. Todo o resto é aritmética em
//! memória sobre dados que já estão carregados.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{Duration, NaiveDate};
use serde::Serialize;

use crate::application::ports::{AreaRepository, Clock, Habit, HabitRepository, SphereRepository};
use crate::domain::entities::{Area, Kind};
use crate::domain::errors::Result;
use crate::domain::schedule::{format_day, parse_day};
use crate::domain::streak::{self, TickStatus, Ticks};

/// A janela do sparkline: 30 dias.
///
/// Não é estética. É o menor período em que "regularidade" quer dizer alguma
/// coisa e ainda cabe num traço de 90px sem virar ruído.
const SPARK_DAYS: i64 = 30;

/// A janela do streak.
///
/// Um streak vivo maior que 2 anos é raro o bastante para não valer ler a
/// história inteira a cada abertura do app. Quem passar disso vê "730" no Hub e
/// o número exato na tela do hábito, que lê a série completa.
const STREAK_DAYS: i64 = 730;

/// Um card do Hub.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SphereCard {
    #[serde(flatten)]
    pub area: Area,
    pub habits_today_done: u32,
    pub habits_today_total: u32,
    /// O melhor streak VIVO da Esfera — o número que o usuário não quer perder.
    pub best_streak: u32,
    /// O hábito dono do `best_streak`. O card diz "Treino · 12 dias", não só "12".
    pub best_streak_title: Option<String>,
    pub open_tasks: i64,
    pub open_projects: i64,
    /// Razão de conclusão por dia, 30 dias, do mais antigo ao mais recente.
    /// Dias sem nada agendado entram como 0.0 — ver `spark_series`.
    pub spark: Vec<f64>,
    /// `true` quando a Esfera não tem nada ligado a ela ainda. A UI convida a
    /// começar em vez de exibir uma parede de zeros.
    pub is_empty: bool,
}

pub struct SphereService {
    pub areas: Arc<dyn AreaRepository>,
    pub habits: Arc<dyn HabitRepository>,
    pub spheres: Arc<dyn SphereRepository>,
    pub clock: Arc<dyn Clock>,
}

impl SphereService {
    /// Todos os cards do Hub.
    pub fn overview(&self) -> Result<Vec<SphereCard>> {
        let today = parse_day(&self.clock.today_local())?;
        let since = today - Duration::days(STREAK_DAYS);

        let areas = self.areas.list(false)?;
        let habits = self.habits.list(None, false)?;
        let ticks = self.ticks_by_habit(&format_day(since))?;
        let counts = self.counts_by_area()?;

        let mut cards = Vec::with_capacity(areas.len());
        for area in areas {
            let mine: Vec<&Habit> = habits
                .iter()
                .filter(|h| h.area_id.as_deref() == Some(area.id.as_str()))
                .collect();

            let (habits_today_done, habits_today_total) = self.today_progress(&mine, &ticks, today);
            let (best_streak, best_streak_title) = self.best_streak(&mine, &ticks, today);
            let spark = self.spark_series(&mine, &ticks, today);

            let open_tasks = counts
                .get(&(area.id.clone(), Kind::Task))
                .copied()
                .unwrap_or(0);
            let open_projects = counts
                .get(&(area.id.clone(), Kind::Project))
                .copied()
                .unwrap_or(0);

            cards.push(SphereCard {
                is_empty: mine.is_empty() && open_tasks == 0 && open_projects == 0,
                area,
                habits_today_done,
                habits_today_total,
                best_streak,
                best_streak_title,
                open_tasks,
                open_projects,
                spark,
            });
        }
        Ok(cards)
    }

    /// Os ticks da janela, agrupados por hábito e prontos para o domínio.
    ///
    /// Uma query, um agrupamento. O `streak::compute` recebe o mesmo
    /// `BTreeMap` que receberia se tivéssemos consultado hábito por hábito — o
    /// domínio não sabe (nem precisa saber) que a leitura foi em lote.
    fn ticks_by_habit(&self, since: &str) -> Result<BTreeMap<String, Ticks>> {
        let mut by_habit: BTreeMap<String, Ticks> = BTreeMap::new();
        for (habit_id, day, tick) in self.spheres.ticks_since(since)? {
            let Ok(day) = parse_day(&day) else { continue };
            by_habit
                .entry(habit_id)
                .or_default()
                .insert(day, tick.status);
        }
        Ok(by_habit)
    }

    fn counts_by_area(&self) -> Result<BTreeMap<(String, Kind), i64>> {
        let mut out = BTreeMap::new();
        for (area_id, kind, count) in self.spheres.active_node_counts_by_area()? {
            // Os órfãos (Inbox) não pertencem a Esfera nenhuma e por isso não
            // entram em card nenhum. Eles têm o badge da rail.
            if let Some(area_id) = area_id {
                out.insert((area_id, kind), count);
            }
        }
        Ok(out)
    }

    /// Hábitos da Esfera agendados para hoje: quantos e quantos feitos.
    fn today_progress(
        &self,
        habits: &[&Habit],
        ticks: &BTreeMap<String, Ticks>,
        today: NaiveDate,
    ) -> (u32, u32) {
        let mut total = 0;
        let mut done = 0;
        for h in habits {
            if !h.schedule.is_scheduled_on(today) {
                continue;
            }
            total += 1;
            if ticks.get(&h.id).and_then(|t| t.get(&today)) == Some(&TickStatus::Done) {
                done += 1;
            }
        }
        (done, total)
    }

    /// O maior streak em curso da Esfera, e de quem é.
    fn best_streak(
        &self,
        habits: &[&Habit],
        ticks: &BTreeMap<String, Ticks>,
        today: NaiveDate,
    ) -> (u32, Option<String>) {
        habits
            .iter()
            .filter_map(|h| {
                let t = ticks.get(&h.id)?;
                let s = streak::compute(&h.schedule, t, today);
                (s.current > 0).then(|| (s.current, h.title.clone()))
            })
            .max_by_key(|(current, _)| *current)
            .map(|(current, title)| (current, Some(title)))
            .unwrap_or((0, None))
    }

    /// A série do sparkline: razão feito/agendado por dia.
    ///
    /// Um dia sem NADA agendado vale 0.0, não "vazio": o traço mede a atividade
    /// da Esfera, e um domingo sem hábito agendado é mesmo um dia sem
    /// atividade. Tratá-lo como buraco faria a linha mentir por interpolação.
    fn spark_series(
        &self,
        habits: &[&Habit],
        ticks: &BTreeMap<String, Ticks>,
        today: NaiveDate,
    ) -> Vec<f64> {
        (0..SPARK_DAYS)
            .map(|offset| {
                let day = today - Duration::days(SPARK_DAYS - 1 - offset);
                let (done, total) = self.today_progress(habits, ticks, day);
                if total == 0 {
                    0.0
                } else {
                    f64::from(done) / f64::from(total)
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::Tick;
    use crate::domain::schedule::Schedule;

    fn d(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    fn habit(id: &str, title: &str, schedule: Schedule) -> Habit {
        Habit {
            id: id.into(),
            title: title.into(),
            area_id: Some("a1".into()),
            status: "active".into(),
            schedule,
            target_value: None,
            unit: None,
            routine_id: None,
            routine_order: None,
            reminder_time: None,
        }
    }

    fn ticks_of(entries: &[(&str, &str, TickStatus)]) -> BTreeMap<String, Ticks> {
        let mut out: BTreeMap<String, Ticks> = BTreeMap::new();
        for (habit_id, day, status) in entries {
            out.entry((*habit_id).into())
                .or_default()
                .insert(d(day), *status);
        }
        out
    }

    /// Um serviço com ports que nunca são chamados pelos métodos puros abaixo.
    /// Os testes exercitam a aritmética; a leitura já é coberta em sphere_repo.
    fn service() -> SphereService {
        struct Unused;
        impl Clock for Unused {
            fn now_ms(&self) -> i64 {
                0
            }
            fn today_local(&self) -> String {
                "2026-07-17".into()
            }
        }
        SphereService {
            areas: Arc::new(FakeAreas),
            habits: Arc::new(FakeHabits),
            spheres: Arc::new(FakeSpheres),
            clock: Arc::new(Unused),
        }
    }

    struct FakeAreas;
    impl AreaRepository for FakeAreas {
        fn create(&self, _: &str, _: &crate::application::ports::NewArea) -> Result<Area> {
            unimplemented!()
        }
        fn get(&self, _: &str) -> Result<Area> {
            unimplemented!()
        }
        fn list(&self, _: bool) -> Result<Vec<Area>> {
            Ok(vec![])
        }
        fn update(&self, _: &str, _: &crate::application::ports::AreaPatch) -> Result<Area> {
            unimplemented!()
        }
        fn archive(&self, _: &str, _: i64) -> Result<()> {
            unimplemented!()
        }
        fn exists(&self, _: &str) -> Result<bool> {
            Ok(true)
        }
    }

    struct FakeHabits;
    impl HabitRepository for FakeHabits {
        fn create_details(
            &self,
            _: &str,
            _: &crate::application::ports::NewHabitDetails,
        ) -> Result<()> {
            unimplemented!()
        }
        fn get(&self, _: &str) -> Result<Habit> {
            unimplemented!()
        }
        fn list(&self, _: Option<&str>, _: bool) -> Result<Vec<Habit>> {
            Ok(vec![])
        }
        fn list_in_routine(&self, _: &str) -> Result<Vec<Habit>> {
            Ok(vec![])
        }
        fn update_schedule(&self, _: &str, _: &Schedule) -> Result<()> {
            unimplemented!()
        }
        fn tick_with_event(
            &self,
            _: &str,
            _: &str,
            _: Tick,
            _: i64,
            _: &crate::domain::ledger::NewLedgerEvent,
        ) -> Result<()> {
            unimplemented!()
        }
        fn untick_with_event(
            &self,
            _: &str,
            _: &str,
            _: &crate::domain::ledger::NewLedgerEvent,
        ) -> Result<()> {
            unimplemented!()
        }
        fn ticks_in_range(&self, _: &str, _: &str, _: &str) -> Result<Vec<(String, Tick)>> {
            Ok(vec![])
        }
        fn ticks_on_day(&self, _: &str) -> Result<Vec<(String, Tick)>> {
            Ok(vec![])
        }
        fn complete_routine(
            &self,
            _: &str,
            _: &str,
            _: i64,
            _: &[(String, crate::domain::ledger::NewLedgerEvent)],
        ) -> Result<u32> {
            unimplemented!()
        }
        fn failure_rate_by_weekday(&self, _: &str, _: &str) -> Result<Vec<(u8, u32, u32)>> {
            Ok(vec![])
        }
    }

    struct FakeSpheres;
    impl SphereRepository for FakeSpheres {
        fn ticks_since(&self, _: &str) -> Result<Vec<(String, String, Tick)>> {
            Ok(vec![])
        }
        fn active_node_counts_by_area(&self) -> Result<Vec<(Option<String>, Kind, i64)>> {
            Ok(vec![])
        }
    }

    #[test]
    fn today_progress_counts_only_whats_scheduled_today() {
        let svc = service();
        // 17/07/2026 é uma sexta (índice 5).
        let h1 = habit("h1", "Treino", Schedule::Daily);
        let h2 = habit("h2", "Anki", Schedule::Weekdays { days: vec![1, 3] }); // seg/qua
        let habits = vec![&h1, &h2];
        let ticks = ticks_of(&[("h1", "2026-07-17", TickStatus::Done)]);

        let (done, total) = svc.today_progress(&habits, &ticks, d("2026-07-17"));
        assert_eq!(total, 1, "o hábito de seg/qua não é cobrado numa sexta");
        assert_eq!(done, 1);
    }

    #[test]
    fn skipped_today_does_not_count_as_done() {
        // A folga assumida é neutra para o streak, mas o card de hoje diz o que
        // FOI FEITO. "2/3" com uma folga no meio seria uma mentira gentil.
        let svc = service();
        let h1 = habit("h1", "Treino", Schedule::Daily);
        let habits = vec![&h1];
        let ticks = ticks_of(&[("h1", "2026-07-17", TickStatus::Skipped)]);

        let (done, total) = svc.today_progress(&habits, &ticks, d("2026-07-17"));
        assert_eq!((done, total), (0, 1));
    }

    #[test]
    fn best_streak_picks_the_longest_live_one_and_names_it() {
        let svc = service();
        let h1 = habit("h1", "Treino", Schedule::Daily);
        let h2 = habit("h2", "Água", Schedule::Daily);
        let habits = vec![&h1, &h2];

        let ticks = ticks_of(&[
            // Treino: 2 dias.
            ("h1", "2026-07-16", TickStatus::Done),
            ("h1", "2026-07-17", TickStatus::Done),
            // Água: 4 dias — o vencedor.
            ("h2", "2026-07-14", TickStatus::Done),
            ("h2", "2026-07-15", TickStatus::Done),
            ("h2", "2026-07-16", TickStatus::Done),
            ("h2", "2026-07-17", TickStatus::Done),
        ]);

        let (best, title) = svc.best_streak(&habits, &ticks, d("2026-07-17"));
        assert_eq!(best, 4);
        assert_eq!(title.as_deref(), Some("Água"), "o card nomeia o dono");
    }

    #[test]
    fn a_dead_streak_is_not_the_best_streak() {
        // Só sequência VIVA vale: mostrar o recorde de um hábito abandonado
        // como se fosse o streak atual seria o card mentindo.
        let svc = service();
        let h1 = habit("h1", "Treino", Schedule::Daily);
        let habits = vec![&h1];
        let ticks = ticks_of(&[
            ("h1", "2026-07-01", TickStatus::Done),
            ("h1", "2026-07-02", TickStatus::Done),
            ("h1", "2026-07-03", TickStatus::Done),
        ]);

        let (best, title) = svc.best_streak(&habits, &ticks, d("2026-07-17"));
        assert_eq!(best, 0, "a sequência morreu duas semanas atrás");
        assert_eq!(title, None);
    }

    #[test]
    fn spark_series_has_one_point_per_day_in_the_window() {
        let svc = service();
        let h1 = habit("h1", "Treino", Schedule::Daily);
        let habits = vec![&h1];
        let ticks = ticks_of(&[("h1", "2026-07-17", TickStatus::Done)]);

        let spark = svc.spark_series(&habits, &ticks, d("2026-07-17"));
        assert_eq!(spark.len() as i64, SPARK_DAYS);
        assert_eq!(spark[spark.len() - 1], 1.0, "o último ponto é hoje");
        assert_eq!(spark[0], 0.0, "30 dias atrás não houve tick");
    }

    #[test]
    fn spark_series_is_a_ratio_not_a_count() {
        // Dois hábitos, um feito = 0.5. Sem isso, uma Esfera com 10 hábitos
        // pareceria sempre mais ativa que uma com 2, independente da adesão.
        let svc = service();
        let h1 = habit("h1", "Treino", Schedule::Daily);
        let h2 = habit("h2", "Água", Schedule::Daily);
        let habits = vec![&h1, &h2];
        let ticks = ticks_of(&[("h1", "2026-07-17", TickStatus::Done)]);

        let spark = svc.spark_series(&habits, &ticks, d("2026-07-17"));
        assert_eq!(spark[spark.len() - 1], 0.5);
    }

    #[test]
    fn a_sphere_without_habits_has_a_flat_series_not_a_panic() {
        let svc = service();
        let spark = svc.spark_series(&[], &BTreeMap::new(), d("2026-07-17"));
        assert_eq!(spark.len() as i64, SPARK_DAYS);
        assert!(
            spark.iter().all(|v| *v == 0.0),
            "divisão por zero não acontece"
        );
    }
}
