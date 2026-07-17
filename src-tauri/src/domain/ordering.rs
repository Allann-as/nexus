//! A ordem de uma lista que o usuário arrasta.
//!
//! Uma lista ordenada à mão pode guardar a posição de dois jeitos: um índice
//! inteiro por linha, ou uma coordenada esparsa. Com índice, mover o item 40
//! para a posição 2 reescreve 38 linhas — e o NEXUS tem listas que vivem
//! décadas. Com coordenada, mover é UM update de UMA linha: a nova posição é a
//! média dos vizinhos. Ver ADR-0015.
//!
//! Este módulo é a aritmética disso, e nada além: sem banco, sem port, sem
//! saber se o que se arrasta é uma tarefa ou um sub-desafio. Ele nasceu dentro
//! do `TaskService` (M2) e saiu para cá quando os sub-desafios (M3) precisaram
//! da mesma conta — duas cópias divergiriam no dia em que só uma fosse
//! corrigida, e a que divergisse embaralharia a lista de alguém.

/// Abaixo desta distância entre vizinhos, a média começa a perder precisão no
/// double e é hora de reespaçar. ~50 inserções sucessivas no mesmo ponto.
pub const MIN_GAP: f64 = 1e-6;

/// A coordenada que põe um item entre `before` e `after`.
///
/// `None` significa "os vizinhos estão perto demais": quem chama reespaça a
/// lista e pergunta de novo. É `None` e não um valor qualquer porque só o
/// chamador tem o port para reespaçar — o domínio não fala com o banco.
pub fn order_between(before: Option<f64>, after: Option<f64>) -> Option<f64> {
    match (before, after) {
        // Lista vazia: o primeiro item pode ser qualquer coisa, e 0 é a origem.
        (None, None) => Some(0.0),
        // Para o topo e para o fim a média não serve: não há dos dois lados.
        // Um passo de 1.0 mantém a folga que a média consome.
        (None, Some(first)) => Some(first - 1.0),
        (Some(last), None) => Some(last + 1.0),
        (Some(a), Some(b)) if (b - a).abs() < MIN_GAP => None,
        (Some(a), Some(b)) => Some(a + (b - a) / 2.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_middle_of_two_neighbours_is_between_them() {
        assert_eq!(order_between(Some(1.0), Some(2.0)), Some(1.5));
        assert_eq!(order_between(Some(0.0), Some(1.0)), Some(0.5));
    }

    #[test]
    fn the_edges_step_by_one_instead_of_averaging() {
        assert_eq!(order_between(None, Some(5.0)), Some(4.0), "para o topo");
        assert_eq!(order_between(Some(5.0), None), Some(6.0), "para o fim");
        assert_eq!(order_between(None, None), Some(0.0), "lista vazia");
    }

    #[test]
    fn negative_coordinates_are_ordinary() {
        // Arrastar para o topo repetidamente anda para o negativo, e isso é
        // normal: a coordenada não é um índice, e nada nela promete ser >= 0.
        assert_eq!(order_between(None, Some(-3.0)), Some(-4.0));
        assert_eq!(order_between(Some(-2.0), Some(-1.0)), Some(-1.5));
    }

    #[test]
    fn neighbours_too_close_ask_for_a_renumber_instead_of_lying() {
        // O ponto do MIN_GAP: a média de dois doubles vizinhos demais VOLTA um
        // deles. O item ficaria com a ordem exata do vizinho, e o desempate
        // passaria a ser o id — a lista embaralharia sozinha na próxima leitura.
        assert_eq!(order_between(Some(1.0), Some(1.0 + 1e-9)), None);
        assert_eq!(order_between(Some(1.0), Some(1.0)), None, "iguais");
    }

    #[test]
    fn the_midpoint_never_lands_on_a_neighbour_while_the_gap_is_wide_enough() {
        // Acima do limiar, a média tem que ser estritamente maior que `a` e
        // menor que `b`. `a + (b - a) / 2` e não `(a + b) / 2`: a segunda forma
        // estoura para o infinito quando `a` e `b` são grandes e do mesmo sinal,
        // e o item sumiria para o fim da lista.
        //
        // Os casos ficam uma ordem de grandeza ACIMA do MIN_GAP de propósito.
        // Encostar no limiar exato não testa nada: `1.0 + 1e-6` arredonda para
        // um vizinho a MENOS de 1e-6 de distância, e o `None` que sai dali é a
        // resposta certa para uma pergunta que ninguém quis fazer.
        let cases = [
            (1.0, 1.0 + 10.0 * MIN_GAP),
            (0.0, MIN_GAP),
            (1e15, 1e15 + 1.0),
        ];
        for (a, b) in cases {
            let mid = order_between(Some(a), Some(b)).expect("a folga é suficiente");
            assert!(mid > a && mid < b, "{mid} não caiu entre {a} e {b}");
        }
    }
}
