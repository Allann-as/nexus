//! NEXUS — a local-first Personal Operating System.
//!
//! Camadas (ver docs/ARCHITECTURE.md):
//!
//!   commands -> application -> domain <- infrastructure
//!
//! As setas apontam para `domain`, e `domain` não aponta para nada. Essa é a
//! regra inteira.

// Compilar um cdylib com o toolchain MSVC faz o linker imprimir um
// "Criando biblioteca ..." informativo no stdout, que o lint `linker_messages`
// do rustc reporta como warning. É ruído puro e não há como calar o linker.
// Restrito a este crate para o gate de zero-warning continuar significando algo;
// ver docs/DECISIONS.md (ADR-0004).
#![allow(linker_messages)]

pub mod application;
pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod state;

use infrastructure::{db::Db, logging, paths::Paths};
use state::AppState;

/// Monta o estado e roda o app.
///
/// A inicialização falha alto de propósito: um banco que não abre ou não migra
/// não pode chegar a uma UI semiviva que parece aceitar escritas.
pub fn run() {
    let paths = match Paths::resolve() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("NEXUS não conseguiu resolver o diretório de dados: {e}");
            std::process::exit(1);
        }
    };

    let _log_guard = logging::init(&paths);
    tracing::info!(root = %paths.root.display(), "iniciando NEXUS");

    let db = match Db::open(&paths) {
        Ok(db) => db,
        Err(e) => {
            tracing::error!(error = %e, "não foi possível abrir o banco");
            eprintln!("NEXUS não conseguiu abrir seu banco de dados: {e}");
            std::process::exit(1);
        }
    };

    let state = match AppState::new(db, paths) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "não foi possível montar o estado");
            eprintln!("NEXUS não conseguiu inicializar: {e}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::system::quick_check,
            commands::system::vacuum_db,
            commands::areas::create_area,
            commands::areas::list_areas,
            commands::areas::get_area,
            commands::areas::update_area,
            commands::areas::archive_area,
            commands::spheres::sphere_overview,
            commands::nodes::create_node,
            commands::nodes::capture_inbox,
            commands::nodes::triage_inbox_item,
            commands::nodes::get_node,
            commands::nodes::list_nodes,
            commands::nodes::count_nodes,
            commands::nodes::rename_node,
            commands::nodes::set_node_status,
            commands::nodes::delete_node,
            commands::search::search,
            commands::search::rebuild_search_index,
            commands::search::ledger_range,
            commands::search::ledger_for_entity,
            commands::habits::create_habit,
            commands::habits::create_routine,
            commands::habits::list_habits,
            commands::habits::get_habit,
            commands::habits::tick_habit,
            commands::habits::untick_habit,
            commands::habits::complete_routine,
            commands::habits::habit_streaks,
            commands::habits::habits_today,
            commands::habits::habit_heatmap,
            commands::habits::habit_weekday_stats,
            commands::habits::set_habit_schedule,
            commands::tasks::create_task,
            commands::tasks::create_project,
            commands::tasks::list_project_tasks,
            commands::tasks::get_task,
            commands::tasks::set_task_completed,
            commands::tasks::update_task,
            commands::tasks::move_task,
            commands::tasks::project_progress,
            commands::tasks::dashboard_today,
            commands::events::create_event,
            commands::events::get_event,
            commands::events::events_range,
            commands::events::update_event,
            commands::events::move_event,
            commands::events::resize_event,
            commands::events::cancel_occurrence,
            commands::events::delete_event,
            commands::events::event_conflicts,
            commands::events::events_by_category,
            commands::events::extend_materialization,
            commands::finance::list_accounts,
            commands::finance::add_contribution,
            commands::finance::recent_contributions,
            commands::finance::finance_overview,
            commands::finance::set_portfolio_snapshot,
            commands::fin_goals::create_fin_goal,
            commands::fin_goals::list_fin_goals,
            commands::fin_goals::deposit_fin_goal,
            commands::fin_goals::fin_goal_deposits,
            commands::books::create_book,
            commands::books::list_books,
            commands::books::set_book_progress,
            commands::books::set_book_status,
            commands::books::set_book_shelf,
            commands::books::set_book_rating,
            commands::books::finish_book,
            commands::books::studies_overview,
            commands::books::set_reading_goal,
            commands::books::reading_stats,
            commands::studies::create_subject,
            commands::studies::list_subjects,
            commands::studies::set_subject_target,
            commands::studies::archive_subject,
            commands::studies::subject_progress,
            commands::studies::log_study_session,
            commands::studies::recent_study_sessions,
            commands::studies::study_stats,
            commands::studies::delete_study_session,
            commands::career::record_career_milestone,
            commands::career::career_milestones,
            commands::career::create_skill,
            commands::career::level_up_skill,
            commands::career::list_skills,
            commands::career::skill_track,
            commands::career::skills_evolving,
            commands::links::link_nodes,
            commands::links::unlink_nodes,
            commands::links::node_links,
            commands::timeline::timeline_range,
            commands::timeline::timeline_year,
            commands::timeline::on_this_day,
            commands::timeline::ensure_timeline_rollups,
            commands::notes::data_root,
            commands::notes::list_notes,
            commands::notes::get_note,
            commands::notes::create_note,
            commands::notes::save_note_body,
            commands::notes::pin_note,
            commands::notes::attach_to_note,
            commands::goals::create_goal,
            commands::goals::list_goals,
            commands::goals::goal_with_progress,
            commands::goals::add_goal_checkpoint,
            commands::goals::add_milestone,
            commands::goals::set_milestone_done,
            commands::goals::set_goal_progress_source,
            commands::goals::move_milestone,
            commands::insights::get_insights,
            commands::insights::recompute_insights,
            commands::gamification::gamification_overview,
            commands::gamification::sync_achievements,
            commands::gamification::xp_reference,
            commands::challenges::create_challenge,
            commands::challenges::list_challenges,
            commands::challenges::increment_challenge,
            commands::challenges::abandon_challenge,
            commands::challenges::sync_challenges,
            commands::annual_goals::create_annual_goal,
            commands::annual_goals::annual_goal_year,
            commands::annual_goals::annual_goal_years,
            commands::annual_goals::update_annual_goal_progress,
            commands::annual_goals::complete_annual_goal,
            commands::annual_goals::abandon_annual_goal,
            commands::annual_goals::archive_annual_goal,
            commands::annual_goals::delete_annual_goal,
            commands::score::freeze_daily_scores,
            commands::score::score_history,
            commands::backup::create_backup,
            commands::backup::list_backups,
        ])
        .build(tauri::generate_context!())
        .expect("não foi possível construir a janela do NEXUS")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                // Melhor-esforço: atualiza as estatísticas do planejador na
                // saída. Uma falha aqui não pode impedir o app de fechar.
                if let Some(state) = app.try_state::<AppState>() {
                    if let Err(e) = state.db.optimize() {
                        tracing::warn!(error = %e, "PRAGMA optimize falhou no shutdown");
                    }
                }
                tracing::info!("NEXUS encerrado");
            }
        });
}
