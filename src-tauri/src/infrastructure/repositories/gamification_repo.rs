//! O lado de leitura da gamificação, em SQLite.
//!
//! XP é DERIVADO do estado (ADR-0037): nenhuma coluna de XP a manter, só a soma
//! dos pontos de tudo que o usuário fez. Tudo daqui bebe do pool `query_only`.

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::{AchievementCounts, GamificationRepository, XpPoints};
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

pub struct SqliteGamificationRepository {
    db: Arc<Db>,
}

impl SqliteGamificationRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl GamificationRepository for SqliteGamificationRepository {
    fn xp_by_area(&self, p: XpPoints) -> Result<Vec<(Option<String>, i64)>> {
        self.db.with_read(|c| {
            // Uma query só: cada fonte de XP contribui (area_id, pontos), e a
            // camada externa soma por Esfera. Os pontos vêm como parâmetros — a
            // tabela de pontos mora no domínio, não duplicada aqui.
            //
            // Um milestone concluído atribui à sua Esfera, ou à da meta-mãe se ele
            // não tiver a sua (COALESCE): sub-desafio nasce sob a meta.
            let mut stmt = c.prepare(
                "SELECT area_id, SUM(pts) AS xp FROM (
                    SELECT n.area_id AS area_id, COUNT(*) * ?1 AS pts
                      FROM habit_ticks t JOIN nodes n ON n.id = t.habit_id
                     WHERE t.status = 'done' GROUP BY n.area_id
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?2
                      FROM task_details td JOIN nodes n ON n.id = td.node_id
                     WHERE td.completed_at IS NOT NULL GROUP BY n.area_id
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?3
                      FROM goal_checkpoints gc JOIN nodes n ON n.id = gc.goal_id
                     GROUP BY n.area_id
                    UNION ALL
                    SELECT COALESCE(n.area_id, pa.area_id), COUNT(*) * ?4
                      FROM nodes n LEFT JOIN nodes pa ON pa.id = n.parent_id
                     WHERE n.kind = 'milestone' AND n.status = 'done'
                     GROUP BY COALESCE(n.area_id, pa.area_id)
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?5
                      FROM ledger l JOIN nodes n ON n.id = l.entity_id
                     WHERE l.event_type = 'skill_level_up' GROUP BY n.area_id
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?6 FROM nodes n
                     WHERE n.kind = 'book' AND n.status = 'done' GROUP BY n.area_id
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?7 FROM nodes n
                     WHERE n.kind = 'fin_goal' AND n.status = 'done' GROUP BY n.area_id
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?8 FROM nodes n
                     WHERE n.kind = 'challenge' AND n.status = 'done' GROUP BY n.area_id
                    UNION ALL
                    SELECT n.area_id, COUNT(*) * ?9 FROM nodes n
                     WHERE n.kind = 'annual_goal' AND n.status = 'done' GROUP BY n.area_id
                    UNION ALL
                    -- Uma sessão de estudo atribui à Esfera da MATÉRIA, ou à do
                    -- livro/competência se não tiver matéria (COALESCE). Sessão
                    -- só de tópico livre cai em area_id NULL — conta no geral.
                    SELECT COALESCE(subj.area_id, bk.area_id, sk.area_id), COUNT(*) * ?10
                      FROM study_sessions ss
                      LEFT JOIN nodes subj ON subj.id = ss.subject_id
                      LEFT JOIN nodes bk   ON bk.id   = ss.book_id
                      LEFT JOIN nodes sk   ON sk.id   = ss.skill_id
                     GROUP BY COALESCE(subj.area_id, bk.area_id, sk.area_id)
                 ) GROUP BY area_id",
            )?;
            let rows = stmt.query_map(
                params![
                    p.habit_done,
                    p.task_done,
                    p.goal_checkpoint,
                    p.milestone_done,
                    p.skill_level_up,
                    p.book_finished,
                    p.fin_goal_done,
                    p.challenge_done,
                    p.annual_goal_done,
                    p.study_session,
                ],
                |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, i64>(1)?)),
            )?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn achievement_counts(&self) -> Result<AchievementCounts> {
        self.db.with_read(|c| {
            let counts = c.query_row(
                "SELECT
                    (SELECT COUNT(*) FROM nodes WHERE kind='goal'        AND status='done'),
                    (SELECT COUNT(*) FROM nodes WHERE kind='fin_goal'    AND status='done'),
                    (SELECT COUNT(*) FROM nodes WHERE kind='book'        AND status='done'),
                    (SELECT COUNT(*) FROM ledger WHERE event_type='weekly_review_completed'),
                    (SELECT COUNT(*) FROM nodes WHERE kind='challenge'   AND status='done'),
                    (SELECT COUNT(*) FROM nodes WHERE kind='annual_goal' AND status='done')",
                [],
                |r| {
                    Ok(AchievementCounts {
                        goals_completed: r.get(0)?,
                        fin_goals_completed: r.get(1)?,
                        books_finished: r.get(2)?,
                        weekly_reviews: r.get(3)?,
                        challenges_completed: r.get(4)?,
                        annual_goals_completed: r.get(5)?,
                    })
                },
            )?;
            Ok(counts)
        })
    }

    fn contribution_months(&self) -> Result<Vec<String>> {
        self.db.with_read(|c| {
            // Só aportes de verdade (positivos): um resgate não conta como "mês
            // investindo". `happened_on` é 'YYYY-MM-DD', então o mês é substr(1,7).
            let mut stmt = c.prepare_cached(
                "SELECT DISTINCT substr(happened_on, 1, 7)
                   FROM contributions WHERE amount_cents > 0 ORDER BY 1",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}
