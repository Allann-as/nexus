//! Testes de integração das caixinhas (fin_goals) — a TRAVA DE SAQUE (fase 11, BUG 1).
//!
//! O bug: dava para sacar mais do que o saldo, a caixinha ia a negativo absurdo e a
//! % da UI explodia (−247072%). A trava mora no `FinGoalService::deposit` (a fonte
//! da verdade), e é ela que estes testes exercitam contra um SQLite real.

use std::sync::Arc;

use nexus_lib::application::use_cases::fin_goals::FinGoalService;
use nexus_lib::domain::errors::NexusError;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, fin_goal_repo::SqliteFinGoalRepository,
    node_repo::SqliteNodeRepository,
};

fn service() -> (tempfile::TempDir, FinGoalService) {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());
    let svc = FinGoalService {
        fin_goals: Arc::new(SqliteFinGoalRepository::new(db.clone())),
        nodes: Arc::new(SqliteNodeRepository::new(db.clone())),
        areas: Arc::new(SqliteAreaRepository::new(db.clone())),
        ids: Arc::new(Uuid7Gen),
        clock: Arc::new(SystemClock),
    };
    (dir, svc)
}

fn saved(svc: &FinGoalService, id: &str) -> i64 {
    svc.list(None)
        .unwrap()
        .into_iter()
        .find(|c| c.goal.id == id)
        .unwrap()
        .goal
        .saved_cents
}

#[test]
fn a_deposit_then_a_withdrawal_within_balance_works() {
    let (_d, svc) = service();
    let g = svc.create("PS5", None, 450_000, None, None, None).unwrap();
    svc.deposit(&g.id, 100_000, None, None).unwrap(); // guarda R$ 1.000
    svc.deposit(&g.id, -40_000, None, None).unwrap(); // saca R$ 400
    assert_eq!(saved(&svc, &g.id), 60_000, "saldo = 1000 − 400 = R$ 600");
}

#[test]
fn a_withdrawal_cannot_exceed_the_balance() {
    let (_d, svc) = service();
    let g = svc.create("PS5", None, 450_000, None, None, None).unwrap();
    svc.deposit(&g.id, 100_000, None, None).unwrap(); // R$ 1.000
    let err = svc.deposit(&g.id, -100_001, None, None).unwrap_err(); // saca R$ 1.000,01
    assert!(
        matches!(err, NexusError::Validation(_)),
        "saque acima do saldo tem de ser rejeitado com erro de validação",
    );
    assert_eq!(
        saved(&svc, &g.id),
        100_000,
        "o saldo não muda quando o saque é rejeitado",
    );
}

#[test]
fn a_withdrawal_of_the_whole_balance_zeroes_without_going_negative() {
    let (_d, svc) = service();
    let g = svc.create("PS5", None, 450_000, None, None, None).unwrap();
    svc.deposit(&g.id, 100_000, None, None).unwrap();
    svc.deposit(&g.id, -100_000, None, None).unwrap(); // exatamente o saldo
    let s = saved(&svc, &g.id);
    assert_eq!(s, 0);
    assert!(s >= 0, "o saldo nunca pode ficar negativo");
}

#[test]
fn a_zero_deposit_is_rejected() {
    let (_d, svc) = service();
    let g = svc.create("PS5", None, 450_000, None, None, None).unwrap();
    assert!(matches!(
        svc.deposit(&g.id, 0, None, None).unwrap_err(),
        NexusError::Validation(_),
    ));
}
