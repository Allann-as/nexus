//! Casos de uso do Calendário.

use std::sync::Arc;

use chrono::{DateTime, Local, Months, NaiveDate, NaiveTime, TimeZone};
use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, Event, EventPatch, EventRepository, IdGen, NewEvent, NewEventDetails,
    NewNode, NewOccurrence, NodeRepository, Occurrence, OccurrenceMove,
};
use crate::domain::entities::{validate_title, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, NewLedgerEvent};
use crate::domain::recurrence::{overlaps, Recurrence};
use crate::domain::schedule::{format_day, parse_day};

/// Até onde a série é materializada (§7 do plano).
///
/// Além disto a série não existe ainda: o preço de ler UMA tabela em vez de
/// expandir toda regra do banco a cada troca de mês é que a expansão tem um
/// fim.
const HORIZON_MONTHS: u32 = 18;

/// Dois compromissos no mesmo intervalo.
///
/// Detecção pura: o NEXUS **avisa** e nunca barra a escrita. Marcar duas coisas
/// às 15h é uma decisão que às vezes é intencional — o app não é o dono da
/// agenda, o usuário é.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub a: Occurrence,
    pub b: Occurrence,
}

pub struct EventService {
    pub events: Arc<dyn EventRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl EventService {
    /// Cria um evento e materializa as ocorrências dele.
    pub fn create(&self, new: &NewEvent) -> Result<Event> {
        let title = validate_title(&new.title)?;
        let d = &new.details;

        // Terminar antes de começar não é um evento curto, é um dado invertido.
        // Duração zero passa: um lembrete às 9h é um instante legítimo, e a
        // regra meio-aberta de `overlaps` já garante que ele não conflita com
        // ninguém.
        if d.ends_at < d.starts_at {
            return Err(NexusError::Validation(
                "um evento não pode terminar antes de começar".into(),
            ));
        }
        if let Some(rule) = &d.rrule {
            rule.validate()?;
        }
        if let Some(end) = d.recurrence_end {
            if d.rrule.is_none() {
                return Err(NexusError::Validation(
                    "um evento sem recorrência não tem fim de recorrência".into(),
                ));
            }
            if end < d.starts_at {
                return Err(NexusError::Validation(
                    "a recorrência não pode acabar antes do primeiro evento".into(),
                ));
            }
        }
        if let Some(aid) = &new.area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }

        let occurrences = materialise(d)?;
        let id = self.ids.new_id();

        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Event.into(),
            event_type: EventType::Created,
            payload: json!({
                "startsAt": d.starts_at,
                "rrule": d.rrule.as_ref().map(|r| r.to_json()),
                "category": d.category,
                "occurrences": occurrences.len(),
            }),
            title_snapshot: title.clone(),
        };

        self.events.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Event,
                title,
                area_id: new.area_id.clone(),
                parent_id: None,
            },
            d,
            &occurrences,
            &event,
        )
    }

    pub fn get(&self, id: &str) -> Result<Event> {
        self.events.get(id)
    }

    /// Tudo que cai entre dois dias — a tela do calendário, numa query.
    pub fn range(&self, from_day: &str, to_day: &str) -> Result<Vec<Occurrence>> {
        let from = parse_day(from_day)?;
        let to = parse_day(to_day)?;
        if to < from {
            return Err(NexusError::Validation(
                "a janela do calendário termina antes de começar".into(),
            ));
        }
        self.events.range(&format_day(from), &format_day(to))
    }

    pub fn update(&self, id: &str, patch: &EventPatch) -> Result<Event> {
        self.events.update(id, patch, self.clock.now_ms())
    }

    /// Os próximos compromissos de uma categoria (os exames da Saúde, §3.1).
    ///
    /// A partir de hoje, o mais próximo primeiro: é o que o dashboard usa para
    /// "próximo exame" e o alerta de < 7 dias.
    pub fn upcoming_by_category(&self, category: &str, limit: i64) -> Result<Vec<Occurrence>> {
        self.events
            .upcoming_by_category(category, &self.clock.today_local(), limit)
    }

    /// Arrasta UMA ocorrência para outro horário (o timeblocking).
    ///
    /// `occurrence_start` e não só o id do evento: a chave de uma ocorrência é
    /// (event_id, starts_at), e "a série das terças" tem 78 delas.
    ///
    /// Mover uma ocorrência de uma série marca AQUELA como `moved` e não toca na
    /// regra. Reescrever a série inteira porque o usuário empurrou a terça desta
    /// semana para quarta seria decidir por ele que todas as terças mudaram.
    pub fn move_event(
        &self,
        event_id: &str,
        occurrence_start: i64,
        new_start: i64,
    ) -> Result<Occurrence> {
        let event = self.events.get(event_id)?;

        // A duração vem da regra: arrastar move, não redimensiona.
        let duration_ms = event.ends_at - event.starts_at;
        let new_day = format_day(local_at(new_start)?.date_naive());
        let detach = event.rrule.is_some();

        let ledger = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: event_id.to_string(),
            entity_kind: Kind::Event.into(),
            event_type: EventType::StatusChanged,
            payload: json!({
                "moved": true,
                "from": occurrence_start,
                "to": new_start,
                "detachedFromSeries": detach,
            }),
            title_snapshot: event.title.clone(),
        };

        self.events.move_occurrence_with_event(
            &OccurrenceMove {
                event_id,
                from_start: occurrence_start,
                to_start: new_start,
                to_end: new_start + duration_ms,
                to_day: &new_day,
                detach,
            },
            &ledger,
        )
    }

    /// Estica ou encolhe UMA ocorrência (a borda inferior do bloco).
    ///
    /// É um `move` cujo início não muda: por isso reusa o mesmo caminho do
    /// arrasto, com o mesmo destacamento da série e a mesma transação. Um
    /// segundo caminho de escrita para "quase mover" seria a segunda chance de
    /// esquecer o ledger ou o `moved`.
    ///
    /// Redimensionar uma ocorrência de série solta AQUELA da regra, como o
    /// arrasto: o usuário esticou a terapia desta terça, não todas as terças.
    pub fn resize_event(
        &self,
        event_id: &str,
        occurrence_start: i64,
        new_end: i64,
    ) -> Result<Occurrence> {
        let event = self.events.get(event_id)?;

        // `<=` e não `<`: aqui a duração zero não é um lembrete legítimo (como
        // no create), é o usuário tendo arrastado a borda para cima do início.
        if new_end <= occurrence_start {
            return Err(NexusError::Validation(
                "um evento não pode terminar antes de começar".into(),
            ));
        }

        let day = format_day(local_at(occurrence_start)?.date_naive());
        let detach = event.rrule.is_some();

        let ledger = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: event_id.to_string(),
            entity_kind: Kind::Event.into(),
            event_type: EventType::StatusChanged,
            payload: json!({
                "resized": true,
                "occurrence": occurrence_start,
                "to": new_end,
                "detachedFromSeries": detach,
            }),
            title_snapshot: event.title.clone(),
        };

        self.events.move_occurrence_with_event(
            &OccurrenceMove {
                event_id,
                from_start: occurrence_start,
                // O início é o mesmo: só a borda de baixo se mexeu.
                to_start: occurrence_start,
                to_end: new_end,
                to_day: &day,
                detach,
            },
            &ledger,
        )
    }

    /// "Toda terça, MENOS a de 25/11."
    ///
    /// A linha continua na tabela de propósito: apagá-la faria a próxima
    /// materialização trazer a ocorrência de volta, e o usuário cancelaria a
    /// mesma consulta duas vezes.
    pub fn cancel_occurrence(&self, event_id: &str, occurrence_start: i64) -> Result<()> {
        let event = self.events.get(event_id)?;

        let ledger = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: event_id.to_string(),
            entity_kind: Kind::Event.into(),
            event_type: EventType::StatusChanged,
            payload: json!({ "cancelled": true, "occurrence": occurrence_start }),
            title_snapshot: event.title.clone(),
        };

        self.events
            .cancel_occurrence_with_event(event_id, occurrence_start, &ledger)
    }

    /// Apaga o evento inteiro, com série e tudo.
    ///
    /// As ocorrências caem pelo CASCADE encadeado (nodes -> event_details ->
    /// event_occurrences); o evento de ledger sobrevive, porque `entity_id` não
    /// tem FK.
    pub fn delete(&self, id: &str) -> Result<()> {
        let event = self.events.get(id)?;

        let ledger = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: Kind::Event.into(),
            event_type: EventType::Deleted,
            payload: json!({ "startsAt": event.starts_at, "series": event.rrule.is_some() }),
            title_snapshot: event.title.clone(),
        };

        self.nodes.delete_with_event(id, &ledger)
    }

    /// Estende a janela materializada até o fim de `until_month` ('YYYY-MM').
    ///
    /// O passo que faltava da 0007: sem ele a série acaba 18 meses depois da
    /// âncora e o mês 19 abre vazio — não porque não haja compromisso, mas
    /// porque ninguém o escreveu.
    ///
    /// **Por que é um comando explícito, e não parte da leitura do calendário.**
    /// Materializar é ESCREVER. A leitura do mês roda no pool r2d2, que abre
    /// `READ_ONLY` + `query_only=ON` justamente para nunca escrever; estender ali
    /// levaria um `SQLITE_READONLY` na cara do usuário ao virar o mês. A UI chama
    /// isto ao navegar para perto da borda, e a escrita entra pela fila do
    /// `Db::write` como qualquer outra.
    ///
    /// **Por que não grava no ledger.** O ledger é a história do usuário, e
    /// estender a janela não é um fato da vida dele: é o NEXUS terminando de
    /// escrever uma decisão que já foi registrada quando a série foi criada.
    /// Um evento por extensão encheria a Timeline de linhas que ninguém causou.
    ///
    /// Devolve quantas ocorrências novas nasceram — 0 quando não havia o que
    /// fazer, que é a resposta normal.
    pub fn extend_materialization(&self, until_month: &str) -> Result<usize> {
        let until = parse_month_end(until_month)?;
        // A borda é comparada em epoch: `rule_start` é epoch, e o dia local só
        // vira instante aqui, uma vez, em vez de dentro do SQL (onde
        // `datetime(..., 'localtime')` não usaria índice e dependeria do fuso do
        // processo — a razão de a coluna `day` existir na 0007).
        let until_ms = end_of_day_ms(until)?;

        let mut written = 0;
        for tail in self.events.series_needing_extension(until_ms)? {
            let anchor_dt = local_at(tail.anchor_starts_at)?;
            let anchor = anchor_dt.date_naive();

            // Continua do turno seguinte ao último materializado. `succ_opt` e
            // não "+1 dia em ms" pela mesma razão de sempre: dia é calendário,
            // não aritmética de instante.
            let Some(from) = local_at(tail.last_materialised)?.date_naive().succ_opt() else {
                continue;
            };

            // O fim da recorrência ganha do horizonte pedido: um curso que
            // acaba em setembro não gera aula em 2029 por o usuário ter rolado
            // o calendário até lá.
            let stop = match tail.recurrence_end {
                Some(end) => until.min(local_at(end)?.date_naive()),
                None => until,
            };

            let occurrences = expand_rule(
                &tail.rrule,
                anchor,
                anchor_dt.time(),
                tail.anchor_ends_at - tail.anchor_starts_at,
                from,
                stop,
            );
            if occurrences.is_empty() {
                continue;
            }
            written += self
                .events
                .append_occurrences(&tail.event_id, &occurrences)?;
        }
        Ok(written)
    }

    /// Os choques de horário dentro de uma janela.
    ///
    /// Só detecta. O usuário PODE marcar duas coisas às 15h — às vezes ele quer
    /// mesmo, e um app que recusa a escrita vira um obstáculo em vez de um
    /// aviso.
    pub fn conflicts(&self, from_ms: i64, to_ms: i64) -> Result<Vec<Conflict>> {
        if to_ms < from_ms {
            return Err(NexusError::Validation(
                "a janela de conflitos termina antes de começar".into(),
            ));
        }
        let occurrences = self.events.overlapping_window(from_ms, to_ms)?;

        let mut out = Vec::new();
        for (i, a) in occurrences.iter().enumerate() {
            // Um evento de dia inteiro cobre o dia todo: pareá-lo com tudo
            // acusaria conflito em cada compromisso de uma segunda-feira de
            // feriado. Ele é um rótulo do dia, não uma reserva de horário.
            if a.all_day {
                continue;
            }
            for b in occurrences.iter().skip(i + 1) {
                // A lista vem ordenada por `starts_at`: a partir do primeiro que
                // começa depois do fim de `a`, nenhum dos seguintes o toca.
                if b.starts_at >= a.ends_at {
                    break;
                }
                if b.all_day {
                    continue;
                }
                if overlaps(a.starts_at, a.ends_at, b.starts_at, b.ends_at) {
                    out.push(Conflict {
                        a: a.clone(),
                        b: b.clone(),
                    });
                }
            }
        }
        Ok(out)
    }
}

/// As ocorrências que uma regra gera dentro do horizonte.
///
/// **Um evento avulso também ganha uma.** É o que permite ao calendário ler UMA
/// tabela: sem a linha do avulso, desenhar novembro exigiria unir
/// `event_occurrences` com os `event_details` que não se repetem — e essa união
/// estaria em toda query de calendário do app, para sempre.
///
/// Função livre e não método: ela não consulta port nenhum. É uma conta sobre a
/// regra e o relógio de parede, e ser livre é o que a torna testável sem montar
/// cinco fakes que ela não usaria.
fn materialise(d: &NewEventDetails) -> Result<Vec<NewOccurrence>> {
    let start = local_at(d.starts_at)?;
    let anchor = start.date_naive();

    let Some(rule) = &d.rrule else {
        return Ok(vec![NewOccurrence {
            starts_at: d.starts_at,
            ends_at: d.ends_at,
            day: format_day(anchor),
        }]);
    };

    let horizon = anchor
        .checked_add_months(Months::new(HORIZON_MONTHS))
        .ok_or_else(|| NexusError::Validation("data fora do calendário".into()))?;
    let until = match d.recurrence_end {
        Some(end) => horizon.min(local_at(end)?.date_naive()),
        None => horizon,
    };

    Ok(expand_rule(
        rule,
        anchor,
        start.time(),
        d.ends_at - d.starts_at,
        anchor,
        until,
    ))
}

/// Os turnos de uma regra entre `from` e `until`, como ocorrências.
///
/// Compartilhada pela criação (que expande da âncora) e pela extensão (que
/// expande da borda para a frente). Uma segunda expansão, escrita à parte para a
/// extensão, seria uma segunda chance de errar a virada do horário de verão — e
/// as duas divergiriam no dia em que só uma fosse corrigida.
///
/// `anchor` é sempre o evento ORIGINAL, mesmo quando `from` está 18 meses à
/// frente: é a âncora que dá a fase de "a cada 2 semanas". Passar a borda como
/// âncora faria a série escorregar de semana a cada extensão.
fn expand_rule(
    rule: &Recurrence,
    anchor: NaiveDate,
    time: NaiveTime,
    duration_ms: i64,
    from: NaiveDate,
    until: NaiveDate,
) -> Vec<NewOccurrence> {
    rule.expand(anchor, from, until)
        .into_iter()
        .filter_map(|day| {
            // A hora de PAREDE é o que se repete: "toda terça às 19h" são 19h dos
            // dois lados de uma virada de horário de verão, e somar 7×24h ao
            // epoch daria 18h ou 20h do outro lado. Por isso cada ocorrência é
            // reconstruída a partir do dia local + a hora local.
            local_ms(day, time).map(|starts_at| NewOccurrence {
                starts_at,
                ends_at: starts_at + duration_ms,
                day: format_day(day),
            })
        })
        .collect()
}

/// 'YYYY-MM' -> o último dia daquele mês.
///
/// O horizonte que a UI pede é um MÊS ("materialize até 2028-03"), não um dia:
/// o gesto que o dispara é navegar para perto da borda, e o usuário navega em
/// meses. Aceitar um dia aqui só empurraria esta conta para dentro da tela.
fn parse_month_end(month: &str) -> Result<NaiveDate> {
    let bad = || NexusError::Validation(format!("mês inválido: {month} (esperado 'AAAA-MM')"));

    let (y, m) = month.split_once('-').ok_or_else(bad)?;
    let year: i32 = y.parse().map_err(|_| bad())?;
    let month0: u32 = m.parse().map_err(|_| bad())?;

    // O dia 1 do mês SEGUINTE, menos um dia: o último dia deste mês, sem
    // nenhuma regra de bissexto escrita à mão.
    let first = NaiveDate::from_ymd_opt(year, month0, 1).ok_or_else(bad)?;
    first
        .checked_add_months(Months::new(1))
        .and_then(|d| d.pred_opt())
        .ok_or_else(bad)
}

/// O último instante de um dia local — a borda superior da janela.
///
/// 23:59:59.999 e não a meia-noite seguinte: a comparação com `rule_start` é
/// `<`, e um evento que começa exatamente à meia-noite do dia seguinte não
/// pertence a este mês.
fn end_of_day_ms(day: NaiveDate) -> Result<i64> {
    let time = NaiveTime::from_hms_milli_opt(23, 59, 59, 999).expect("23:59:59.999 é uma hora");
    local_ms(day, time)
        .ok_or_else(|| NexusError::Validation(format!("fim de dia fora do calendário: {day}")))
}

/// O instante, no fuso do usuário.
fn local_at(ms: i64) -> Result<DateTime<Local>> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .ok_or_else(|| NexusError::Validation(format!("instante fora do calendário: {ms}")))
}

/// Dia local + hora de parede -> epoch ms.
///
/// `None` quando o instante não existe no fuso: na virada do horário de verão
/// para a frente, as 00h30 simplesmente não acontecem. Um evento que caísse ali
/// não tem epoch para ser gravado — e inventar um o colocaria numa hora que o
/// usuário não escolheu.
fn local_ms(day: NaiveDate, time: NaiveTime) -> Option<i64> {
    Local
        .from_local_datetime(&day.and_time(time))
        // `earliest` e não `single`: na virada PARA TRÁS a mesma hora acontece
        // duas vezes, e a primeira é a que o usuário quis dizer.
        .earliest()
        .map(|dt| dt.timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::recurrence::Recurrence;

    fn ms(day: &str, hour: u32, min: u32) -> i64 {
        let d = parse_day(day).unwrap();
        local_ms(d, NaiveTime::from_hms_opt(hour, min, 0).unwrap()).unwrap()
    }

    fn expand(d: &NewEventDetails) -> Vec<NewOccurrence> {
        materialise(d).unwrap()
    }

    fn details(starts_at: i64, ends_at: i64, rrule: Option<Recurrence>) -> NewEventDetails {
        NewEventDetails {
            starts_at,
            ends_at,
            all_day: false,
            rrule,
            recurrence_end: None,
            location: None,
            category: None,
        }
    }

    #[test]
    fn a_single_event_is_materialised_as_exactly_one_occurrence() {
        // O ponto inteiro da 0007: o calendário lê UMA tabela. Sem esta linha,
        // toda query de mês viraria um UNION de "avulsos" e "séries".
        let start = ms("2026-07-17", 9, 0);
        let occ = expand(&details(start, start + 3_600_000, None));

        assert_eq!(occ.len(), 1);
        assert_eq!(occ[0].starts_at, start);
        assert_eq!(occ[0].day, "2026-07-17");
    }

    #[test]
    fn the_horizon_stops_the_expansion_at_eighteen_months() {
        // Sem horizonte, "todo dia, para sempre" seria uma tabela infinita. Com
        // ele, a série tem borda — e é o serviço que a estende depois.
        let start = ms("2026-07-17", 9, 0);
        let occ = expand(&details(
            start,
            start + 3_600_000,
            Some(Recurrence::Daily { interval: 1 }),
        ));

        let last = &occ[occ.len() - 1];
        assert_eq!(occ[0].day, "2026-07-17");
        assert_eq!(last.day, "2028-01-17", "18 meses depois da âncora");
    }

    #[test]
    fn a_recurrence_end_before_the_horizon_wins() {
        // Um curso que acaba em setembro não pode gerar ocorrências até 2028.
        let start = ms("2026-07-17", 9, 0);
        let mut d = details(
            start,
            start + 3_600_000,
            Some(Recurrence::Daily { interval: 1 }),
        );
        d.recurrence_end = Some(ms("2026-07-20", 23, 0));

        let occ = expand(&d);
        let days: Vec<&str> = occ.iter().map(|o| o.day.as_str()).collect();
        assert_eq!(
            days,
            vec!["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"]
        );
    }

    #[test]
    fn every_occurrence_keeps_the_wall_clock_time_and_the_duration() {
        // "Toda terça às 19h" são 19h em toda terça. Somar 7×24h ao epoch daria
        // 18h ou 20h do outro lado de uma virada de horário de verão.
        let start = ms("2026-07-14", 19, 0);
        let occ = expand(&details(
            start,
            start + 5_400_000, // 1h30
            Some(Recurrence::Weekly {
                interval: 1,
                days: vec![2],
            }),
        ));

        for o in &occ {
            let local = local_at(o.starts_at).unwrap();
            assert_eq!(
                local.format("%H:%M").to_string(),
                "19:00",
                "o dia {} escorregou de hora",
                o.day
            );
            assert_eq!(o.ends_at - o.starts_at, 5_400_000, "a duração é a da regra");
        }
    }

    #[test]
    fn the_local_day_is_the_one_the_user_sees_not_the_utc_one() {
        // `day` existe justamente para o calendário não perguntar ao SQLite que
        // dia é um epoch. Um evento tarde da noite tem que cair no dia local.
        let start = ms("2026-07-17", 23, 30);
        let occ = expand(&details(start, start + 3_600_000, None));
        assert_eq!(occ[0].day, "2026-07-17");
    }

    #[test]
    fn the_month_horizon_is_the_last_day_of_that_month() {
        assert_eq!(
            parse_month_end("2028-03").unwrap(),
            NaiveDate::from_ymd_opt(2028, 3, 31).unwrap()
        );
        assert_eq!(
            parse_month_end("2028-02").unwrap(),
            NaiveDate::from_ymd_opt(2028, 2, 29).unwrap(),
            "2028 é bissexto, e ninguém escreveu uma regra de bissexto"
        );
        assert_eq!(
            parse_month_end("2027-12").unwrap(),
            NaiveDate::from_ymd_opt(2027, 12, 31).unwrap(),
            "dezembro tem que virar o ANO, não o mês 13"
        );
    }

    #[test]
    fn a_month_outside_the_vocabulary_is_refused_instead_of_guessed() {
        // Um 'AAAA-MM' torto vindo da UI não pode virar uma janela silenciosa de
        // tamanho errado: ela materializaria a série no lugar errado, e o erro
        // só apareceria como um mês vazio meses depois.
        for bad in ["2028", "2028-13", "2028-00", "março/2028", "", "-"] {
            assert!(
                parse_month_end(bad).is_err(),
                "'{bad}' não devia ser aceito como mês"
            );
        }
    }

    #[test]
    fn the_extension_continues_the_phase_of_the_anchor_instead_of_the_border() {
        // "A cada 2 semanas" expandido a partir da BORDA (e não da âncora) tem
        // 50% de chance de escorregar para a semana errada — e a série se
        // deslocaria mais um pouco a cada extensão, sem nunca dar erro.
        let anchor = parse_day("2026-07-14").unwrap(); // uma terça
        let time = NaiveTime::from_hms_opt(19, 0, 0).unwrap();
        let rule = Recurrence::Weekly {
            interval: 2,
            days: vec![2],
        };

        // A borda cai numa terça ÍMPAR em relação à âncora (a semana que a regra
        // pula): é a que pegaria a fase errada se fosse usada como âncora.
        let border = parse_day("2026-07-21").unwrap();
        let occ = expand_rule(
            &rule,
            anchor,
            time,
            3_600_000,
            border,
            parse_day("2026-08-31").unwrap(),
        );

        let days: Vec<&str> = occ.iter().map(|o| o.day.as_str()).collect();
        assert_eq!(
            days,
            vec!["2026-07-28", "2026-08-11", "2026-08-25"],
            "as terças da fase da âncora, não as da borda"
        );
    }

    #[test]
    fn a_finished_series_expands_to_nothing_no_matter_how_far_the_user_navigates() {
        // O corte que o SQL não sabe fazer (ver `series_needing_extension`): um
        // curso encerrado é oferecido como candidato à extensão, e é AQUI que
        // ele morre. Sem este corte, rolar o calendário até 2029 materializaria
        // aula de um curso que acabou em julho.
        let anchor = parse_day("2026-07-14").unwrap();
        let time = NaiveTime::from_hms_opt(9, 0, 0).unwrap();

        // `stop` = min(horizonte, fim da recorrência), como o serviço calcula.
        let stop = parse_day("2028-12-31")
            .unwrap()
            .min(parse_day("2026-07-16").unwrap());

        let occ = expand_rule(
            &Recurrence::Daily { interval: 1 },
            anchor,
            time,
            3_600_000,
            parse_day("2026-07-17").unwrap(), // a borda já passou do fim
            stop,
        );
        assert!(occ.is_empty(), "o fim da recorrência ganha do horizonte");
    }

    #[test]
    fn a_monthly_on_the_31st_lands_on_the_short_months_last_day() {
        // A regra vem de `domain::recurrence`; o teste está aqui para provar que
        // a materialização não a atropela ao reconstruir o epoch de cada dia.
        let start = ms("2026-01-31", 10, 0);
        let occ = expand(&details(
            start,
            start + 3_600_000,
            Some(Recurrence::Monthly { interval: 1 }),
        ));

        let days: Vec<&str> = occ.iter().take(3).map(|o| o.day.as_str()).collect();
        assert_eq!(days, vec!["2026-01-31", "2026-02-28", "2026-03-31"]);
    }
}
