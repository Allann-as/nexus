//! Casos de uso da Carreira — os marcos profissionais.
//!
//! Um marco de carreira (promoção, certificação, novo emprego) é um FATO da vida
//! do usuário que NÃO é um node (§2.3, ADR-0027): ele não tem tela nem satélite,
//! só existe na história. Por isso o "serviço" é fino — ele fala direto com o
//! ledger, sem repositório de domínio próprio.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, IdGen, LedgerRepository, NewNode, NewSkill, NewSkillCheckin,
    NodeRepository, Skill, SkillCheckin, SkillCheckinRepository, SkillRepository,
};
use crate::domain::entities::{validate_title, CareerMilestoneKind, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, LedgerEntry, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};
use crate::domain::skill_level::{
    compute_level, format_month, month_of_day, parse_month, ComputedLevel, MonthlyCheckin,
};

/// Quantos marcos o painel da Carreira mostra por vez.
const MILESTONE_LIMIT: i64 = 50;

pub struct CareerService {
    pub skills: Arc<dyn SkillRepository>,
    /// Os check-ins mensais (BÚSSOLA, fase E) — a matéria-prima do nível
    /// calculado. Ver `Skill::computed_level`.
    pub checkins: Arc<dyn SkillCheckinRepository>,
    /// Para EXCLUIR uma competência: ela é um node, e apagar um node é a mesma
    /// operação para todos eles (ADR-0056). Ver `CareerService::delete_skill`.
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

/// Um ponto da trilha de evolução de uma competência.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPoint {
    /// 'YYYY-MM-DD' local.
    pub day: String,
    pub level: i64,
}

/// Um ponto da régua de evolução CALCULADA (BÚSSOLA, fase E): o nível que a
/// fórmula daria naquele mês, olhando só o que já havia acontecido até ali.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLevelPoint {
    /// 'YYYY-MM' local.
    pub month: String,
    /// 1..=10.
    pub level: i64,
    /// A média ponderada daquele mês, para o "ⓘ como calculamos" do gráfico.
    pub weighted_avg: f64,
    pub sample_size: i64,
}

impl CareerService {
    /// Registra um marco de carreira no ledger.
    pub fn record_milestone(
        &self,
        title: &str,
        kind: CareerMilestoneKind,
        happened_on: Option<String>,
        note: Option<String>,
    ) -> Result<LedgerEntry> {
        let title = validate_title(title)?;
        // O dia é do usuário (um marco pode ser retroativo); o `ts` é agora.
        let day = match happened_on {
            Some(d) => format_day(parse_day(&d)?),
            None => self.clock.today_local(),
        };
        let id = self.ids.new_id();
        let now = self.clock.now_ms();

        let event = NewLedgerEvent {
            ts: now,
            day,
            entity_id: id,
            entity_kind: LedgerEntityKind::CareerMilestone,
            event_type: EventType::Created,
            payload: json!({ "kind": kind.as_str(), "note": note }),
            title_snapshot: title,
        };
        let seq = self.ledger.append(&event)?;

        // Devolve a linha como ela ficou gravada, para a UI inserir sem refetch.
        Ok(LedgerEntry {
            seq,
            ts: event.ts,
            day: event.day,
            entity_id: event.entity_id,
            entity_kind: event.entity_kind.as_str().to_string(),
            event_type: event.event_type.as_str().to_string(),
            payload: event.payload.to_string(),
            title_snapshot: event.title_snapshot,
        })
    }

    /// Os marcos de carreira, do mais recente ao mais antigo.
    ///
    /// Os marcos RETRATADOS (ver `delete_milestone`) somem daqui: o painel mostra
    /// o que é verdade hoje. Os dois eventos — o original e a retratação —
    /// continuam no ledger, e a Timeline desenha os dois, cada um no seu dia.
    pub fn milestones(&self) -> Result<Vec<LedgerEntry>> {
        // O limite é dobrado na leitura porque a lista traz criações E
        // retratações misturadas; sem isso, um usuário com muitas correções veria
        // a página encolher. O corte final volta ao limite do painel.
        let raw = self
            .ledger
            .by_entity_kind("career_milestone", MILESTONE_LIMIT * 2)?;

        let retracted: std::collections::HashSet<&str> = raw
            .iter()
            .filter(|e| e.event_type == EventType::Deleted.as_str())
            .map(|e| e.entity_id.as_str())
            .collect();

        Ok(raw
            .iter()
            .filter(|e| {
                e.event_type == EventType::Created.as_str()
                    && !retracted.contains(e.entity_id.as_str())
            })
            .take(MILESTONE_LIMIT as usize)
            .cloned()
            .collect())
    }

    /// "Exclui" um marco de carreira — apendando uma RETRATAÇÃO (BÚSSOLA, fase B).
    ///
    /// Aqui o pedido "delete" não pode ser atendido ao pé da letra, e a razão é
    /// estrutural: um marco de carreira **não tem estado**. Ele é um fato do
    /// ledger e nada mais (ADR-0032) — não há node, satélite nem linha de estado
    /// para apagar. E o ledger é append-only por GATILHO (`RAISE(ABORT)` em
    /// UPDATE/DELETE): nem o próprio app reescreve a história.
    ///
    /// Então o único caminho honesto é o do ADR-0056, levado ao seu caso-limite.
    /// No aporte, "excluir" eram DUAS coisas — apagar a linha de estado e apendar
    /// a correção. Um marco não tem a primeira metade: sobra a segunda, e ela
    /// sozinha É a operação. Apendamos um `Deleted` com o MESMO `entity_id`, e o
    /// painel passa a ler os marcos descontando os retratados (`milestones`).
    ///
    /// O usuário vê o marco sumir da Carreira, que era o que ele queria; e o
    /// ledger guarda os dois fatos, ambos verdadeiros no seu instante — que ele
    /// registrou o marco, e que depois o retirou.
    pub fn delete_milestone(&self, entity_id: &str) -> Result<LedgerEntry> {
        // O evento original é a fonte do título e do tipo: a retratação carrega o
        // mesmo `title_snapshot` para a Timeline poder dizer O QUE saiu, e não só
        // que "algo saiu".
        let history = self.ledger.for_entity(entity_id, MILESTONE_LIMIT)?;
        let original = history
            .iter()
            .find(|e| {
                e.entity_kind == LedgerEntityKind::CareerMilestone.as_str()
                    && e.event_type == EventType::Created.as_str()
            })
            .ok_or_else(|| NexusError::NotFound(format!("marco de carreira {entity_id}")))?;

        // Retratar duas vezes não é um erro (o segundo clique de uma UI lenta),
        // mas também não empilha um evento a mais.
        if let Some(previous) = history
            .iter()
            .find(|e| e.event_type == EventType::Deleted.as_str())
        {
            return Ok(previous.clone());
        }

        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            // O dia da RETRATAÇÃO é hoje, não o dia do marco: ela aconteceu
            // agora, e a Timeline conta os dois na sua data certa.
            day: self.clock.today_local(),
            entity_id: entity_id.to_string(),
            entity_kind: LedgerEntityKind::CareerMilestone,
            event_type: EventType::Deleted,
            payload: json!({ "retractedDay": original.day }),
            title_snapshot: original.title_snapshot.clone(),
        };
        let seq = self.ledger.append(&event)?;

        Ok(LedgerEntry {
            seq,
            ts: event.ts,
            day: event.day,
            entity_id: event.entity_id,
            entity_kind: event.entity_kind.as_str().to_string(),
            event_type: event.event_type.as_str().to_string(),
            payload: event.payload.to_string(),
            title_snapshot: event.title_snapshot,
        })
    }

    /* ===== Competências (M4.6) ===== */

    /// Cria uma competência (nível 1) numa Esfera, gravando o `created` no ledger.
    pub fn create_skill(
        &self,
        title: &str,
        area_id: Option<String>,
        category: Option<String>,
        max_level: Option<i64>,
    ) -> Result<Skill> {
        let title = validate_title(title)?;
        if let Some(a) = &area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a}")));
            }
        }
        if let Some(m) = max_level {
            if m < 1 {
                return Err(NexusError::Validation(
                    "o nível máximo tem que ser ao menos 1".into(),
                ));
            }
        }
        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::Skill),
            event_type: EventType::Created,
            payload: json!({ "category": category }),
            title_snapshot: title.clone(),
        };
        self.skills.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Skill,
                title,
                area_id,
                parent_id: None,
            },
            &NewSkill {
                title: String::new(), // o título já está no node; o satélite não o repete
                area_id: None,
                category,
                max_level,
            },
            &event,
        )
    }

    /// Sobe uma competência de nível — um FATO no ledger que vale XP (ADR-0037/0045).
    pub fn level_up_skill(&self, id: &str) -> Result<Skill> {
        // Lê o título atual para o snapshot honesto do evento (o node pode ter sido
        // renomeado desde a criação).
        let current = self.skills.get(id)?;
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Skill),
            event_type: EventType::SkillLevelUp,
            payload: json!({}),
            title_snapshot: current.title,
        };
        let mut skill = self.skills.level_up_with_event(id, now, &event)?;
        // O clique manual segue existindo (v1.1 e antes); o nível calculado vem
        // junto para a UI poder preferi-lo quando houver check-ins.
        self.fill_computed_level(&mut skill)?;
        Ok(skill)
    }

    /// As competências de uma Esfera (ou todas), já com o nível CALCULADO.
    pub fn skills(&self, area_id: Option<String>) -> Result<Vec<Skill>> {
        let mut skills = self.skills.list(area_id.as_deref())?;
        for s in &mut skills {
            self.fill_computed_level(s)?;
        }
        Ok(skills)
    }

    /* ===== O check-in mensal e o nível calculado (BÚSSOLA, fase E) ===== */

    /// Registra (ou CORRIGE) o check-in mensal de uma competência — um FATO no
    /// ledger. O nível 1-10 é derivado dele (ADR-0037), nunca escolhido.
    ///
    /// `month = None` é o mês corrente. Um mês FUTURO é recusado, pela mesma
    /// razão que o `counts_from` de um sub-desafio o recusa: não se informa o que
    /// ainda não aconteceu, e um mês adiantado envenenaria a média ponderada
    /// (ele viraria a referência, e todos os meses de verdade decairiam).
    pub fn record_skill_checkin(
        &self,
        skill_id: &str,
        month: Option<String>,
        studied: bool,
        applied: i64,
        stars: i64,
    ) -> Result<SkillCheckin> {
        // Pelo repositório de competências: um id de outro kind não ganha
        // check-in por um command chamado `record_skill_checkin`.
        let skill = self.skills.get(skill_id)?;

        let current_month = month_of_day(&self.clock.today_local())?;
        let month = match month {
            Some(m) => {
                // Valida o formato E normaliza (o parse recusa 'AAAA-M').
                let idx = parse_month(&m)?;
                if idx > parse_month(&current_month)? {
                    return Err(NexusError::Validation(
                        "não dá para fazer o check-in de um mês que ainda não aconteceu".into(),
                    ));
                }
                format_month(idx)
            }
            None => current_month,
        };

        if applied < 0 {
            return Err(NexusError::Validation(
                "o número de vezes que você aplicou não pode ser negativo".into(),
            ));
        }
        if !(1..=5).contains(&stars) {
            return Err(NexusError::Validation(
                "a auto-avaliação vai de 1 a 5 estrelas".into(),
            ));
        }

        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: skill_id.to_string(),
            entity_kind: LedgerEntityKind::SkillCheckin,
            event_type: EventType::SkillCheckin,
            payload: json!({
                "month": month,
                "studied": studied,
                "applied": applied,
                "stars": stars,
            }),
            title_snapshot: skill.title,
        };
        self.checkins.upsert_with_event(
            &NewSkillCheckin {
                skill_id: skill_id.to_string(),
                month,
                studied,
                applied,
                stars,
            },
            &event,
        )
    }

    /// Os check-ins de uma competência, do mês mais antigo ao mais recente.
    pub fn skill_checkins(&self, skill_id: &str) -> Result<Vec<SkillCheckin>> {
        self.skills.get(skill_id)?;
        self.checkins.list_for_skill(skill_id)
    }

    /// A régua de evolução CALCULADA: o nível mês a mês, do primeiro check-in ao
    /// mês corrente.
    ///
    /// Cada ponto é a fórmula rodada com aquele mês como referência, vendo só o
    /// que já havia acontecido até ali — por isso o gráfico mostra tanto a subida
    /// quanto o decaimento de quem parou de fazer check-in. Sem check-in nenhum,
    /// a lista volta VAZIA (não um nível 1 inventado).
    pub fn skill_level_history(&self, skill_id: &str) -> Result<Vec<SkillLevelPoint>> {
        self.skills.get(skill_id)?;
        let history = self.to_monthly(skill_id)?;
        let Some(first) = history.first() else {
            return Ok(Vec::new());
        };

        let from = parse_month(&first.month)?;
        // Até o mês corrente — nunca antes do último check-in (o relógio do
        // usuário pode estar atrás de um check-in retroagido para "este mês").
        let today_month = parse_month(&month_of_day(&self.clock.today_local())?)?;
        let last = history
            .iter()
            .map(|c| parse_month(&c.month))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .max()
            .unwrap_or(from);
        let to = today_month.max(last);

        let mut points = Vec::with_capacity((to - from + 1).max(0) as usize);
        for idx in from..=to {
            let month = format_month(idx);
            if let Some(c) = compute_level(&history, &month)? {
                points.push(SkillLevelPoint {
                    month,
                    level: c.level,
                    weighted_avg: c.weighted_avg,
                    sample_size: c.sample_size,
                });
            }
        }
        Ok(points)
    }

    /// O nível calculado de HOJE, com a fórmula por extenso — o que o "ⓘ como
    /// calculamos" da tela da competência mostra. `None` = ainda sem check-in.
    pub fn skill_computed_level(&self, skill_id: &str) -> Result<Option<ComputedLevel>> {
        self.skills.get(skill_id)?;
        let history = self.to_monthly(skill_id)?;
        compute_level(&history, &month_of_day(&self.clock.today_local())?)
    }

    /// Os check-ins do banco, no formato que o domínio puro entende.
    fn to_monthly(&self, skill_id: &str) -> Result<Vec<MonthlyCheckin>> {
        Ok(self
            .checkins
            .list_for_skill(skill_id)?
            .into_iter()
            .map(|c| MonthlyCheckin {
                month: c.month,
                studied: c.studied,
                applied: c.applied,
                stars: c.stars,
            })
            .collect())
    }

    /// Preenche `computed_level` a partir dos check-ins.
    ///
    /// Fica `None` quando não há check-in — e é aí que a UI cai no `level`
    /// gravado, que é tudo que uma competência anterior à v1.2 tem. Ver a nota
    /// do struct `Skill`.
    fn fill_computed_level(&self, skill: &mut Skill) -> Result<()> {
        let history = self.to_monthly(&skill.id)?;
        let month = month_of_day(&self.clock.today_local())?;
        skill.computed_level = compute_level(&history, &month)?.map(|c| c.level);
        Ok(())
    }

    /// A trilha de evolução de uma competência: (dia, nível). Um ponto só = nova.
    pub fn skill_track(&self, id: &str) -> Result<Vec<SkillPoint>> {
        Ok(self
            .skills
            .level_history(id)?
            .into_iter()
            .map(|(day, level)| SkillPoint { day, level })
            .collect())
    }

    /// EXCLUI uma competência (BÚSSOLA, fase B).
    ///
    /// Uma competência É um node, então aqui vale a regra inteira do ADR-0056 —
    /// ao contrário do marco de carreira, que não tem estado nenhum a apagar
    /// (ver `delete_milestone`). O evento `Deleted` entra na mesma transação do
    /// DELETE, e a trilha de níveis fica no ledger: o usuário tirou a competência
    /// da tela, não a história de ter subido de nível nela.
    pub fn delete_skill(&self, id: &str) -> Result<()> {
        // Pelo repositório de competências, para um id de outro kind não ser
        // apagado por um command chamado `delete_skill`.
        let skill = self.skills.get(id)?;
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Skill),
            event_type: EventType::Deleted,
            payload: json!({ "level": skill.level }),
            title_snapshot: skill.title.clone(),
        };
        self.nodes.delete_with_event(id, &event)
    }

    /// As competências "em evolução" do painel: as que subiram de nível nos últimos
    /// 90 dias. A janela é fixa — o painel quer "o que está esquentando agora".
    pub fn skills_evolving(&self, area_id: &str) -> Result<Vec<Skill>> {
        let today = parse_day(&self.clock.today_local())?;
        let since = format_day(today - chrono::Duration::days(90));
        let mut skills = self.skills.evolving_since(area_id, &since)?;
        for s in &mut skills {
            self.fill_computed_level(s)?;
        }
        Ok(skills)
    }
}
