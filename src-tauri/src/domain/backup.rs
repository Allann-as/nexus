//! Retenção de backups: a política avô-pai-filho (GFS).
//!
//! Um backup só é seguro se a coleção não cresce sem limite E se o backup certo
//! sobrevive à poda. Esta é a decisão PURA de "quais instantes manter": recebe os
//! carimbos de tempo (epoch-ms) dos backups existentes e devolve o que fica e o
//! que morre. Sem I/O, sem `Date::now` — o teste injeta o calendário que quiser
//! (a regra permanente do arquiteto para o M5: poda provada com datas simuladas).
//!
//! O algoritmo é o do borg/restic: varrendo do mais recente ao mais antigo,
//! mantém-se o PRIMEIRO backup visto de cada novo dia (até 7), de cada nova
//! semana ISO (até 4) e de cada novo mês (até 12). Como a varredura é decrescente,
//! "o primeiro visto de um dia" é o mais recente daquele dia. Um mesmo backup pode
//! representar as três faixas; a união dos vencedores sobrevive, o resto é podado.

use chrono::{Datelike, Local, TimeZone};

/// Quantos backups manter em cada faixa.
pub const KEEP_DAILY: usize = 7;
pub const KEEP_WEEKLY: usize = 4;
pub const KEEP_MONTHLY: usize = 12;

/// O plano de poda: o que sobrevive e o que é apagado. Ambos em epoch-ms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionPlan {
    pub keep: Vec<i64>,
    pub delete: Vec<i64>,
}

/// As chaves de calendário de um instante, no fuso LOCAL.
///
/// Local e não UTC pelo mesmo motivo do resto do app: "o backup de que DIA é
/// este?" é uma pergunta sobre o dia do usuário (ver `Clock::today_local`).
struct CalKeys {
    day: i32,          // dias desde a época, no fuso local — chave de dia
    week: (i32, u32),  // (ano ISO, semana ISO)
    month: (i32, u32), // (ano, mês)
}

fn keys_for(ms: i64) -> Option<CalKeys> {
    let dt = Local.timestamp_millis_opt(ms).single()?;
    let date = dt.date_naive();
    let iso = date.iso_week();
    Some(CalKeys {
        day: date.num_days_from_ce(),
        week: (iso.year(), iso.week()),
        month: (date.year(), date.month()),
    })
}

/// Classifica os backups na política 7 diários / 4 semanais / 12 mensais.
///
/// Um carimbo que não converte para data local (relógio absurdo) é MANTIDO por
/// segurança: apagar um backup que não se consegue classificar é o erro que não
/// se desfaz — na dúvida, o backup fica.
pub fn retention_plan(stamps: &[i64]) -> RetentionPlan {
    let mut sorted: Vec<i64> = stamps.to_vec();
    // Do mais recente ao mais antigo. Estável para empates não trocarem de ordem.
    sorted.sort_by(|a, b| b.cmp(a));

    let mut last_day: Option<i32> = None;
    let mut last_week: Option<(i32, u32)> = None;
    let mut last_month: Option<(i32, u32)> = None;
    let (mut n_day, mut n_week, mut n_month) = (0usize, 0usize, 0usize);

    let mut keep = Vec::new();
    let mut delete = Vec::new();

    for ms in sorted {
        let Some(k) = keys_for(ms) else {
            keep.push(ms); // inclassificável → sobrevive
            continue;
        };

        let mut survive = false;

        if n_day < KEEP_DAILY && last_day != Some(k.day) {
            n_day += 1;
            last_day = Some(k.day);
            survive = true;
        }
        if n_week < KEEP_WEEKLY && last_week != Some(k.week) {
            n_week += 1;
            last_week = Some(k.week);
            survive = true;
        }
        if n_month < KEEP_MONTHLY && last_month != Some(k.month) {
            n_month += 1;
            last_month = Some(k.month);
            survive = true;
        }

        if survive {
            keep.push(ms);
        } else {
            delete.push(ms);
        }
    }

    RetentionPlan { keep, delete }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// Um instante às 10h locais de uma data — longe de qualquer borda de DST.
    fn at(y: i32, m: u32, d: u32) -> i64 {
        Local
            .with_ymd_and_hms(y, m, d, 10, 0, 0)
            .single()
            .expect("data de teste válida")
            .timestamp_millis()
    }

    fn at_hm(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .expect("data de teste válida")
            .timestamp_millis()
    }

    #[test]
    fn empty_is_empty() {
        let plan = retention_plan(&[]);
        assert!(plan.keep.is_empty());
        assert!(plan.delete.is_empty());
    }

    #[test]
    fn few_backups_all_survive() {
        // Três dias seguidos: cada um é o único do seu dia, ninguém é podado.
        let stamps = [at(2026, 7, 16), at(2026, 7, 17), at(2026, 7, 18)];
        let plan = retention_plan(&stamps);
        assert_eq!(plan.keep.len(), 3);
        assert!(plan.delete.is_empty());
    }

    #[test]
    fn two_on_the_same_day_keep_only_the_newest_for_the_daily_band() {
        // Dois no dia 18 (manhã e noite) e um no dia 17. O da noite do 18 é o
        // representante do dia; o da manhã do 18 cai na MESMA semana e mês, então
        // não ganha faixa nenhuma e é podado. O do dia 17 sobrevive (novo dia).
        let morning = at_hm(2026, 7, 18, 8, 0);
        let night = at_hm(2026, 7, 18, 22, 0);
        let prev = at(2026, 7, 17);
        let plan = retention_plan(&[morning, night, prev]);
        assert!(plan.keep.contains(&night), "o mais recente do dia fica");
        assert!(plan.keep.contains(&prev), "o dia anterior fica");
        assert!(
            plan.delete.contains(&morning),
            "o backup redundante do dia morre"
        );
    }

    #[test]
    fn the_correct_backup_survives_across_all_three_bands() {
        // 40 backups diários consecutivos. A política deve manter:
        //  - 7 diários (os 7 mais recentes),
        //  - + semanais para semanas ISO ainda não cobertas (até 4),
        //  - + mensais para meses ainda não cobertos (até 12).
        // O total fica bem abaixo de 40, e o MAIS RECENTE está sempre entre os
        // que ficam; o MAIS ANTIGO, entre os que morrem (há meses de sobra).
        let mut stamps = Vec::new();
        let start = chrono::NaiveDate::from_ymd_opt(2026, 6, 10).unwrap();
        for i in 0..40 {
            let d = start + chrono::Duration::days(i);
            stamps.push(
                Local
                    .with_ymd_and_hms(d.year(), d.month(), d.day(), 10, 0, 0)
                    .single()
                    .unwrap()
                    .timestamp_millis(),
            );
        }
        let newest = *stamps.iter().max().unwrap();
        let oldest = *stamps.iter().min().unwrap();

        let plan = retention_plan(&stamps);

        assert!(
            plan.keep.contains(&newest),
            "o backup de hoje NUNCA é podado"
        );
        assert!(plan.delete.contains(&oldest), "o mais antigo é podado");
        assert_eq!(
            plan.keep.len() + plan.delete.len(),
            40,
            "todo backup foi classificado exatamente uma vez"
        );
        // 7 diários distintos + até 4 semanais + até 12 mensais, com sobreposição.
        // Com 40 dias (~6 semanas, 2 meses) o teto real é 7 + (semanas extras) +
        // (1 mês extra). Fica confortavelmente abaixo de 40 e acima dos 7 diários.
        assert!(
            plan.keep.len() > KEEP_DAILY,
            "as faixas semanal/mensal ampliam além dos 7 diários"
        );
        assert!(plan.keep.len() < 20, "a poda de fato reduziu a coleção");
    }

    #[test]
    fn monthly_band_preserves_one_per_month_deep_into_the_past() {
        // Um backup por mês, 18 meses. Devem sobrar 12 (a faixa mensal), e os 6
        // mais antigos morrem.
        let mut stamps = Vec::new();
        for i in 0..18i64 {
            let base = chrono::NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
            let d = base
                .checked_add_months(chrono::Months::new(i as u32))
                .unwrap();
            stamps.push(
                Local
                    .with_ymd_and_hms(d.year(), d.month(), d.day(), 10, 0, 0)
                    .single()
                    .unwrap()
                    .timestamp_millis(),
            );
        }
        let plan = retention_plan(&stamps);
        // 12 mensais; os diários/semanais só reforçam os mais recentes (já contados).
        assert_eq!(plan.keep.len(), KEEP_MONTHLY, "sobram exatamente 12 meses");
        assert_eq!(plan.delete.len(), 6, "os 6 meses mais antigos são podados");
    }
}
