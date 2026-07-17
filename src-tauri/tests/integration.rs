//! Testes de integração contra um SQLite real em arquivo temporário.
//!
//! Arquivo e não `:memory:` de propósito: o pool de leitura abre uma conexão
//! SEPARADA. Com `:memory:` cada conexão teria seu próprio banco vazio e os
//! testes de "escreve e lê de volta" passariam por acidente sem provar nada.

use std::sync::Arc;

use nexus_lib::application::ports::{
    LedgerRepository, NodeFilter, NodeRepository, SearchRepository,
};
use nexus_lib::application::use_cases::{areas::AreaService, nodes::NodeService};
use nexus_lib::domain::entities::{Kind, Status};
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::fts::SqliteSearchRepository;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, ledger_repo::SqliteLedgerRepository,
    node_repo::SqliteNodeRepository,
};

struct Harness {
    areas: AreaService,
    nodes: NodeService,
    ledger: Arc<dyn LedgerRepository>,
    search: Arc<dyn SearchRepository>,
    node_repo: Arc<dyn NodeRepository>,
    db: Arc<Db>,
    _dir: tempfile::TempDir,
}

fn harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());

    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    Harness {
        areas: AreaService {
            repo: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        nodes: NodeService {
            nodes: node_repo.clone(),
            areas: area_repo,
            ids,
            clock,
        },
        ledger: Arc::new(SqliteLedgerRepository::new(db.clone())),
        search: Arc::new(SqliteSearchRepository::new(db.clone())),
        node_repo,
        db,
        _dir: dir,
    }
}

fn any(limit: i64) -> NodeFilter {
    NodeFilter {
        limit,
        ..Default::default()
    }
}

// ===== O ledger é append-only, garantido pelo banco =====

#[test]
fn ledger_rejects_update() {
    let h = harness();
    h.nodes.capture_inbox("comprar pão").unwrap();

    let err =
        h.db.with_write(|c| {
            c.execute(
                "UPDATE ledger SET title_snapshot = 'adulterado' WHERE seq = 1",
                [],
            )?;
            Ok(())
        })
        .unwrap_err();

    assert!(
        err.to_string().contains("append-only"),
        "o trigger deve barrar UPDATE, veio: {err}"
    );
}

#[test]
fn ledger_rejects_delete() {
    let h = harness();
    h.nodes.capture_inbox("comprar pão").unwrap();

    let err =
        h.db.with_write(|c| {
            c.execute("DELETE FROM ledger WHERE seq = 1", [])?;
            Ok(())
        })
        .unwrap_err();

    assert!(
        err.to_string().contains("append-only"),
        "o trigger deve barrar DELETE, veio: {err}"
    );
}

// ===== Estado atual e história na mesma transação =====

#[test]
fn creating_a_node_also_writes_history() {
    let h = harness();
    let node = h.nodes.capture_inbox("ligar para o dentista").unwrap();

    let events = h.ledger.for_entity(&node.id, 10).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "created");
    assert_eq!(events[0].entity_kind, "inbox_item");
    assert_eq!(events[0].title_snapshot, "ligar para o dentista");
}

#[test]
fn a_failed_create_leaves_no_history_behind() {
    let h = harness();
    let before = h.ledger.count().unwrap();

    // Área inexistente: o caso de uso barra antes de tocar o banco.
    let err = h
        .nodes
        .create(Kind::Task, "tarefa órfã", Some("area-fantasma"), None);
    assert!(err.is_err());

    assert_eq!(
        h.ledger.count().unwrap(),
        before,
        "uma criação que falhou não pode deixar evento no ledger"
    );
    assert_eq!(h.nodes.count(&any(10)).unwrap(), 0);
}

#[test]
fn history_survives_the_entity_it_describes() {
    let h = harness();
    let node = h.nodes.capture_inbox("efêmero").unwrap();
    let id = node.id.clone();

    h.nodes.delete(&id).unwrap();

    // O node se foi...
    assert!(h.nodes.get(&id).is_err());

    // ...mas a história dele continua: `ledger.entity_id` não tem FK, então o
    // CASCADE não a alcança. Você perde o item, não o registro de que existiu.
    let events = h.ledger.for_entity(&id, 10).unwrap();
    assert_eq!(events.len(), 2, "esperado 'created' + 'deleted'");
    let types: Vec<_> = events.iter().map(|e| e.event_type.as_str()).collect();
    assert!(types.contains(&"created"));
    assert!(types.contains(&"deleted"));
}

#[test]
fn title_snapshot_does_not_follow_later_renames() {
    let h = harness();
    let node = h.nodes.capture_inbox("nome antigo").unwrap();
    h.nodes.rename(&node.id, "nome novo").unwrap();

    let events = h.ledger.for_entity(&node.id, 10).unwrap();
    let created = events.iter().find(|e| e.event_type == "created").unwrap();

    // O passado não é reescrito: o evento de criação ainda diz o que era
    // verdade naquele momento.
    assert_eq!(created.title_snapshot, "nome antigo");
}

// ===== Triagem do Inbox =====

#[test]
fn triage_converts_kind_and_keeps_identity() {
    let h = harness();
    let area = h.areas.create("Saúde", "heart", "#4ADE80").unwrap();
    let item = h.nodes.capture_inbox("marcar check-up").unwrap();
    let original_id = item.id.clone();

    let triaged = h
        .nodes
        .triage(&item.id, Kind::Task, Some(&area.id))
        .unwrap();

    assert_eq!(triaged.kind, Kind::Task);
    assert_eq!(triaged.area_id.as_deref(), Some(area.id.as_str()));
    assert_eq!(
        triaged.id, original_id,
        "o id precisa sobreviver: é ele que liga a captura à história"
    );

    let types: Vec<_> = h
        .ledger
        .for_entity(&original_id, 10)
        .unwrap()
        .iter()
        .map(|e| e.event_type.clone())
        .collect();
    assert!(types.contains(&"created".to_string()));
    assert!(types.contains(&"triaged".to_string()));
}

#[test]
fn only_inbox_items_can_be_triaged() {
    let h = harness();
    let task = h
        .nodes
        .create(Kind::Task, "já é tarefa", None, None)
        .unwrap();

    let err = h.nodes.triage(&task.id, Kind::Note, None).unwrap_err();
    assert!(err.to_string().contains("Inbox"), "veio: {err}");
}

#[test]
fn triage_rejects_a_nonexistent_area() {
    let h = harness();
    let item = h.nodes.capture_inbox("x").unwrap();
    assert!(h
        .nodes
        .triage(&item.id, Kind::Task, Some("nao-existe"))
        .is_err());
}

// ===== Áreas =====

#[test]
fn areas_are_archived_never_deleted() {
    let h = harness();
    let area = h.areas.create("Carreira", "briefcase", "#7C8CF8").unwrap();

    h.areas.archive(&area.id).unwrap();

    assert_eq!(h.areas.list(false).unwrap().len(), 0, "some da lista ativa");
    assert_eq!(
        h.areas.list(true).unwrap().len(),
        1,
        "mas continua existindo — dados são sagrados"
    );
    assert!(h.areas.get(&area.id).unwrap().archived_at.is_some());
}

#[test]
fn archiving_twice_is_reported_honestly() {
    let h = harness();
    let area = h.areas.create("Carreira", "briefcase", "#7C8CF8").unwrap();
    h.areas.archive(&area.id).unwrap();

    let err = h.areas.archive(&area.id).unwrap_err();
    assert!(
        err.to_string().contains("já está arquivada"),
        "não pode virar um 'não encontrado' enganoso, veio: {err}"
    );
}

#[test]
fn area_colors_are_normalised() {
    let h = harness();
    let area = h.areas.create("Finanças", "wallet", "#4ade80").unwrap();
    assert_eq!(area.color, "#4ADE80");
}

#[test]
fn invalid_area_input_is_rejected() {
    let h = harness();
    assert!(
        h.areas.create("", "circle", "#7C8CF8").is_err(),
        "nome vazio"
    );
    assert!(
        h.areas.create("X", "circle", "vermelho").is_err(),
        "cor inválida"
    );
    assert!(
        h.areas.create("X", "Circle!", "#7C8CF8").is_err(),
        "ícone inválido"
    );
}

// ===== Busca FTS5 =====

#[test]
fn search_finds_by_title() {
    let h = harness();
    h.nodes.capture_inbox("comprar leite").unwrap();
    h.nodes.capture_inbox("passear com o cachorro").unwrap();

    let hits = h.search.search("leite", 10, 0).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "comprar leite");
}

#[test]
fn search_ignores_accents() {
    let h = harness();
    h.nodes.capture_inbox("consulta de saúde").unwrap();

    // remove_diacritics=2: quem digita rápido não põe acento.
    assert_eq!(h.search.search("saude", 10, 0).unwrap().len(), 1);
    assert_eq!(h.search.search("saúde", 10, 0).unwrap().len(), 1);
}

#[test]
fn search_matches_prefixes_for_type_ahead() {
    let h = harness();
    h.nodes.capture_inbox("reunião de equipe").unwrap();

    // A busca precisa achar enquanto a pessoa ainda digita.
    for partial in ["r", "re", "reun", "reuni"] {
        assert_eq!(
            h.search.search(partial, 10, 0).unwrap().len(),
            1,
            "prefixo '{partial}' deveria encontrar"
        );
    }
}

#[test]
fn search_requires_all_terms() {
    let h = harness();
    h.nodes.capture_inbox("comprar leite").unwrap();
    h.nodes.capture_inbox("comprar pão").unwrap();

    assert_eq!(h.search.search("comprar", 10, 0).unwrap().len(), 2);
    assert_eq!(
        h.search.search("comprar leite", 10, 0).unwrap().len(),
        1,
        "termos juntos = AND implícito"
    );
}

#[test]
fn search_index_follows_renames() {
    let h = harness();
    let node = h.nodes.capture_inbox("título original").unwrap();

    h.nodes.rename(&node.id, "título alterado").unwrap();

    assert_eq!(
        h.search.search("original", 10, 0).unwrap().len(),
        0,
        "o termo antigo não pode continuar encontrável"
    );
    assert_eq!(h.search.search("alterado", 10, 0).unwrap().len(), 1);
}

#[test]
fn search_index_forgets_deleted_nodes() {
    let h = harness();
    let node = h.nodes.capture_inbox("some daqui").unwrap();
    h.nodes.delete(&node.id).unwrap();

    assert_eq!(
        h.search.search("some", 10, 0).unwrap().len(),
        0,
        "um node apagado não pode aparecer na busca"
    );
}

#[test]
fn search_input_is_never_treated_as_syntax() {
    let h = harness();
    h.nodes.capture_inbox("relatório anual").unwrap();

    // Nenhuma destas entradas pode explodir nem virar operador do FTS5.
    for hostile in [
        "\"",
        "*",
        "()",
        "AND",
        "OR NOT",
        "NEAR(a b)",
        "title:relatório",
        "relatório\" OR \"x",
        "^&*()",
        "'; DROP TABLE nodes;--",
    ] {
        let result = h.search.search(hostile, 10, 0);
        assert!(
            result.is_ok(),
            "entrada {hostile:?} quebrou a busca: {result:?}"
        );
    }

    // E o dado continua lá.
    assert_eq!(h.nodes.count(&any(10)).unwrap(), 1);
}

#[test]
fn empty_search_returns_nothing_rather_than_everything() {
    let h = harness();
    h.nodes.capture_inbox("qualquer coisa").unwrap();

    assert!(h.search.search("", 10, 0).unwrap().is_empty());
    assert!(h.search.search("   ", 10, 0).unwrap().is_empty());
    assert!(h.search.search("!!!", 10, 0).unwrap().is_empty());
}

#[test]
fn rebuild_reconstructs_the_index_from_current_state() {
    let h = harness();
    h.nodes.capture_inbox("documento importante").unwrap();

    // Simula um índice divergente (gatilho falho num upgrade, edição externa).
    h.db.with_write(|c| {
        c.execute("DELETE FROM search_index", [])?;
        Ok(())
    })
    .unwrap();
    assert_eq!(h.search.search("documento", 10, 0).unwrap().len(), 0);

    h.search.rebuild().unwrap();
    assert_eq!(
        h.search.search("documento", 10, 0).unwrap().len(),
        1,
        "rebuild é a válvula de escape quando o índice diverge"
    );
}

// ===== Filtros e paginação =====

#[test]
fn nodes_can_be_filtered_by_kind_and_status() {
    let h = harness();
    let area = h.areas.create("Trabalho", "briefcase", "#7C8CF8").unwrap();
    h.nodes
        .create(Kind::Task, "t1", Some(&area.id), None)
        .unwrap();
    h.nodes
        .create(Kind::Task, "t2", Some(&area.id), None)
        .unwrap();
    let note = h
        .nodes
        .create(Kind::Note, "n1", Some(&area.id), None)
        .unwrap();
    h.nodes.set_status(&note.id, Status::Done).unwrap();

    let tasks = NodeFilter {
        kind: Some(Kind::Task),
        limit: 10,
        ..Default::default()
    };
    assert_eq!(h.nodes.count(&tasks).unwrap(), 2);

    let done = NodeFilter {
        status: Some(Status::Done),
        limit: 10,
        ..Default::default()
    };
    assert_eq!(h.nodes.count(&done).unwrap(), 1);

    let in_area = NodeFilter {
        area_id: Some(area.id.clone()),
        limit: 10,
        ..Default::default()
    };
    assert_eq!(h.nodes.count(&in_area).unwrap(), 3);
}

#[test]
fn pagination_does_not_skip_or_repeat_rows() {
    let h = harness();
    for i in 0..25 {
        h.nodes.capture_inbox(&format!("item {i:02}")).unwrap();
    }

    let mut seen = std::collections::HashSet::new();
    for page in 0..3 {
        let rows = h
            .nodes
            .list(&NodeFilter {
                limit: 10,
                offset: page * 10,
                ..Default::default()
            })
            .unwrap();
        for r in rows {
            assert!(
                seen.insert(r.id.clone()),
                "linha repetida entre páginas: {}",
                r.title
            );
        }
    }
    // 25 itens criados no mesmo milissegundo: só não se embaralham porque o
    // ORDER BY desempata por id (UUIDv7), não só por created_at.
    assert_eq!(seen.len(), 25, "nenhuma linha pode sumir na paginação");
}

// ===== Status =====

#[test]
fn completing_a_task_is_recorded_as_completed_not_status_changed() {
    let h = harness();
    let task = h
        .nodes
        .create(Kind::Task, "entregar relatório", None, None)
        .unwrap();

    h.nodes.set_status(&task.id, Status::Done).unwrap();

    let events = h.ledger.for_entity(&task.id, 10).unwrap();
    // O BI conta conclusões; se isso virasse 'status_changed' ele teria que
    // interpretar payload para saber o que aconteceu.
    assert!(
        events.iter().any(|e| e.event_type == "completed"),
        "esperado um evento 'completed', veio: {:?}",
        events.iter().map(|e| &e.event_type).collect::<Vec<_>>()
    );
}

// ===== Repositório: contrato de erro =====

#[test]
fn updating_a_missing_node_is_not_found_not_silence() {
    let h = harness();
    let err = h.nodes.rename("nao-existe", "x").unwrap_err();
    assert!(err.to_string().contains("não encontrado") || err.to_string().contains("node"));
}

#[test]
fn node_repo_reports_missing_rows_on_delete() {
    let h = harness();
    assert!(h.nodes.delete("nao-existe").is_err());
    // E o repositório direto também, sem passar pelo caso de uso.
    assert!(h.node_repo.get("nao-existe").is_err());
}
