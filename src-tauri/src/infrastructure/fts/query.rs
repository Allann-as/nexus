//! Construção de queries FTS5 e geração de trechos.
//!
//! Funções puras, testáveis sem banco.

/// Comprimento alvo do trecho exibido na paleta.
const SNIPPET_LEN: usize = 140;

/// Traduz o que o usuário digitou numa expressão MATCH do FTS5.
///
/// A entrada é texto livre e NUNCA pode ser interpretada como sintaxe. Sem
/// tratamento, digitar `AND` viraria um operador, `*` um curinga, `"` um erro
/// de sintaxe e `foo:bar` um filtro de coluna — a busca quebraria enquanto a
/// pessoa digita.
///
/// Estratégia em dois passos:
///
/// 1. Tokeniza por `is_alphanumeric` (Unicode-aware: mantém 'saúde', 'ação').
///    Todo caractere de sintaxe do FTS5 some aqui, por construção.
/// 2. Aspas cada token — o que neutraliza as palavras-chave `AND`/`OR`/`NOT`/
///    `NEAR`, que sem aspas seriam operadores.
///
/// Cada token ganha `*` (prefixo), então a busca serve a "buscar enquanto
/// digita": 'reun' já encontra 'reunião'. Tokens juntos = AND implícito.
///
/// Devolve `None` quando não sobra nada para buscar.
pub fn build_match_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

/// Monta o trecho exibido, centrado na primeira ocorrência de um termo.
///
/// Cai para o título quando o node não tem corpo (tarefas, hábitos, itens de
/// inbox) — um trecho vazio seria pior que redundante.
pub fn make_snippet(body: &str, raw_query: &str, title: &str) -> String {
    let source = if body.trim().is_empty() { title } else { body };
    let flat = collapse_whitespace(source);

    if flat.is_empty() {
        return String::new();
    }

    let lower = flat.to_lowercase();
    let first_token = raw_query
        .split(|c: char| !c.is_alphanumeric())
        .find(|t| !t.is_empty())
        .map(str::to_lowercase);

    // Posição (em BYTES) da primeira ocorrência. Só é usada em fronteiras de
    // caractere abaixo, nunca para fatiar direto.
    let hit = first_token
        .as_deref()
        .and_then(|tok| lower.find(tok))
        .unwrap_or(0);

    // Recua ~1/3 da janela antes do termo para dar contexto ao redor dele.
    let start_byte = hit.saturating_sub(SNIPPET_LEN / 3);

    // Fatiar String por índice de byte entra em pânico se o índice cair no meio
    // de um caractere multibyte — e 'ç', 'ã', '—' são multibyte. Andar por
    // char_indices garante que só tocamos fronteiras válidas.
    let start = floor_char_boundary(&flat, start_byte);

    let mut out: String = flat[start..].chars().take(SNIPPET_LEN).collect();

    let truncated_right = flat[start..].chars().count() > SNIPPET_LEN;
    if truncated_right {
        out.push('…');
    }
    if start > 0 {
        out.insert(0, '…');
    }
    out
}

/// Maior fronteira de caractere <= `byte`.
fn floor_char_boundary(s: &str, byte: usize) -> usize {
    if byte >= s.len() {
        return s.len();
    }
    s.char_indices()
        .map(|(i, _)| i)
        .take_while(|&i| i <= byte)
        .last()
        .unwrap_or(0)
}

/// Achata quebras de linha e espaços repetidos: Markdown vira uma linha só.
fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_prefix_and_terms() {
        assert_eq!(build_match_query("reuniao").unwrap(), "\"reuniao\"*");
        assert_eq!(
            build_match_query("saude mental").unwrap(),
            "\"saude\"* \"mental\"*"
        );
    }

    #[test]
    fn keeps_accented_letters() {
        // 'saúde' precisa sobreviver à tokenização; quem tira o acento na
        // comparação é o remove_diacritics do FTS5, não nós.
        assert_eq!(build_match_query("saúde").unwrap(), "\"saúde\"*");
        assert_eq!(build_match_query("ação").unwrap(), "\"ação\"*");
    }

    #[test]
    fn empty_queries_return_none() {
        assert!(build_match_query("").is_none());
        assert!(build_match_query("   ").is_none());
        assert!(build_match_query("!!! ??? ...").is_none());
    }

    #[test]
    fn fts5_operators_are_neutralised() {
        // Nenhuma destas entradas pode virar sintaxe. Sem aspas, 'AND' seria
        // operador e 'foo:bar' um filtro de coluna.
        assert_eq!(build_match_query("AND").unwrap(), "\"AND\"*");
        assert_eq!(
            build_match_query("a OR b").unwrap(),
            "\"a\"* \"OR\"* \"b\"*"
        );
        assert_eq!(build_match_query("NEAR").unwrap(), "\"NEAR\"*");
        assert_eq!(build_match_query("foo:bar").unwrap(), "\"foo\"* \"bar\"*");
    }

    #[test]
    fn syntax_characters_are_stripped() {
        // Aspas e parênteses do usuário não podem escapar para dentro da query.
        let q = build_match_query("a\"b (c) * ^d -e").unwrap();
        assert_eq!(q, "\"a\"* \"b\"* \"c\"* \"d\"* \"e\"*");
        // Nenhuma aspa solta: toda aspa abre ou fecha um token.
        assert_eq!(q.matches('"').count() % 2, 0);
    }

    #[test]
    fn quote_injection_attempt_is_defused() {
        // Tentativa clássica de escapar do literal.
        let q = build_match_query("x\" OR title:\"y").unwrap();
        assert_eq!(q, "\"x\"* \"OR\"* \"title\"* \"y\"*");
    }

    #[test]
    fn snippet_falls_back_to_title_when_body_is_empty() {
        assert_eq!(make_snippet("", "x", "Comprar pão"), "Comprar pão");
        assert_eq!(make_snippet("   ", "x", "Comprar pão"), "Comprar pão");
    }

    #[test]
    fn snippet_collapses_markdown_whitespace() {
        let body = "linha um\n\n\nlinha    dois";
        assert_eq!(make_snippet(body, "linha", "t"), "linha um linha dois");
    }

    #[test]
    fn snippet_centres_on_the_match() {
        let body = format!("{} ALVO {}", "a".repeat(300), "b".repeat(300));
        let s = make_snippet(&body, "alvo", "t");
        assert!(s.contains("ALVO"), "o termo buscado precisa aparecer: {s}");
        assert!(
            s.starts_with('…'),
            "cortou à esquerda, precisa de reticências"
        );
        assert!(s.ends_with('…'), "cortou à direita, precisa de reticências");
    }

    #[test]
    fn snippet_never_splits_a_multibyte_char() {
        // Regressão: fatiar por byte no meio de 'ç'/'ã' entraria em pânico.
        // Corpo inteiro de multibyte, com o termo bem depois da janela.
        let body = format!("{}ALVO{}", "çãé—".repeat(80), "ü".repeat(80));
        let s = make_snippet(&body, "alvo", "t");
        assert!(s.contains("ALVO"));
        assert!(!s.is_empty());
    }

    #[test]
    fn snippet_handles_match_at_the_very_start() {
        let body = format!("ALVO {}", "z".repeat(400));
        let s = make_snippet(&body, "alvo", "t");
        assert!(s.starts_with("ALVO"), "sem corte à esquerda: {s}");
        assert!(s.ends_with('…'));
    }

    #[test]
    fn short_body_is_returned_whole() {
        let s = make_snippet("uma nota curta", "nota", "t");
        assert_eq!(s, "uma nota curta");
    }
}
