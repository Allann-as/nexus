//! Adaptadores de tempo e identidade.

use chrono::{Local, Utc};

use crate::application::ports::{Clock, IdGen};

/// O relógio do sistema.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        Utc::now().timestamp_millis()
    }

    fn today_local(&self) -> String {
        // Local, não UTC: "fiz o hábito hoje?" é sobre o dia do usuário. Em UTC,
        // quem marca um hábito às 22h em Brasília (UTC-3) veria o tick cair no
        // dia seguinte — e o streak quebraria sozinho à noite.
        Local::now().format("%Y-%m-%d").to_string()
    }
}

/// UUIDv7: ordenável por tempo.
pub struct Uuid7Gen;

impl IdGen for Uuid7Gen {
    fn new_id(&self) -> String {
        uuid::Uuid::now_v7().to_string()
    }
}

#[cfg(test)]
pub mod test_support {
    use std::sync::Mutex;

    use super::*;

    /// Relógio determinístico. Sem isto, testar "o que aconteceu ontem?"
    /// dependeria de esperar a meia-noite chegar.
    pub struct FixedClock {
        pub ms: Mutex<i64>,
        pub day: Mutex<String>,
    }

    impl FixedClock {
        pub fn new(ms: i64, day: &str) -> Self {
            Self {
                ms: Mutex::new(ms),
                day: Mutex::new(day.to_string()),
            }
        }

        pub fn set(&self, ms: i64, day: &str) {
            *self.ms.lock().unwrap() = ms;
            *self.day.lock().unwrap() = day.to_string();
        }
    }

    impl Clock for FixedClock {
        fn now_ms(&self) -> i64 {
            *self.ms.lock().unwrap()
        }
        fn today_local(&self) -> String {
            self.day.lock().unwrap().clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn today_local_is_iso_shaped() {
        let day = SystemClock.today_local();
        assert_eq!(day.len(), 10, "esperado YYYY-MM-DD, veio {day}");
        assert_eq!(day.matches('-').count(), 2);
    }

    #[test]
    fn uuid7_ids_sort_by_creation_time() {
        // A propriedade que justifica o UUIDv7: ordem lexicográfica == ordem
        // temporal, então os inserts caem no fim da B-tree em vez de espalhar
        // page splits. Se isto quebrar, o índice degrada com o tempo.
        let a = Uuid7Gen.new_id();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = Uuid7Gen.new_id();
        assert!(a < b, "{a} deveria ordenar antes de {b}");
    }

    #[test]
    fn uuid7_ids_are_unique() {
        let ids: std::collections::HashSet<_> = (0..1000).map(|_| Uuid7Gen.new_id()).collect();
        assert_eq!(ids.len(), 1000);
    }
}
