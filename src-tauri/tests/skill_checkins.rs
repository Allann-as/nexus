//! Testes de integração do check-in mensal de competência (BÚSSOLA, fase E).
//!
//! Prova a cadeia inteira contra um SQLite real: o check-in é o FATO que o
//! usuário informa, e o nível 1-10 é DERIVAÇÃO dele (ADR-0037). A unidade pura da
//! fórmula mora em `domain::skill_level`; aqui se verifica o que só o banco pode
//! dizer — que corrigir o mês não empilha, que a história vai para o ledger, e
//! que a competência antiga (com `level` gravado e zero check-ins) continua
//! mostrando o nível que o usuário construiu clique a clique.

use std::sync::Arc;

use nexus_lib::application::ports::{Clock, LedgerRepository};
use nexus_lib::application::use_cases::career::CareerService;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, ledger_repo::SqliteLedgerRepository,
    node_repo::SqliteNodeRepository, skill_checkin_repo::SqliteSkillCheckinRepository,
    skill_repo::SqliteSkillRepository,
};

struct World {
    career: CareerService,
    db: Arc<Db>,
    _dir: tempfile::TempDir,
}

fn setup() -> World {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());
    let ledger: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));

    World {
        career: CareerService {
            skills: Arc::new(SqliteSkillRepository::new(db.clone())),
            checkins: Arc::new(SqliteSkillCheckinRepository::new(db.clone())),
            nodes: Arc::new(SqliteNodeRepository::new(db.clone())),
            areas: Arc::new(SqliteAreaRepository::new(db.clone())),
            ledger,
            ids: Arc::new(Uuid7Gen),
            clock: Arc::new(SystemClock),
        },
        db,
        _dir: dir,
    }
}

/// O mês corrente no fuso local — o mesmo que o serviço usa como referência.
fn this_month() -> String {
    SystemClock.today_local()[..7].to_string()
}

fn checkin_events(w: &World, skill_id: &str) -> i64 {
    w.db.with_read(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM ledger
              WHERE entity_id = ?1 AND event_type = 'skill_checkin'",
            [skill_id],
            |r| r.get(0),
        )?)
    })
    .unwrap()
}

#[test]
fn a_skill_without_checkins_keeps_its_stored_level_and_computes_nothing() {
    // A razão de as duas coisas conviverem: TODA competência criada antes da
    // v1.2 tem um `level` gravado e ZERO check-ins. O app não inventa um nível
    // calculado para ela — devolve `None`, e a UI cai no gravado.
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();
    assert_eq!(skill.level, 1);
    assert_eq!(skill.computed_level, None);

    // Sobe de nível pelo clique manual, que a v1.2 NÃO removeu.
    let up = w.career.level_up_skill(&skill.id).unwrap();
    assert_eq!(up.level, 2);
    assert_eq!(up.computed_level, None, "sem check-in, nada a derivar");

    // A régua calculada também volta vazia — não uma linha reta inventada.
    assert!(w.career.skill_level_history(&skill.id).unwrap().is_empty());
    assert_eq!(w.career.skill_computed_level(&skill.id).unwrap(), None);

    // E na listagem é a mesma história.
    let listed = w.career.skills(None).unwrap();
    assert_eq!(listed[0].level, 2);
    assert_eq!(listed[0].computed_level, None);
}

#[test]
fn the_first_checkin_starts_the_computed_level() {
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();

    // Um mês perfeito: estudou, aplicou o teto, cinco estrelas.
    let saved = w
        .career
        .record_skill_checkin(&skill.id, None, true, 4, 5)
        .unwrap();
    assert_eq!(saved.month, this_month());

    let listed = w.career.skills(None).unwrap();
    assert_eq!(listed[0].computed_level, Some(10));
    // O `level` gravado NÃO foi tocado: o check-in não é um "level up".
    assert_eq!(listed[0].level, 1);

    // E a fórmula sai por extenso, em português, com os números de verdade.
    let computed = w.career.skill_computed_level(&skill.id).unwrap().unwrap();
    assert_eq!(computed.level, 10);
    assert_eq!(computed.sample_size, 1);
    assert!(computed.formula.contains("Nível = 1 + arredondar"));
}

#[test]
fn correcting_the_month_fixes_the_state_but_keeps_both_facts() {
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();

    w.career
        .record_skill_checkin(&skill.id, None, true, 4, 5)
        .unwrap();
    assert_eq!(w.career.skills(None).unwrap()[0].computed_level, Some(10));

    // "Na verdade eu não estudei este mês."
    w.career
        .record_skill_checkin(&skill.id, None, false, 0, 1)
        .unwrap();

    let all = w.career.skill_checkins(&skill.id).unwrap();
    assert_eq!(all.len(), 1, "reinformar o mês CORRIGE, não empilha");
    assert!(!all[0].studied);
    assert_eq!(w.career.skills(None).unwrap()[0].computed_level, Some(1));

    // Mas o ledger é append-only: as DUAS respostas ficaram na história.
    assert_eq!(checkin_events(&w, &skill.id), 2);
}

#[test]
fn a_future_month_is_refused() {
    // Espelha o `counts_from` de um sub-desafio: não se informa o que ainda não
    // aconteceu. Um mês adiantado viraria a referência da fórmula e faria todos
    // os meses de verdade decaírem.
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();

    let err = w
        .career
        .record_skill_checkin(&skill.id, Some("2999-01".into()), true, 4, 5)
        .unwrap_err();
    assert!(format!("{err}").contains("ainda não aconteceu"), "{err}");

    // O mês corrente, sim.
    assert!(w
        .career
        .record_skill_checkin(&skill.id, Some(this_month()), true, 4, 5)
        .is_ok());
}

#[test]
fn a_malformed_month_is_refused() {
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();
    for bad in ["2026", "2026-13", "2026-1", "julho", "2026-07-18"] {
        assert!(
            w.career
                .record_skill_checkin(&skill.id, Some(bad.into()), true, 4, 5)
                .is_err(),
            "deveria recusar o mês '{bad}'"
        );
    }
}

#[test]
fn the_three_answers_are_validated() {
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();
    // Aplicar -1 vez não quer dizer nada.
    assert!(w
        .career
        .record_skill_checkin(&skill.id, None, true, -1, 3)
        .is_err());
    // A auto-avaliação vai de 1 a 5.
    assert!(w
        .career
        .record_skill_checkin(&skill.id, None, true, 1, 0)
        .is_err());
    assert!(w
        .career
        .record_skill_checkin(&skill.id, None, true, 1, 6)
        .is_err());
    // Nenhuma das três recusas gravou nada.
    assert!(w.career.skill_checkins(&skill.id).unwrap().is_empty());
    assert_eq!(checkin_events(&w, &skill.id), 0);
}

#[test]
fn a_checkin_on_something_that_is_not_a_skill_is_refused() {
    let w = setup();
    assert!(w
        .career
        .record_skill_checkin("fantasma", None, true, 1, 3)
        .is_err());
    assert!(w.career.skill_checkins("fantasma").is_err());
    assert!(w.career.skill_level_history("fantasma").is_err());
}

#[test]
fn the_level_history_walks_month_by_month_from_the_first_checkin() {
    let w = setup();
    let skill = w
        .career
        .create_skill("System Design", None, None, None)
        .unwrap();

    // Três meses seguidos terminando no mês corrente, todos perfeitos.
    let now = this_month();
    let (y, m): (i32, u32) = (now[..4].parse().unwrap(), now[5..].parse().unwrap());
    let months: Vec<String> = (0..3)
        .rev()
        .map(|back| {
            let idx = y * 12 + m as i32 - 1 - back;
            format!("{:04}-{:02}", idx.div_euclid(12), idx.rem_euclid(12) + 1)
        })
        .collect();
    for month in &months {
        w.career
            .record_skill_checkin(&skill.id, Some(month.clone()), true, 4, 5)
            .unwrap();
    }

    let history = w.career.skill_level_history(&skill.id).unwrap();
    assert_eq!(
        history.len(),
        3,
        "um ponto por mês desde o primeiro check-in"
    );
    assert_eq!(history[0].month, months[0]);
    assert_eq!(history[2].month, months[2]);
    // Três meses perfeitos = nível 10 do começo ao fim, e a amostra cresce.
    assert!(history.iter().all(|p| p.level == 10));
    assert_eq!(history[0].sample_size, 1);
    assert_eq!(history[2].sample_size, 3);
}
