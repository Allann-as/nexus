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

/// A versão do MOTOR — o formato do payload **e a matemática que o produz**.
///
/// O cache guarda o resultado já serializado, e `input_signature` observa só as
/// tabelas-fonte. Então nada que mude no CÓDIGO invalida o cache: o motor acha
/// que o resultado continua válido e devolve o JSON antigo para sempre, até que
/// o usuário por acaso marque um hábito.
///
/// Isto mordeu duas vezes na mesma sessão, e de dois jeitos diferentes:
///
///  1. **Forma.** P(B|A) entrou no `CorrelationCard`; a assinatura não mudou; o
///     cache devolveu o JSON sem o campo, e as barras novas desenharam `NaN%`.
///  2. **Cálculo.** A carga da guarda anti-burnout passou a ser comparada
///     até-a-data; a forma continuou idêntica, então a primeira correção (que
///     versionava só o formato) não bastou — a tela seguiu mostrando o número
///     velho, calculado pela regra velha, sem nenhum sinal de que era velho.
///
/// Por isso a versão é do MOTOR, não do payload. **Suba este número sempre que
/// mudar a forma do resultado OU a conta que o gera.** Como ela entra na
/// assinatura, o cache é invalidado pelo mesmo caminho que dado novo invalida,
/// e a linha é sobrescrita em vez de virar órfã.
const ENGINE_VERSION: u32 = 3;
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
    /// P(B | A) — chance de cumprir B nos dias em que A foi feito.
    ///
    /// Estes dois números existiam desde sempre em `domain::correlation`, mas
    /// só saíam daqui **formatados dentro da frase**. Uma probabilidade escrita
    /// em prosa não vira barra: para desenhar a evidência ao lado da afirmação,
    /// a tela precisa do número.
    pub p_b_given_a: f64,
    /// P(B | ¬A) — a mesma chance nos dias em que A NÃO foi feito.
    pub p_b_given_not_a: f64,
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
        let signature = self.signature()?;
        if let Some(cached) = self.insights.cache_get(CACHE_KEY)? {
            if cached.input_hash == signature {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&cached.payload_json) {
                    return Ok(value);
                }
            }
        }
        self.recompute(&signature)
    }

    /// A assinatura completa: a versão do motor + o estado das fontes. Um cache
    /// só é reaproveitável quando os DOIS batem.
    fn signature(&self) -> Result<String> {
        Ok(format!(
            "engine=v{ENGINE_VERSION}|{}",
            self.insights.input_signature()?
        ))
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

                let (direction, sentence) = describe(&corr, &a.title, &b.title);

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
                    p_b_given_a: corr.p_b_given_a,
                    p_b_given_not_a: corr.p_b_given_not_a,
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

        let mut days: Vec<(NaiveDate, f64)> = Vec::new();
        for (day, n) in self.insights.done_ticks_by_day(&from_s, &to_s)? {
            if let Ok(d) = parse_day(&day) {
                days.push((d, n as f64));
            }
        }
        for (day, n) in self.insights.event_count_by_day(&from_s, &to_s)? {
            if let Ok(d) = parse_day(&day) {
                days.push((d, n as f64));
            }
        }
        let by_week = weekly_load_to_today(&days, today);

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

/// A carga somada por semana, contando em CADA semana só até o mesmo dia da
/// semana que hoje.
///
/// Sem esse corte, a semana corrente — que numa quarta-feira tem três dias —
/// era comparada contra a média de semanas **inteiras**. A razão saía dividida
/// por dois por construção, e a guarda anti-burnout, que existe para avisar
/// quando a semana está pesada, ficava estruturalmente muda justo no começo da
/// semana, que é quando o aviso ainda serve para alguma coisa. É a mesma regra
/// "até-a-data" que o Comparativo usa desde o ADR-0062, e a mesma lição do
/// ADR-0102: comparar um período pela metade com um período cheio inverte a
/// leitura sem que nada tenha mudado na vida de quem lê.
fn weekly_load_to_today(days: &[(NaiveDate, f64)], today: NaiveDate) -> HashMap<NaiveDate, f64> {
    let cutoff = (today - week_start(today)).num_days();
    let mut by_week: HashMap<NaiveDate, f64> = HashMap::new();
    for (d, n) in days {
        let ws = week_start(*d);
        if (*d - ws).num_days() <= cutoff {
            *by_week.entry(ws).or_insert(0.0) += n;
        }
    }
    by_week
}

/// A direção e a frase de uma correlação.
///
/// **A direção vem do DADO, não do teste de template.** Antes, tudo que não
/// passava em `qualifies_for_positive_template()` (φ ≥ 0,25 **e** lift ≥ 1,3)
/// virava `Hurts` com a frase "cumprir B *cai* de X% para Y%". Só que o crivo
/// tem duas condições e a direção tem uma: uma relação **positiva porém
/// moderada** — φ 0,29 com lift 1,26, que é alcançável — passava no piso de
/// exibição, falhava no piso do template, e saía rotulada como prejudicial
/// dizendo "cai de 77% para 97%". O verbo contradizia os próprios números ao
/// lado dele.
///
/// Agora são três casos, que é o que o comentário do domínio sempre descreveu:
/// o efeito positivo e forte ganha a frase afirmativa; o positivo e fraco ganha
/// uma frase que diz que é fraco; o negativo ganha "cai". O sinal do efeito
/// (`lift > 1`) decide a direção nos três — e `lift` nunca está entre 0,9 e 1,1
/// porque a faixa morta já foi barrada em `analyze`.
fn describe(corr: &correlation::Correlation, a_title: &str, b_title: &str) -> (Direction, String) {
    let from = corr.p_b_given_not_a * 100.0;
    let to = corr.p_b_given_a * 100.0;
    let n = corr.sample_size;

    if corr.lift > 1.0 {
        let sentence = if corr.qualifies_for_positive_template() {
            format!(
                "Nos dias em que você cumpre {a_title}, cumprir {b_title} sobe de \
                 {from:.0}% para {to:.0}% (base: {n} dias)."
            )
        } else {
            format!(
                "Nos dias em que você cumpre {a_title}, cumprir {b_title} vai de \
                 {from:.0}% a {to:.0}% — uma relação positiva, mas fraca demais \
                 para afirmar mais que isso (base: {n} dias)."
            )
        };
        (Direction::Helps, sentence)
    } else {
        (
            Direction::Hurts,
            format!(
                "Nos dias em que você cumpre {a_title}, cumprir {b_title} cai de \
                 {from:.0}% para {to:.0}% (base: {n} dias)."
            ),
        )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::correlation::{analyze, Contingency};

    #[test]
    fn a_strong_positive_gets_the_affirmative_sentence() {
        // P(B|A) = 90%, P(B|¬A) = 30%, lift 3,0.
        let c = analyze(Contingency {
            a: 27,
            b: 3,
            c: 9,
            d: 21,
        })
        .expect("amostra 60");
        let (dir, s) = describe(&c, "Dormir cedo", "Acordar cedo");
        assert_eq!(dir, Direction::Helps);
        assert!(s.contains("sobe de 30% para 90%"), "frase foi: {s}");
    }

    #[test]
    fn a_negative_effect_says_it_falls() {
        // P(B|A) = 20%, P(B|¬A) = 80%: lift bem abaixo de 0,9.
        let c = analyze(Contingency {
            a: 6,
            b: 24,
            c: 24,
            d: 6,
        })
        .expect("amostra 60");
        let (dir, s) = describe(&c, "Ficar até tarde", "Acordar cedo");
        assert_eq!(dir, Direction::Hurts);
        assert!(s.contains("cai de 80% para 20%"), "frase foi: {s}");
    }

    #[test]
    fn a_positive_but_moderate_effect_is_never_called_harmful() {
        // O caso que o código antigo errava: φ ≈ 0,29 (passa o piso de exibição)
        // com lift ≈ 1,26 (NÃO passa o piso do template). P(B|A) = 97% contra
        // P(B|¬A) = 77% — sobe. A versão anterior devolvia `Hurts` e escrevia
        // "cai de 77% para 97%", contradizendo os próprios números.
        let c = analyze(Contingency {
            a: 58,
            b: 2,
            c: 46,
            d: 14,
        })
        .expect("amostra 120");
        assert!(c.lift > 1.1 && c.lift < 1.3, "lift foi {}", c.lift);
        assert!(c.phi >= PHI_TEMPLATE_MIN, "phi foi {}", c.phi);
        assert!(!c.qualifies_for_positive_template());

        let (dir, s) = describe(&c, "Beber água", "Correr");
        assert_eq!(
            dir,
            Direction::Helps,
            "o efeito é positivo; a direção segue o dado, não o crivo do template"
        );
        assert!(!s.contains("cai"), "não pode dizer que cai: {s}");
        assert!(s.contains("fraca"), "tem que dizer que é fraca: {s}");
    }

    #[test]
    fn the_load_of_every_week_stops_at_the_same_weekday() {
        // Hoje é QUARTA, 2026-07-22 (a semana começou na segunda, 20/07).
        let today = crate::domain::schedule::parse_day("2026-07-22").unwrap();
        let d = |s: &str| crate::domain::schedule::parse_day(s).unwrap();

        let days = vec![
            // Semana corrente: seg, ter, qua = 3 dias, 6 de carga.
            (d("2026-07-20"), 2.0),
            (d("2026-07-21"), 2.0),
            (d("2026-07-22"), 2.0),
            // Semana anterior: os mesmos três dias (6) MAIS quinta a domingo (8),
            // que não podem entrar — hoje ainda não é quinta.
            (d("2026-07-13"), 2.0),
            (d("2026-07-14"), 2.0),
            (d("2026-07-15"), 2.0),
            (d("2026-07-16"), 2.0),
            (d("2026-07-17"), 2.0),
            (d("2026-07-18"), 2.0),
            (d("2026-07-19"), 2.0),
        ];

        let by_week = weekly_load_to_today(&days, today);
        assert_eq!(by_week.get(&d("2026-07-20")).copied(), Some(6.0));
        assert_eq!(
            by_week.get(&d("2026-07-13")).copied(),
            Some(6.0),
            "a semana passada também para na quarta — senão 6 contra 14 diria \
             que a carga caiu pela metade sem nada ter mudado"
        );
    }

    #[test]
    fn a_full_week_anchor_counts_the_whole_week() {
        // Domingo 2026-07-19: o corte é o fim da semana, então tudo entra.
        let today = crate::domain::schedule::parse_day("2026-07-19").unwrap();
        let d = |s: &str| crate::domain::schedule::parse_day(s).unwrap();
        let days = vec![(d("2026-07-13"), 1.0), (d("2026-07-19"), 1.0)];
        let by_week = weekly_load_to_today(&days, today);
        assert_eq!(by_week.get(&d("2026-07-13")).copied(), Some(2.0));
    }

    #[test]
    fn the_sentence_always_goes_from_without_a_to_with_a() {
        // A ordem dos dois números na frase é "de P(B|¬A) para P(B|A)" nos três
        // casos — invertê-la em um deles faria a mesma frase significar o oposto.
        let c = analyze(Contingency {
            a: 27,
            b: 3,
            c: 9,
            d: 21,
        })
        .unwrap();
        let (_, s) = describe(&c, "A", "B");
        let from = s.find("30%").expect("P(B|¬A) na frase");
        let to = s.find("90%").expect("P(B|A) na frase");
        assert!(from < to, "o 'de' é o sem-A e o 'para' é o com-A: {s}");
    }
}
