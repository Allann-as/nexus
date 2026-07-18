//! O `bi_engine` — insights determinísticos, cacheados, fora da thread de UI.
//!
//! O contrato (DATA_MODEL §5): o frontend SEMPRE lê do `insight_cache`
//! (instantâneo); o motor recomputa quando a assinatura das tabelas-fonte muda.
//! Recomputar quando nada mudou é trabalho jogado fora — `refresh_if_stale`
//! compara a assinatura e pula. Tudo é estatística DESCRITIVA e explicável: cada
//! card carrega a `formula` e a `sampleSize`. Zero IA.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{Duration, NaiveDate};
use serde::Serialize;

use crate::application::ports::{Clock, InsightRepository};
use crate::domain::burnout::{self, Workload};
use crate::domain::correlation::{self, PHI_TEMPLATE_MIN};
use crate::domain::errors::Result;
use crate::domain::schedule::{parse_day, week_start};

/// A chave única deste pacote de insights no `insight_cache`.
const CACHE_KEY: &str = "insights_v1";
/// Quantas correlações, no máximo, viram card — as mais fortes primeiro.
const MAX_CORRELATIONS: usize = 8;
/// Semanas de histórico para a carga: a corrente + 8 de base.
const LOAD_WEEKS: i64 = 9;

pub struct InsightService {
    pub insights: Arc<dyn InsightRepository>,
    pub clock: Arc<dyn Clock>,
}

/// Um hábito reduzido ao que um card de correlação precisa.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitRef {
    pub id: String,
    pub title: String,
}

/// A direção de uma correlação — o rótulo, nunca só a cor.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Helps,
    Hurts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationCard {
    pub habit_a: HabitRef,
    pub habit_b: HabitRef,
    pub direction: Direction,
    pub lift: f64,
    pub phi: f64,
    pub sample_size: u32,
    /// A frase pronta ("Nos dias em que você cumpre A, cumprir B sobe de X% …").
    pub sentence: String,
    pub formula: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub correlations: Vec<CorrelationCard>,
    pub burnout: Option<Workload>,
    pub computed_at: i64,
}

impl InsightService {
    /// A leitura do frontend: o que está no cache, instantâneo. `null` se o motor
    /// ainda não rodou (o primeiríssimo boot); a UI mostra "calculando…".
    pub fn get(&self) -> Result<Option<serde_json::Value>> {
        let Some(cached) = self.insights.cache_get(CACHE_KEY)? else {
            return Ok(None);
        };
        let value: serde_json::Value =
            serde_json::from_str(&cached.payload_json).unwrap_or(serde_json::Value::Null);
        Ok(Some(value))
    }

    /// Recomputa só se a assinatura das fontes mudou. Barato no caso comum (uma
    /// comparação de string); caro só quando há dado novo. É o método que o
    /// worker e o comando de recompute chamam.
    pub fn refresh_if_stale(&self) -> Result<serde_json::Value> {
        let signature = self.insights.input_signature()?;
        if let Some(cached) = self.insights.cache_get(CACHE_KEY)? {
            if cached.input_hash == signature {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&cached.payload_json) {
                    return Ok(value);
                }
            }
        }
        self.recompute(&signature)
    }

    /// Faz a conta, serializa e grava no cache. Sempre executa — quem decide se
    /// vale a pena é `refresh_if_stale`.
    fn recompute(&self, signature: &str) -> Result<serde_json::Value> {
        let today = parse_day(&self.clock.today_local())?;
        let now = self.clock.now_ms();

        let correlations = self.compute_correlations(today)?;
        let burnout = self.compute_burnout(today)?;

        let insights = Insights {
            correlations,
            burnout,
            computed_at: now,
        };
        let value = serde_json::to_value(&insights)
            .map_err(|e| crate::domain::errors::NexusError::Storage(e.to_string()))?;
        self.insights
            .cache_put(CACHE_KEY, &value.to_string(), signature, now)?;
        Ok(value)
    }

    /// Correlações entre pares de hábitos, sobre os dias em que AMBOS estavam
    /// agendados (`domain::correlation`). As guardas (n ≥ 30, faixa morta) já
    /// moram no domínio; aqui aplicamos só o piso de exibição (|φ| ≥ 0,25) e
    /// pegamos as mais fortes.
    fn compute_correlations(&self, today: NaiveDate) -> Result<Vec<CorrelationCard>> {
        let series = self.insights.active_habit_series()?;

        // Pré-processa: agenda, dias-feitos como conjunto, e o primeiro dia visto
        // (início da janela de observação daquele hábito).
        struct Prepared {
            id: String,
            title: String,
            schedule: crate::domain::schedule::Schedule,
            done: HashSet<NaiveDate>,
            first: Option<NaiveDate>,
        }
        let prepared: Vec<Prepared> = series
            .into_iter()
            .map(|s| {
                let done: HashSet<NaiveDate> = s
                    .done_days
                    .iter()
                    .filter_map(|d| parse_day(d).ok())
                    .collect();
                let first = done.iter().min().copied();
                Prepared {
                    id: s.id,
                    title: s.title,
                    schedule: s.schedule,
                    done,
                    first,
                }
            })
            .collect();

        let mut cards: Vec<CorrelationCard> = Vec::new();
        for i in 0..prepared.len() {
            for j in (i + 1)..prepared.len() {
                let (a, b) = (&prepared[i], &prepared[j]);
                let (Some(fa), Some(fb)) = (a.first, b.first) else {
                    continue; // um hábito sem nenhum 'done' não tem janela.
                };
                let from = fa.max(fb);
                if from > today {
                    continue;
                }
                let t = correlation::build_contingency(
                    &a.schedule,
                    &a.done,
                    &b.schedule,
                    &b.done,
                    from,
                    today,
                );
                let Some(corr) = correlation::analyze(t) else {
                    continue;
                };
                if corr.phi.abs() < PHI_TEMPLATE_MIN {
                    continue; // há relação, mas fraca demais para um card.
                }

                let (direction, sentence) = if corr.qualifies_for_positive_template() {
                    (
                        Direction::Helps,
                        format!(
                            "Nos dias em que você cumpre {}, cumprir {} sobe de {:.0}% para {:.0}% (base: {} dias).",
                            a.title,
                            b.title,
                            corr.p_b_given_not_a * 100.0,
                            corr.p_b_given_a * 100.0,
                            corr.sample_size
                        ),
                    )
                } else {
                    (
                        Direction::Hurts,
                        format!(
                            "Nos dias em que você cumpre {}, cumprir {} cai de {:.0}% para {:.0}% (base: {} dias).",
                            a.title,
                            b.title,
                            corr.p_b_given_not_a * 100.0,
                            corr.p_b_given_a * 100.0,
                            corr.sample_size
                        ),
                    )
                };

                cards.push(CorrelationCard {
                    habit_a: HabitRef {
                        id: a.id.clone(),
                        title: a.title.clone(),
                    },
                    habit_b: HabitRef {
                        id: b.id.clone(),
                        title: b.title.clone(),
                    },
                    direction,
                    lift: corr.lift,
                    phi: corr.phi,
                    sample_size: corr.sample_size,
                    sentence,
                    formula: corr.formula,
                });
            }
        }

        // Os mais fortes primeiro; corta no teto para a tela não virar lista infinita.
        cards.sort_by(|x, y| {
            y.phi
                .abs()
                .partial_cmp(&x.phi.abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        cards.truncate(MAX_CORRELATIONS);
        Ok(cards)
    }

    /// A guarda anti-burnout: a carga da semana corrente contra a média das
    /// anteriores (`domain::burnout`). Carga = ticks 'done' + ocorrências de
    /// evento na semana.
    fn compute_burnout(&self, today: NaiveDate) -> Result<Option<Workload>> {
        let from = today - Duration::days(LOAD_WEEKS * 7);
        let from_s = crate::domain::schedule::format_day(from);
        let to_s = crate::domain::schedule::format_day(today);

        let mut by_week: HashMap<NaiveDate, f64> = HashMap::new();
        for (day, n) in self.insights.done_ticks_by_day(&from_s, &to_s)? {
            if let Ok(d) = parse_day(&day) {
                *by_week.entry(week_start(d)).or_insert(0.0) += n as f64;
            }
        }
        for (day, n) in self.insights.event_count_by_day(&from_s, &to_s)? {
            if let Ok(d) = parse_day(&day) {
                *by_week.entry(week_start(d)).or_insert(0.0) += n as f64;
            }
        }

        let current_ws = week_start(today);
        let current = by_week.get(&current_ws).copied().unwrap_or(0.0);

        // As 8 semanas anteriores, da mais recente para a mais antiga.
        let mut prior: Vec<f64> = Vec::new();
        for k in 1..=8 {
            let ws = current_ws - Duration::weeks(k);
            prior.push(by_week.get(&ws).copied().unwrap_or(0.0));
        }

        Ok(burnout::assess(current, &prior))
    }
}

/// O motor de BI numa thread própria — o "fora da thread de UI" da §5.
///
/// Aquece o cache no boot (para o primeiro `get` já ter dado) e, depois, recomputa
/// de forma **debounced**: `mark_dirty` sinaliza que algo mudou, e o worker espera
/// 30 s de silêncio antes de refazer a conta — assim uma rajada de marcações (o
/// usuário fechando dez tarefas seguidas) custa UMA recomputação, não dez. O
/// `input_signature` é a segunda trava: se nada mudou de verdade, o cálculo é pulado.
pub struct InsightWorker {
    tx: std::sync::mpsc::Sender<()>,
}

impl InsightWorker {
    pub fn spawn(service: Arc<InsightService>) -> Self {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            // Aquece o cache assim que o app sobe (§5: "recomputação na abertura").
            if let Err(e) = service.refresh_if_stale() {
                tracing::warn!(error = %e, "primeira recomputação de insights falhou");
            }
            while rx.recv().is_ok() {
                // Debounce: drena marcações até 30 s de silêncio, então recomputa.
                loop {
                    match rx.recv_timeout(std::time::Duration::from_secs(30)) {
                        Ok(()) => continue,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
                if let Err(e) = service.refresh_if_stale() {
                    tracing::warn!(error = %e, "recomputação de insights falhou");
                }
            }
        });
        Self { tx }
    }

    /// Sinaliza que as fontes podem ter mudado. Não bloqueia; um erro de envio só
    /// acontece se a thread morreu, e aí o BI para de atualizar (nunca derruba o app).
    pub fn mark_dirty(&self) {
        let _ = self.tx.send(());
    }
}
