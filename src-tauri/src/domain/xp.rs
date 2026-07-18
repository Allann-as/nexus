//! XP e níveis — a gamificação, com a fórmula à mostra.
//!
//! XP **não é estado sagrado**. Ele é DERIVADO do que o usuário fez (ticks,
//! tarefas concluídas, checkpoints, livros terminados, temporadas vencidas) e é
//! recomputável a qualquer momento a partir do estado. Este módulo é só a
//! aritmética: quanto vale cada feito, e como XP vira nível. A atribuição por
//! Esfera (qual `area_id`) é do serviço; aqui é tudo puro e testável. Ver ADR-0037.
//!
//! Zero IA, zero caixa-preta: a tela de Gamificação mostra esta tabela e esta
//! curva. Um número que o usuário não consegue explicar é um número em que ele
//! não confia.

use serde::Serialize;

// ---------------------------------------------------------------------------
// A tabela de pontos. Documentada aqui e em `docs/DATA_MODEL.md` — uma fonte só.
//
// A escala é intencional: o gesto diário (um tick) vale pouco e soma pela
// repetição; o marco raro (terminar um livro, vencer uma temporada, bater uma
// meta anual) dá um salto que se sente. Um dia bom rende dezenas de XP; um ano
// de constância, milhares.
// ---------------------------------------------------------------------------

/// Um hábito cumprido no dia.
pub const XP_HABIT_DONE: u32 = 10;
/// Uma tarefa planejada concluída.
pub const XP_TASK_DONE: u32 = 15;
/// Um checkpoint registrado numa meta.
pub const XP_GOAL_CHECKPOINT: u32 = 20;
/// Um sub-desafio de meta concluído.
pub const XP_MILESTONE_DONE: u32 = 25;
/// Um livro terminado.
pub const XP_BOOK_FINISHED: u32 = 60;
/// Uma caixinha (objetivo financeiro) fechada.
pub const XP_FIN_GOAL_DONE: u32 = 80;
/// Uma temporada/desafio vencida.
pub const XP_CHALLENGE_DONE: u32 = 120;
/// Uma meta anual concluída — o feito mais alto do ano.
pub const XP_ANNUAL_GOAL_DONE: u32 = 200;

/// O custo, em XP, de ALCANÇAR um dado nível a partir do anterior.
///
/// Regra do arquiteto: **"nível n custa 100·n^1.5 XP"**. O nível 1 é o ponto de
/// partida (0 XP); subir para o nível `n` custa `100·n^1.5`. A curva é super-linear:
/// cada nível pede mais que o anterior, então os primeiros vêm rápido (o feedback
/// que engaja) e os altos viram conquista de longo prazo.
fn cost_to_reach(level: u32) -> u64 {
    if level <= 1 {
        return 0;
    }
    (100.0 * f64::from(level).powf(1.5)).round() as u64
}

/// O XP TOTAL acumulado necessário para SER de um dado nível — a soma dos custos
/// de todos os degraus até ele.
fn cumulative_for(level: u32) -> u64 {
    (2..=level).map(cost_to_reach).sum()
}

/// O nível e o progresso dentro dele, para um total de XP.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    /// O nível atual (começa em 1).
    pub level: u32,
    /// O XP total acumulado.
    pub xp: u64,
    /// O piso de XP deste nível (o total exigido para alcançá-lo).
    pub floor: u64,
    /// O total de XP que abre o PRÓXIMO nível.
    pub next_at: u64,
    /// XP já conquistado DENTRO do nível atual (`xp - floor`).
    pub into_level: u64,
    /// XP que este nível pede, do piso ao teto (`next_at - floor`).
    pub span: u64,
}

impl Level {
    /// 0.0..=1.0 — o quanto da barra do nível atual está preenchido.
    pub fn progress(&self) -> f64 {
        if self.span == 0 {
            return 0.0;
        }
        (self.into_level as f64 / self.span as f64).clamp(0.0, 1.0)
    }
}

/// Deriva o nível a partir do XP total.
///
/// Um laço, não uma fórmula fechada: a soma acumulada de `n^1.5` não inverte
/// bonito, e os níveis são poucos (décadas de constância mal passam de ~100).
/// Barato, exato e legível vale mais que uma inversão numérica frágil aqui.
pub fn level_from_xp(xp: u64) -> Level {
    let mut level: u32 = 1;
    // Enquanto o próximo degrau couber no XP, sobe. O teto de 10_000 é uma trava
    // de segurança contra laço infinito — inalcançável na vida real (seria XP na
    // casa dos bilhões).
    while level < 10_000 && cumulative_for(level + 1) <= xp {
        level += 1;
    }
    let floor = cumulative_for(level);
    let next_at = cumulative_for(level + 1);
    Level {
        level,
        xp,
        floor,
        next_at,
        into_level: xp - floor,
        span: next_at - floor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_xp_is_level_one() {
        let l = level_from_xp(0);
        assert_eq!(l.level, 1);
        assert_eq!(l.floor, 0);
        assert_eq!(l.into_level, 0);
        assert!((l.progress() - 0.0).abs() < 1e-9);
    }

    #[test]
    fn level_two_costs_exactly_the_formula() {
        // 100 * 2^1.5 = 282.84 -> 283 arredondado.
        let cost2 = cost_to_reach(2);
        assert_eq!(cost2, 283);
        // Um XP abaixo do custo ainda é nível 1; no custo, vira nível 2.
        assert_eq!(level_from_xp(cost2 - 1).level, 1);
        assert_eq!(level_from_xp(cost2).level, 2);
    }

    #[test]
    fn the_curve_is_superlinear() {
        // Cada degrau pede mais que o anterior.
        let mut prev = 0;
        for n in 2..=20 {
            let c = cost_to_reach(n);
            assert!(c > prev, "nível {n} devia custar mais que o anterior");
            prev = c;
        }
    }

    #[test]
    fn progress_is_the_fraction_into_the_level() {
        let floor2 = cumulative_for(2);
        let floor3 = cumulative_for(3);
        let mid = floor2 + (floor3 - floor2) / 2;
        let l = level_from_xp(mid);
        assert_eq!(l.level, 2);
        assert!((l.progress() - 0.5).abs() < 0.02, "meio nível ~= 0.5");
    }

    #[test]
    fn floor_and_ceiling_bracket_the_xp() {
        for xp in [0u64, 50, 283, 1000, 25_000, 1_000_000] {
            let l = level_from_xp(xp);
            assert!(l.floor <= xp, "o piso não passa do XP");
            assert!(l.next_at > xp, "o teto abre o próximo nível");
            assert_eq!(l.into_level, xp - l.floor);
        }
    }
}
