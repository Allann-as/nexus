//! Casos de uso de Metas e sub-desafios.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Checkpoint, Clock, Goal, GoalRepository, IdGen, Milestone, NewCheckpoint,
    NewGoal, NewGoalDetails, NewMilestone, NewNode, NodeRepository,
};
use crate::domain::entities::{
    validate_title, Direction, GoalKind, Kind, MilestoneKind, ProgressSource, Status,
};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, NewLedgerEvent};
use crate::domain::ordering::order_between;
use crate::domain::projection::{self, Point, Projection};
use crate::domain::schedule::{format_day, parse_day};

/// Um sub-desafio com a fração dele já calculada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneView {
    #[serde(flatten)]
    pub milestone: Milestone,
    /// 0.0..=1.0. Num 'counter' é o contador dividido pelo alvo; num 'simple' é
    /// o checkbox, que só tem dois valores.
    pub ratio: f64,
}

/// A barra de uma meta, com a conta que a produziu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    /// 0.0..=1.0
    pub ratio: f64,
    /// De onde a barra veio — `goal_details.progress_source` decide.
    pub source: ProgressSource,
    /// A conta, por extenso. Constituição §2: todo insight se explica.
    pub formula: String,
    /// Quantos degraus já foram vencidos. Só numa meta 'staged' — `None` nas
    /// outras duas, porque "0 de 0 degraus" não é uma leitura honesta de uma
    /// meta que não é uma escada.
    pub stage_current: Option<i64>,
    /// Quantos degraus a escada tem ao todo. Só numa 'staged'.
    pub stage_total: Option<i64>,
    /// O nome do degrau atual: o título do ÚLTIMO degrau concluído na ordem da
    /// escada. `None` enquanto nenhum foi vencido — a escada existe, o usuário
    /// ainda está no chão.
    pub stage_label: Option<String>,
}

impl GoalProgress {
    /// O construtor das barras que não são uma escada. Os três campos de degrau
    /// nascem `None` num lugar só, para nenhuma fonte nova esquecer deles.
    fn plain(ratio: f64, source: ProgressSource, formula: String) -> Self {
        Self {
            ratio,
            source,
            formula,
            stage_current: None,
            stage_total: None,
            stage_label: None,
        }
    }
}

/// Tudo que a tela de uma meta precisa, numa chamada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalWithProgress {
    #[serde(flatten)]
    pub goal: Goal,
    pub progress: GoalProgress,
    /// O último valor medido. `None` quando ainda não houve medição — não é o
    /// `start_value`: "nunca mediu" e "mediu e deu o valor inicial" são fatos
    /// diferentes.
    pub current_value: Option<f64>,
    pub checkpoints: Vec<Checkpoint>,
    pub milestones: Vec<MilestoneView>,
    /// `None` com menos de 2 checkpoints. Ver `domain::projection`.
    pub projection: Option<Projection>,
}

pub struct GoalService {
    pub goals: Arc<dyn GoalRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl GoalService {
    /// Cria uma meta, validando POR TIPO (BÚSSOLA, fase C).
    ///
    /// Os três tipos não são variações de forma: eles pedem coisas diferentes.
    /// Uma `quantitative` sem alvo não tem barra; uma `binary` COM alvo tem uma
    /// barra que ninguém alimenta. As duas são recusadas na porta, com a
    /// mensagem dizendo qual das duas é — o CHECK da 0016 devolveria só
    /// "constraint failed", que não ensina nada a ninguém.
    pub fn create(&self, new: &NewGoal) -> Result<Goal> {
        let title = validate_title(&new.title)?;
        let d = &new.details;

        // A validação devolve os detalhes JÁ NORMALIZADOS: a direção deduzida
        // dos números na quantitativa, a fonte de progresso forçada nas outras.
        // Assim o repositório grava o que o SERVIÇO decidiu, não o que a UI
        // mandou — a mesma regra do `counts_from` de um sub-desafio.
        let details = match d.goal_kind {
            GoalKind::Quantitative => normalize_quantitative(d)?,
            GoalKind::Binary | GoalKind::Staged => normalize_without_metric(d)?,
        };

        if let Some(aid) = &new.area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }

        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Goal.into(),
            event_type: EventType::Created,
            payload: json!({
                "goalKind": details.goal_kind.as_str(),
                "metric": details.metric_name,
                "from": details.start_value,
                "to": details.target_value,
                "unit": details.unit,
                "progressSource": details.progress_source.as_str(),
            }),
            title_snapshot: title.clone(),
        };

        self.goals.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Goal,
                title,
                area_id: new.area_id.clone(),
                parent_id: None,
            },
            &details,
            &event,
        )
    }

    pub fn list(&self, area_id: Option<&str>) -> Result<Vec<Goal>> {
        self.goals.list(area_id)
    }

    /// Registra uma medição da métrica.
    ///
    /// `noted_at` aceita o passado — "a pesagem de segunda, que esqueci de
    /// anotar" — exatamente como o `tick` de um hábito aceita um dia explícito.
    /// E recusa o futuro pela mesma razão: uma medição de amanhã não é um dado,
    /// é um erro, e envenenaria a projeção em silêncio. Ela é o x da reta.
    pub fn add_checkpoint(
        &self,
        goal_id: &str,
        value: f64,
        note: Option<String>,
        noted_at: Option<i64>,
    ) -> Result<Checkpoint> {
        let goal = self.goals.get(goal_id)?;
        // Uma medição é um ponto da MÉTRICA. Uma conquista e uma escada não têm
        // métrica (0016): aceitar um número aqui criaria uma série que nenhuma
        // barra lê e que a projeção não pode usar.
        let unit = goal.unit.as_deref().ok_or_else(|| {
            NexusError::Validation(
                "esta meta não mede uma métrica: o progresso dela vem dos degraus".into(),
            )
        })?;
        if !value.is_finite() {
            return Err(NexusError::Validation(format!(
                "medição inválida: {value} {unit}"
            )));
        }

        let now = self.clock.now_ms();
        let noted_at = match noted_at {
            None => now,
            Some(at) => {
                if at > now {
                    return Err(NexusError::Validation(
                        "não dá para registrar uma medição no futuro".into(),
                    ));
                }
                at
            }
        };
        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            // O ledger registra QUANDO A MEDIÇÃO ACONTECEU, não quando ela foi
            // digitada: a Timeline conta a história do usuário, e a pesagem de
            // segunda pertence à segunda mesmo que ele a tenha anotado na
            // quarta. É a mesma escolha do tick de hábito com dia explícito.
            ts: noted_at,
            day: format_day(day_of(noted_at).ok_or_else(|| {
                NexusError::Validation(format!("instante fora do calendário: {noted_at}"))
            })?),
            entity_id: goal_id.to_string(),
            entity_kind: Kind::Goal.into(),
            // O vocabulário do ledger tem um evento só para isto: a timeline
            // filtra por ele para desenhar a série da meta sem JOIN nenhum.
            event_type: EventType::GoalCheckpoint,
            payload: json!({ "value": value, "unit": unit, "metric": goal.metric_name }),
            title_snapshot: goal.title.clone(),
        };

        self.goals.add_checkpoint_with_event(
            &id,
            &NewCheckpoint {
                goal_id: goal_id.to_string(),
                value,
                noted_at,
                note,
            },
            &event,
        )
    }

    /// Acrescenta um sub-desafio à meta.
    pub fn add_milestone(&self, m: &NewMilestone) -> Result<Milestone> {
        let title = validate_title(&m.title)?;

        let goal = self.nodes.get(&m.goal_id)?;
        if goal.kind != Kind::Goal {
            return Err(NexusError::Validation(
                "um sub-desafio só pende de uma meta".into(),
            ));
        }
        if !m.weight.is_finite() || m.weight <= 0.0 {
            return Err(NexusError::Validation(format!(
                "peso inválido: {} (precisa ser maior que zero)",
                m.weight
            )));
        }

        match m.kind {
            // Um 'counter' sem hábito seria um número que o usuário teria que
            // atualizar à mão — exatamente o trabalho que os ticks já fazem, e
            // exatamente o que o §4 da 0007 recusa.
            MilestoneKind::Counter => {
                let habit_id = m.habit_id.as_deref().ok_or_else(|| {
                    NexusError::Validation(
                        "um sub-desafio contado precisa do hábito que o alimenta".into(),
                    )
                })?;
                let habit = self.nodes.get(habit_id)?;
                if habit.kind != Kind::Habit {
                    return Err(NexusError::Validation(format!(
                        "'{}' não é um hábito",
                        habit.title
                    )));
                }
                match m.target_count {
                    Some(t) if t > 0 => {}
                    _ => {
                        return Err(NexusError::Validation(
                            "um sub-desafio contado precisa de um alvo maior que zero".into(),
                        ))
                    }
                }
            }
            MilestoneKind::Simple => {
                if m.habit_id.is_some() || m.target_count.is_some() {
                    return Err(NexusError::Validation(
                        "um sub-desafio simples é só um checkbox: sem hábito e sem alvo".into(),
                    ));
                }
            }
        }

        // O piso do contador (0009). Sem ele, "30 dias de academia" criado hoje
        // sobre um hábito com 120 dias de histórico nasce completo — um desafio
        // que o usuário ganha sem fazer.
        //
        // O passado é aceito ("conte desde o início do mês"); o futuro, não —
        // um contador que só começa a contar semana que vem exibiria 0/30 sem
        // dizer por quê, e ninguém saberia se está quebrado.
        let counts_from = match (m.kind, m.counts_from.as_deref()) {
            (MilestoneKind::Simple, Some(_)) => {
                return Err(NexusError::Validation(
                    "um sub-desafio simples não conta nada: ele não tem de quando contar".into(),
                ))
            }
            (MilestoneKind::Simple, None) => None,
            (MilestoneKind::Counter, None) => Some(self.clock.today_local()),
            (MilestoneKind::Counter, Some(day)) => {
                let parsed = parse_day(day)?;
                let today = parse_day(&self.clock.today_local())?;
                if parsed > today {
                    return Err(NexusError::Validation(
                        "um contador não pode começar a contar no futuro".into(),
                    ));
                }
                Some(format_day(parsed))
            }
        };

        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Milestone.into(),
            event_type: EventType::Created,
            payload: json!({
                "goal": m.goal_id,
                "kind": m.kind.as_str(),
                "habit": m.habit_id,
                "targetCount": m.target_count,
                "weight": m.weight,
                "countsFrom": counts_from,
            }),
            title_snapshot: title.clone(),
        };

        self.goals.add_milestone_with_event(
            &id,
            &NewNode {
                kind: Kind::Milestone,
                title,
                area_id: goal.area_id.clone(),
                parent_id: Some(m.goal_id.clone()),
            },
            // `counts_from` resolvido: o repositório grava o que o SERVIÇO
            // decidiu (hoje, por padrão), não o que a UI mandou.
            &NewMilestone {
                counts_from,
                ..m.clone()
            },
            &event,
        )
    }

    /// Marca ou desmarca o checkbox de um sub-desafio.
    ///
    /// Recusa os 'counter': o contador deles se preenche pelos ticks do hábito
    /// (§4 da 0007). Deixar o checkbox mandar criaria dois números discordando
    /// sobre o mesmo sub-desafio, e o usuário não teria como saber qual é o
    /// verdadeiro.
    pub fn set_milestone_done(&self, id: &str, done: bool) -> Result<Milestone> {
        let milestone = self.goals.get_milestone(id)?;
        if milestone.kind == MilestoneKind::Counter {
            return Err(NexusError::Validation(
                "este sub-desafio se preenche pelos ticks do hábito ligado a ele".into(),
            ));
        }

        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: Kind::Milestone.into(),
            // 'completed' é o que o BI conta como conclusão; desmarcar é a
            // correção de um clique, não uma conclusão negativa.
            event_type: if done {
                EventType::Completed
            } else {
                EventType::StatusChanged
            },
            payload: json!({
                "goal": milestone.goal_id,
                "done": done,
                "status": if done { Status::Done } else { Status::Active }.as_str(),
            }),
            title_snapshot: milestone.title.clone(),
        };

        self.goals.set_milestone_done_with_event(id, done, &event)
    }

    /// Troca a régua da meta: a métrica ou os sub-desafios.
    ///
    /// As duas medidas discordam o tempo todo — "perder 10 kg" pode estar em 40%
    /// pelo peso e 75% pelos sub-desafios —, e adivinhar qual mostrar seria o app
    /// decidindo por um número que é do usuário (§5 da 0007).
    ///
    /// Sem evento de ledger, igual ao `set_schedule` dos hábitos: trocar a régua
    /// é configuração de como o fato é medido, não um fato da vida do usuário.
    /// Ver ADR-0023.
    pub fn set_progress_source(&self, id: &str, source: ProgressSource) -> Result<Goal> {
        let goal = self.goals.get(id)?;
        // Só a meta quantitativa tem as DUAS réguas para escolher. Numa conquista
        // ou numa escada 'metric' dividiria por um alvo que não existe — e o
        // CHECK da 0016 recusaria a linha de qualquer jeito.
        if !goal.goal_kind.is_quantitative() && source == ProgressSource::Metric {
            return Err(NexusError::Validation(
                "esta meta não tem métrica: o progresso dela só pode vir dos degraus".into(),
            ));
        }
        if goal.progress_source == source {
            // Nada a fazer não é um erro: o toggle da UI pode chegar aqui duas
            // vezes por um clique duplo, e a segunda não é uma falha.
            return Ok(goal);
        }
        self.goals.set_progress_source(id, source)
    }

    /// Move um sub-desafio para a posição `to_index` na árvore da meta.
    ///
    /// A conta é a mesma do arrasto de tarefas, e é a MESMA função: a nova ordem
    /// é a média dos vizinhos, e mover é um update de uma linha. Ver
    /// `domain::ordering`.
    ///
    /// Sem evento de ledger: a ordem da árvore é a arrumação da mesa do usuário,
    /// não a história dele — exatamente como reordenar tarefas num projeto (M2).
    pub fn move_milestone(&self, id: &str, to_index: usize) -> Result<()> {
        let milestone = self.goals.get_milestone(id)?;
        let goal_id = &milestone.goal_id;

        let (before, after) = self.goals.milestone_neighbours(goal_id, to_index)?;

        let new_order = match order_between(before, after) {
            Some(order) => order,
            None => {
                // Saturou: reespaça e refaz a conta com folga.
                self.goals.renumber_milestones(goal_id)?;
                let (a, b) = self.goals.milestone_neighbours(goal_id, to_index)?;
                order_between(a, b).unwrap_or(0.0)
            }
        };

        self.goals.reorder_milestone(id, new_order)
    }

    /// A meta com a barra, os sub-desafios e a projeção — numa chamada.
    pub fn get_with_progress(&self, id: &str) -> Result<GoalWithProgress> {
        let goal = self.goals.get(id)?;
        let checkpoints = self.goals.checkpoints(id)?;
        let milestones: Vec<MilestoneView> = self
            .goals
            .list_milestones(id)?
            .into_iter()
            .map(|m| MilestoneView {
                ratio: milestone_ratio(&m),
                milestone: m,
            })
            .collect();

        let current_value = checkpoints.last().map(|c| c.value);

        // A projeção é uma reta ATÉ UM ALVO NUMÉRICO. Numa meta 'binary' ou
        // 'staged' não existe alvo — e uma data de chegada inventada sobre um
        // alvo que não há seria pior que não ter data nenhuma (§2 da
        // constituição: o NEXUS não chuta). Ela segue existindo numa meta
        // quantitativa que mede pelos sub-desafios: o peso continua sendo
        // medido, e saber quando ele chega lá não deixa de ser verdade porque a
        // barra mostra outra coisa.
        let projection = match (goal.target_value, goal.unit.as_deref()) {
            (Some(target), Some(unit)) => {
                let points: Vec<Point> = checkpoints
                    .iter()
                    .filter_map(|c| {
                        day_of(c.noted_at).map(|day| Point {
                            day,
                            value: c.value,
                        })
                    })
                    .collect();
                projection::project(&points, target, unit)
            }
            _ => None,
        };

        // O TIPO manda antes da fonte: uma escada mede pelos degraus vencidos,
        // e uma conquista sem degrau nenhum mede pelo próprio ato de concluir.
        // A fonte só decide o que ela sempre decidiu — na meta quantitativa.
        let progress = match goal.goal_kind {
            GoalKind::Staged => staged_progress(&milestones),
            GoalKind::Binary => binary_progress(&goal, &milestones),
            GoalKind::Quantitative => match goal.progress_source {
                ProgressSource::Metric => metric_progress(&goal, current_value),
                ProgressSource::Milestones => milestones_progress(&milestones),
            },
        };

        Ok(GoalWithProgress {
            goal,
            progress,
            current_value,
            checkpoints,
            milestones,
            projection,
        })
    }
}

/// A meta de sempre: os cinco campos da métrica são obrigatórios, e a direção
/// sai dos NÚMEROS.
///
/// Função livre e não método: ela não olha para repositório nenhum — é a regra
/// da meta quantitativa, pura e testável sozinha, como `milestone_ratio` e as
/// funções de barra logo abaixo.
fn normalize_quantitative(d: &NewGoalDetails) -> Result<NewGoalDetails> {
    let metric_name = d
        .metric_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            NexusError::Validation("uma meta quantitativa precisa dizer o que mede".into())
        })?
        .to_string();
    let unit = d
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| NexusError::Validation("uma meta quantitativa precisa de unidade".into()))?
        .to_string();
    let start_value = d.start_value.ok_or_else(|| {
        NexusError::Validation("uma meta quantitativa precisa de um ponto de partida".into())
    })?;
    let target_value = d
        .target_value
        .ok_or_else(|| NexusError::Validation("uma meta quantitativa precisa de um alvo".into()))?;

    if !start_value.is_finite() || !target_value.is_finite() {
        return Err(NexusError::Validation(
            "os valores de uma meta precisam ser números".into(),
        ));
    }
    // Sem isto, a fração de progresso dividiria por zero — e "cheguei a 0%
    // do caminho de 80 kg até 80 kg" não é uma pergunta com resposta.
    if (target_value - start_value).abs() < f64::EPSILON {
        return Err(NexusError::Validation(
            "o alvo de uma meta não pode ser igual ao ponto de partida".into(),
        ));
    }

    // A direção sai dos NÚMEROS — é a mesma conta que o formulário fazia
    // antes de mandar o campo, agora feita de um lado só. Se a UI ainda
    // mandar uma direção, ela tem que concordar: uma meta 'increase' de 90
    // para 80 mediria progresso ao contrário para sempre, e o usuário só
    // descobriria vendo a barra andar para trás.
    let implied = if target_value > start_value {
        Direction::Increase
    } else {
        Direction::Decrease
    };
    if let Some(declared) = d.direction {
        if declared != implied {
            return Err(NexusError::Validation(format!(
                "a direção '{}' contradiz ir de {start_value} para {target_value}",
                declared.as_str(),
            )));
        }
    }

    Ok(NewGoalDetails {
        goal_kind: GoalKind::Quantitative,
        metric_name: Some(metric_name),
        start_value: Some(start_value),
        target_value: Some(target_value),
        unit: Some(unit),
        direction: Some(implied),
        deadline: d.deadline,
        progress_source: d.progress_source,
    })
}

/// A fração de um sub-desafio.
fn milestone_ratio(m: &Milestone) -> f64 {
    match m.kind {
        // O checkbox só tem dois valores. Um sub-desafio "meio feito" não
        // existe: se ele tem meio, ele é um 'counter'.
        MilestoneKind::Simple => f64::from(u8::from(m.status == Status::Done.as_str())),
        MilestoneKind::Counter => {
            let (Some(count), Some(target)) = (m.current_count, m.target_count) else {
                return 0.0;
            };
            if target <= 0 {
                return 0.0;
            }
            // Teto em 1: 35 ticks de um alvo de 30 são 100%, não 117% — e um
            // ratio acima de 1 empurraria a média da meta acima de 100%.
            (count as f64 / target as f64).clamp(0.0, 1.0)
        }
    }
}

/// A barra pela métrica: quanto do caminho de `start` até `target` já andou.
fn metric_progress(goal: &Goal, current: Option<f64>) -> GoalProgress {
    // Os cinco campos são NULL fora da meta quantitativa (0016). Chegar aqui sem
    // eles quer dizer uma linha escrita por fora do serviço; a barra diz isso em
    // vez de devolver NaN.
    let (Some(start), Some(target), Some(metric), Some(unit)) = (
        goal.start_value,
        goal.target_value,
        goal.metric_name.as_deref(),
        goal.unit.as_deref(),
    ) else {
        return GoalProgress::plain(
            0.0,
            ProgressSource::Metric,
            "esta meta não tem métrica: não há caminho a medir".into(),
        );
    };

    let span = target - start;
    let Some(current) = current else {
        return GoalProgress::plain(
            0.0,
            ProgressSource::Metric,
            format!(
                "nenhuma medição de {metric} registrada ainda — a barra parte de {start} {unit}"
            ),
        );
    };
    if span.abs() < f64::EPSILON {
        // O `create` barra isto na porta; uma meta antiga pode ter escapado, e
        // dividir por zero aqui devolveria NaN direto para a UI.
        return GoalProgress::plain(
            0.0,
            ProgressSource::Metric,
            "o alvo é igual ao ponto de partida: não há caminho a medir".into(),
        );
    }

    // O sinal se cancela: perder peso (span negativo, progresso negativo) e
    // ganhar músculo (os dois positivos) dão a mesma fração. Por isso a conta
    // não precisa olhar a `direction`.
    let ratio = ((current - start) / span).clamp(0.0, 1.0);

    GoalProgress::plain(
        ratio,
        ProgressSource::Metric,
        format!(
            "({current} − {start}) ÷ ({target} − {start}) = {}% de {metric} {start}→{target} {unit}",
            pct(ratio),
        ),
    )
}

/// A barra de uma CONQUISTA ('binary').
///
/// Uma conquista é uma coisa só: aconteceu ou não. Mas o usuário pode quebrá-la
/// em degraus ("atualizar o currículo", "fazer 5 entrevistas") — e aí a barra
/// mostra o caminho, não só a porta. Duas leituras, e a que vale é a que existe:
///
///   * COM sub-desafios: a mesma média ponderada de sempre. Ter picado a
///     conquista em partes é ter dito como medi-la.
///   * SEM nenhum: só o `nodes.status`. 0% enquanto está aberta, 100% quando é
///     concluída — sem meio-termo, porque "consegui meio emprego" não existe.
fn binary_progress(goal: &Goal, milestones: &[MilestoneView]) -> GoalProgress {
    if !milestones.is_empty() {
        return milestones_progress(milestones);
    }

    let done = goal.status == Status::Done.as_str();
    GoalProgress::plain(
        f64::from(u8::from(done)),
        ProgressSource::Milestones,
        if done {
            "esta conquista está concluída: 100%".into()
        } else {
            "esta conquista ainda não tem degraus — ela vale 0% até ser concluída".into()
        },
    )
}

/// A barra de uma ESCADA ('staged'): degraus vencidos sobre o total.
///
/// Aqui o PESO não entra, de propósito. Numa escada os degraus são uma ORDEM —
/// "Básico, Intermediário, Avançado, Fluente" —, e o que o usuário quer ler é
/// "estou no 2 de 4". Ponderar faria o degrau 3 valer mais que o 2 e a leitura
/// deixaria de bater com a contagem que ele vê na tela.
///
/// O degrau ATUAL é o último concluído NA ORDEM DA ESCADA (`sort_order`, que é
/// como o repositório já entrega a lista) — não o mais recente no relógio.
fn staged_progress(milestones: &[MilestoneView]) -> GoalProgress {
    let total = milestones.len() as i64;
    if total == 0 {
        return GoalProgress {
            ratio: 0.0,
            source: ProgressSource::Milestones,
            formula: "esta escada ainda não tem degraus".into(),
            stage_current: None,
            stage_total: None,
            stage_label: None,
        };
    }

    let is_done = |m: &&MilestoneView| m.milestone.status == Status::Done.as_str();
    let current = milestones.iter().filter(is_done).count() as i64;
    let label = milestones
        .iter()
        .rfind(is_done)
        .map(|m| m.milestone.title.clone());

    let ratio = (current as f64 / total as f64).clamp(0.0, 1.0);
    let named = match &label {
        Some(t) => format!(" ({t})"),
        None => String::new(),
    };

    GoalProgress {
        ratio,
        source: ProgressSource::Milestones,
        formula: format!("degrau {current} de {total}{named} = {}%", pct(ratio)),
        stage_current: Some(current),
        stage_total: Some(total),
        stage_label: label,
    }
}

/// Uma meta SEM métrica ('binary'/'staged'): os cinco campos têm que estar
/// vazios, e a fonte de progresso é forçada.
///
/// Forçar em vez de recusar porque a fonte não é uma escolha aqui: uma meta sem
/// alvo não tem o que dividir, e o CHECK da 0016 recusaria a linha. Mandar
/// 'metric' num formulário de conquista é o padrão do DTO vazando, não uma
/// intenção do usuário — corrigir é mais honesto que devolver um erro sobre um
/// campo que a tela nem mostrou.
fn normalize_without_metric(d: &NewGoalDetails) -> Result<NewGoalDetails> {
    let informed = d.metric_name.is_some()
        || d.start_value.is_some()
        || d.target_value.is_some()
        || d.unit.is_some()
        || d.direction.is_some();
    if informed {
        return Err(NexusError::Validation(
            "uma meta de conquista não tem métrica: sem o que mede, sem valores e sem unidade"
                .into(),
        ));
    }

    Ok(NewGoalDetails {
        goal_kind: d.goal_kind,
        metric_name: None,
        start_value: None,
        target_value: None,
        unit: None,
        direction: None,
        deadline: d.deadline,
        progress_source: ProgressSource::Milestones,
    })
}

/// A barra pelos sub-desafios: média PONDERADA.
///
/// Ponderada e não simples porque o usuário pensa em "este vale o dobro" — e
/// numa meta com 1 sub-desafio grande e 4 pequenos, a média simples faria os
/// pequenos valerem 80% do resultado.
fn milestones_progress(milestones: &[MilestoneView]) -> GoalProgress {
    let total: f64 = milestones.iter().map(|m| m.milestone.weight).sum();
    if milestones.is_empty() || total <= 0.0 {
        return GoalProgress::plain(
            0.0,
            ProgressSource::Milestones,
            "esta meta mede progresso por sub-desafios e ainda não tem nenhum".into(),
        );
    }

    let earned: f64 = milestones
        .iter()
        .map(|m| m.milestone.weight * m.ratio)
        .sum();
    let ratio = (earned / total).clamp(0.0, 1.0);

    let parts: Vec<String> = milestones
        .iter()
        .map(|m| format!("{}×{}%", m.milestone.weight, pct(m.ratio)))
        .collect();

    GoalProgress::plain(
        ratio,
        ProgressSource::Milestones,
        format!("({}) ÷ {} = {}%", parts.join(" + "), total, pct(ratio)),
    )
}

fn pct(ratio: f64) -> i64 {
    (ratio * 100.0).round() as i64
}

/// O dia local de um instante — a base de tempo da projeção.
///
/// A reta é sobre DIAS, não sobre milissegundos: duas pesagens na mesma terça
/// são o mesmo x. Ver `domain::projection`.
fn day_of(ms: i64) -> Option<chrono::NaiveDate> {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uma mutação que estraga um campo dos detalhes — a tabela dos testes de
    /// validação varre uma destas por campo.
    type Poison = fn(&mut NewGoalDetails);

    fn goal(source: ProgressSource) -> Goal {
        Goal {
            id: "g1".into(),
            title: "Perder 10 kg".into(),
            area_id: None,
            status: "active".into(),
            goal_kind: GoalKind::Quantitative,
            metric_name: Some("Peso".into()),
            start_value: Some(90.0),
            target_value: Some(80.0),
            unit: Some("kg".into()),
            direction: Some(Direction::Decrease),
            deadline: None,
            progress_source: source,
        }
    }

    /// Uma meta SEM métrica — os cinco campos em NULL, como a 0016 exige.
    fn metricless(kind: GoalKind, status: &str) -> Goal {
        Goal {
            id: "g2".into(),
            title: "Conseguir um emprego".into(),
            area_id: None,
            status: status.into(),
            goal_kind: kind,
            metric_name: None,
            start_value: None,
            target_value: None,
            unit: None,
            direction: None,
            deadline: None,
            progress_source: ProgressSource::Milestones,
        }
    }

    fn details(kind: GoalKind) -> NewGoalDetails {
        NewGoalDetails {
            goal_kind: kind,
            metric_name: None,
            start_value: None,
            target_value: None,
            unit: None,
            direction: None,
            deadline: None,
            progress_source: ProgressSource::Metric,
        }
    }

    /// Um degrau da escada, com título e posição — a escada É a lista ordenada.
    fn stage(title: &str, status: &str, order: f64) -> MilestoneView {
        let m = Milestone {
            id: title.into(),
            goal_id: "g2".into(),
            title: title.into(),
            status: status.into(),
            kind: MilestoneKind::Simple,
            habit_id: None,
            target_count: None,
            weight: 1.0,
            sort_order: order,
            counts_from: None,
            current_count: None,
        };
        MilestoneView {
            ratio: milestone_ratio(&m),
            milestone: m,
        }
    }

    fn simple(status: &str, weight: f64) -> MilestoneView {
        let m = Milestone {
            id: "m".into(),
            goal_id: "g1".into(),
            title: "Sub".into(),
            status: status.into(),
            kind: MilestoneKind::Simple,
            habit_id: None,
            target_count: None,
            weight,
            sort_order: 0.0,
            counts_from: None,
            current_count: None,
        };
        MilestoneView {
            ratio: milestone_ratio(&m),
            milestone: m,
        }
    }

    fn counter(current: Option<i64>, target: Option<i64>, weight: f64) -> MilestoneView {
        let m = Milestone {
            id: "m".into(),
            goal_id: "g1".into(),
            title: "30 dias sem açúcar".into(),
            status: "active".into(),
            kind: MilestoneKind::Counter,
            habit_id: Some("h1".into()),
            target_count: target,
            weight,
            sort_order: 0.0,
            counts_from: Some("2026-07-01".into()),
            current_count: current,
        };
        MilestoneView {
            ratio: milestone_ratio(&m),
            milestone: m,
        }
    }

    #[test]
    fn a_decreasing_metric_still_measures_progress_forwards() {
        // 90 -> 80, medindo 85: metade do caminho. Sem o cancelamento de sinal,
        // uma meta de emagrecer mediria -50% e a barra andaria para trás.
        let p = metric_progress(&goal(ProgressSource::Metric), Some(85.0));
        assert!((p.ratio - 0.5).abs() < 1e-9, "{}", p.ratio);
    }

    #[test]
    fn an_increasing_metric_uses_the_same_maths() {
        let mut g = goal(ProgressSource::Metric);
        g.start_value = Some(0.0);
        g.target_value = Some(100.0);
        g.direction = Some(Direction::Increase);
        let p = metric_progress(&g, Some(25.0));
        assert!((p.ratio - 0.25).abs() < 1e-9);
    }

    #[test]
    fn overshooting_the_target_is_one_hundred_percent_not_more() {
        // Pesar 75 numa meta de 80 é a meta batida, não 150% dela — e um ratio
        // acima de 1 quebraria toda barra que multiplica por 100.
        let p = metric_progress(&goal(ProgressSource::Metric), Some(75.0));
        assert_eq!(p.ratio, 1.0);
    }

    #[test]
    fn going_backwards_floors_at_zero() {
        // Engordou para 95 numa meta de emagrecer: 0%, não -50%.
        let p = metric_progress(&goal(ProgressSource::Metric), Some(95.0));
        assert_eq!(p.ratio, 0.0);
    }

    #[test]
    fn a_goal_with_no_checkpoint_yet_says_so_instead_of_assuming() {
        // "Nunca mediu" não é "mediu e deu o valor inicial". A fórmula precisa
        // dizer qual dos dois é.
        let p = metric_progress(&goal(ProgressSource::Metric), None);
        assert_eq!(p.ratio, 0.0);
        assert!(p.formula.contains("nenhuma medição"));
    }

    #[test]
    fn a_zero_span_goal_does_not_divide_by_zero() {
        // O `create` barra isto na porta, mas uma meta gravada antes desta
        // validação existir devolveria NaN direto para a UI.
        let mut g = goal(ProgressSource::Metric);
        g.target_value = g.start_value;
        // Os dois seguem `Some`: o que mudou é que o vão virou zero.
        let p = metric_progress(&g, Some(90.0));
        assert_eq!(p.ratio, 0.0);
        assert!(p.ratio.is_finite());
    }

    #[test]
    fn the_weighted_average_lets_one_milestone_count_double() {
        // Um sub-desafio de peso 3 feito e um de peso 1 aberto: 75%, não 50%.
        // A média simples é justamente o que o campo `weight` existe para não
        // ser.
        let p = milestones_progress(&[simple("done", 3.0), simple("active", 1.0)]);
        assert!((p.ratio - 0.75).abs() < 1e-9, "{}", p.ratio);
    }

    #[test]
    fn a_milestone_goal_with_no_milestones_is_zero_and_says_why() {
        // Dividir por um total de pesos vazio seria NaN.
        let p = milestones_progress(&[]);
        assert_eq!(p.ratio, 0.0);
        assert!(p.formula.contains("ainda não tem nenhum"));
    }

    #[test]
    fn a_counter_fills_itself_and_never_passes_one_hundred_percent() {
        assert_eq!(counter(Some(15), Some(30), 1.0).ratio, 0.5);
        assert_eq!(
            counter(Some(35), Some(30), 1.0).ratio,
            1.0,
            "35 de 30 são 100%, não 117%"
        );
        assert_eq!(counter(Some(0), Some(30), 1.0).ratio, 0.0);
    }

    #[test]
    fn a_counter_with_a_broken_target_is_zero_not_a_division_by_zero() {
        // O `add_milestone` exige alvo > 0; o schema não. Uma linha escrita por
        // fora não pode devolver infinito para a barra.
        assert_eq!(counter(Some(5), Some(0), 1.0).ratio, 0.0);
        assert_eq!(counter(Some(5), None, 1.0).ratio, 0.0);
        assert_eq!(counter(None, Some(30), 1.0).ratio, 0.0);
    }

    #[test]
    fn a_simple_milestone_is_binary() {
        // "Meio feito" não existe num checkbox. Se ele tem meio, ele é um
        // 'counter'.
        assert_eq!(simple("done", 1.0).ratio, 1.0);
        assert_eq!(simple("active", 1.0).ratio, 0.0);
        assert_eq!(simple("dropped", 1.0).ratio, 0.0);
    }

    #[test]
    fn the_two_sources_disagree_and_that_is_the_whole_point() {
        // 30% do peso perdido com 4 dos 5 sub-desafios feitos. É por isso que a
        // meta escolhe a fonte em vez de o app adivinhar (§5 da 0007).
        let by_metric = metric_progress(&goal(ProgressSource::Metric), Some(87.0));
        let by_milestones = milestones_progress(&[
            simple("done", 1.0),
            simple("done", 1.0),
            simple("done", 1.0),
            simple("done", 1.0),
            simple("active", 1.0),
        ]);
        assert!((by_metric.ratio - 0.3).abs() < 1e-9);
        assert!((by_milestones.ratio - 0.8).abs() < 1e-9);
    }

    /* ===== Metas com TIPO (BÚSSOLA, fase C) ===== */

    #[test]
    fn an_achievement_with_no_metric_is_accepted() {
        // O caso que motivou a 0016: "conseguir um emprego" não tem métrica,
        // ponto de partida, alvo, unidade nem direção. Antes, o formulário nem
        // conseguia oferecer o tipo — o banco recusaria a linha.
        let d = normalize_without_metric(&details(GoalKind::Binary)).unwrap();
        assert_eq!(d.goal_kind, GoalKind::Binary);
        assert!(d.metric_name.is_none());
        assert!(d.start_value.is_none());
        assert!(d.target_value.is_none());
        assert!(d.unit.is_none());
        assert!(d.direction.is_none());
    }

    #[test]
    fn an_achievement_is_forced_onto_the_milestones_ruler() {
        // O DTO chega com 'metric' por padrão. Numa meta sem alvo, 'metric'
        // dividiria por um número que não existe — e o CHECK da 0016 recusaria
        // a linha. Forçar é mais honesto que devolver erro sobre um campo que a
        // tela da conquista nem mostra.
        for kind in [GoalKind::Binary, GoalKind::Staged] {
            let mut input = details(kind);
            input.progress_source = ProgressSource::Metric;
            let d = normalize_without_metric(&input).unwrap();
            assert_eq!(d.progress_source, ProgressSource::Milestones);
        }
    }

    #[test]
    fn an_achievement_that_smuggles_a_metric_is_rejected() {
        // Uma 'binary' com alvo teria uma barra que ninguém alimenta. Cada um
        // dos cinco campos, sozinho, basta para recusar.
        let cases: [(&str, Poison); 5] = [
            ("metricName", |d| d.metric_name = Some("Peso".into())),
            ("startValue", |d| d.start_value = Some(90.0)),
            ("targetValue", |d| d.target_value = Some(80.0)),
            ("unit", |d| d.unit = Some("kg".into())),
            ("direction", |d| d.direction = Some(Direction::Decrease)),
        ];
        for (field, poison) in cases {
            let mut input = details(GoalKind::Binary);
            poison(&mut input);
            let err = normalize_without_metric(&input).unwrap_err();
            assert!(
                matches!(err, NexusError::Validation(ref m) if m.contains("não tem métrica")),
                "{field} passou: {err:?}"
            );
        }
    }

    #[test]
    fn an_achievement_with_no_milestones_reads_the_status() {
        // Sem degraus não há o que ponderar: a conquista vale o próprio ato de
        // concluir, e "meio emprego" não existe.
        let open = binary_progress(&metricless(GoalKind::Binary, "active"), &[]);
        assert_eq!(open.ratio, 0.0);
        assert!(open.formula.contains("até ser concluída"));

        let done = binary_progress(&metricless(GoalKind::Binary, "done"), &[]);
        assert_eq!(done.ratio, 1.0);
        assert!(done.formula.contains("concluída"));
    }

    #[test]
    fn an_achievement_with_milestones_measures_by_them() {
        // Ter picado a conquista em partes é ter dito como medi-la — e a média
        // é a ponderada de sempre, não a contagem da escada.
        let p = binary_progress(
            &metricless(GoalKind::Binary, "active"),
            &[simple("done", 3.0), simple("active", 1.0)],
        );
        assert!((p.ratio - 0.75).abs() < 1e-9, "{}", p.ratio);
    }

    #[test]
    fn a_staged_goal_reports_which_step_it_is_on() {
        // A leitura que o usuário quer de uma escada é "estou no 2 de 4", com o
        // NOME do degrau — não uma porcentagem solta.
        let p = staged_progress(&[
            stage("Básico", "done", 1.0),
            stage("Intermediário", "done", 2.0),
            stage("Avançado", "active", 3.0),
            stage("Fluente", "active", 4.0),
        ]);
        assert_eq!(p.stage_current, Some(2));
        assert_eq!(p.stage_total, Some(4));
        assert_eq!(p.stage_label.as_deref(), Some("Intermediário"));
        assert!((p.ratio - 0.5).abs() < 1e-9);
        assert!(p.formula.contains("degrau 2 de 4"));
        assert!(p.formula.contains("Intermediário"));
    }

    #[test]
    fn a_staged_goal_on_the_ground_has_no_label_but_still_has_a_ladder() {
        // A escada existe, o usuário ainda não subiu nenhum degrau: 0 de 4 com
        // rótulo `None` — não "degrau 0" com um nome inventado.
        let p = staged_progress(&[
            stage("Básico", "active", 1.0),
            stage("Intermediário", "active", 2.0),
            stage("Avançado", "active", 3.0),
            stage("Fluente", "active", 4.0),
        ]);
        assert_eq!(p.stage_current, Some(0));
        assert_eq!(p.stage_total, Some(4));
        assert!(p.stage_label.is_none());
        assert_eq!(p.ratio, 0.0);
    }

    #[test]
    fn a_staged_goal_ignores_weights_on_purpose() {
        // Numa escada os degraus são uma ORDEM, não pesos. Ponderar faria a
        // barra deixar de bater com o "2 de 4" que a tela mostra.
        let mut heavy = stage("Avançado", "active", 3.0);
        heavy.milestone.weight = 99.0;
        let p = staged_progress(&[stage("Básico", "done", 1.0), heavy]);
        assert!((p.ratio - 0.5).abs() < 1e-9, "{}", p.ratio);
    }

    #[test]
    fn an_empty_ladder_has_no_current_step_at_all() {
        // "Degrau 0 de 0" não é uma leitura: a escada ainda não foi montada.
        let p = staged_progress(&[]);
        assert_eq!(p.ratio, 0.0);
        assert!(p.stage_current.is_none());
        assert!(p.stage_total.is_none());
        assert!(p.formula.contains("ainda não tem degraus"));
    }

    #[test]
    fn only_a_ladder_carries_the_step_fields() {
        // `None` nas outras fontes: "0 de 0 degraus" numa meta de peso seria uma
        // leitura falsa de uma escada que não existe.
        for p in [
            metric_progress(&goal(ProgressSource::Metric), Some(85.0)),
            milestones_progress(&[simple("done", 1.0)]),
            binary_progress(&metricless(GoalKind::Binary, "done"), &[]),
        ] {
            assert!(p.stage_current.is_none());
            assert!(p.stage_total.is_none());
            assert!(p.stage_label.is_none());
        }
    }

    #[test]
    fn a_metricless_goal_never_divides_by_a_target_that_is_not_there() {
        // A defesa de fundo: se uma linha 'binary' chegasse à barra da métrica
        // (escrita por fora do serviço), ela diria isso em vez de devolver NaN.
        let p = metric_progress(&metricless(GoalKind::Binary, "active"), Some(10.0));
        assert_eq!(p.ratio, 0.0);
        assert!(p.ratio.is_finite());
        assert!(p.formula.contains("não tem métrica"));
    }

    #[test]
    fn the_direction_is_deduced_from_the_numbers() {
        // A conta que o formulário fazia antes de mandar o campo, agora feita de
        // um lado só. A UI pode parar de mandá-la.
        let mut d = details(GoalKind::Quantitative);
        d.metric_name = Some("Peso".into());
        d.unit = Some("kg".into());
        d.start_value = Some(90.0);
        d.target_value = Some(80.0);
        assert_eq!(
            normalize_quantitative(&d).unwrap().direction,
            Some(Direction::Decrease)
        );

        d.target_value = Some(95.0);
        assert_eq!(
            normalize_quantitative(&d).unwrap().direction,
            Some(Direction::Increase)
        );
    }

    #[test]
    fn a_declared_direction_that_contradicts_the_numbers_is_still_refused() {
        // Uma meta 'increase' de 90 para 80 mediria progresso ao contrário para
        // sempre, e o usuário só descobriria vendo a barra andar para trás.
        let mut d = details(GoalKind::Quantitative);
        d.metric_name = Some("Peso".into());
        d.unit = Some("kg".into());
        d.start_value = Some(90.0);
        d.target_value = Some(80.0);
        d.direction = Some(Direction::Increase);
        assert!(matches!(
            normalize_quantitative(&d).unwrap_err(),
            NexusError::Validation(_)
        ));
    }

    #[test]
    fn a_quantitative_goal_without_a_target_is_refused() {
        // Sem alvo não há caminho a medir — e o CHECK da 0016 recusaria a linha
        // com uma mensagem que não ensina nada. Cada campo que falta tem a sua.
        let full = |()| {
            let mut d = details(GoalKind::Quantitative);
            d.metric_name = Some("Peso".into());
            d.unit = Some("kg".into());
            d.start_value = Some(90.0);
            d.target_value = Some(80.0);
            d
        };

        let cases: [(&str, Poison); 5] = [
            ("alvo", |d| d.target_value = None),
            ("ponto de partida", |d| d.start_value = None),
            ("o que mede", |d| d.metric_name = None),
            ("unidade", |d| d.unit = None),
            ("o que mede", |d| d.metric_name = Some("   ".into())),
        ];
        for (expected, strip) in cases {
            let mut d = full(());
            strip(&mut d);
            let err = normalize_quantitative(&d).unwrap_err();
            assert!(
                matches!(err, NexusError::Validation(ref m) if m.contains(expected)),
                "esperava '{expected}', veio {err:?}"
            );
        }
    }

    #[test]
    fn every_progress_explains_itself() {
        // Regra da constituição: todo insight responde "como você calculou?".
        for p in [
            metric_progress(&goal(ProgressSource::Metric), Some(85.0)),
            metric_progress(&goal(ProgressSource::Metric), None),
            milestones_progress(&[simple("done", 2.0), counter(Some(15), Some(30), 1.0)]),
            milestones_progress(&[]),
        ] {
            assert!(!p.formula.is_empty());
            assert!((0.0..=1.0).contains(&p.ratio), "ratio fora da faixa");
        }
    }

    #[test]
    fn the_projection_reads_days_not_milliseconds() {
        // A reta é sobre dias. Se `day_of` devolvesse o instante, duas pesagens
        // na mesma terça seriam dois x diferentes e a inclinação explodiria.
        let day = day_of(1_753_000_000_000).unwrap();
        assert_eq!(format_day(day).len(), 10);
        assert_eq!(day_of(1_753_000_000_000), day_of(1_753_000_060_000));
    }
}
