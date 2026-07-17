//! `[[wiki-links]]` — o parser puro dos elos entre notas (§2.5).
//!
//! Um `[[Título]]` no corpo de uma nota é um elo para o node de mesmo título. O
//! parser só EXTRAI os títulos; resolver título → id é do serviço (ele conhece o
//! banco). Puro e sem regex: varre o texto procurando os delimitadores, o que é
//! previsível e não arrasta uma engine de regex para o domínio.

/// Os títulos citados por `[[...]]` no corpo, sem duplicatas, na ordem em que
/// aparecem.
///
/// Regras deliberadas:
///   * `[[ ]]` vazio (ou só espaço) é ignorado — não é um elo.
///   * espaços nas bordas são aparados: `[[ Nota ]]` elos para "Nota".
///   * um `[[` sem o `]]` de fechamento não vira elo (texto inacabado enquanto
///     se digita não pode criar um elo fantasma).
///   * `]]` antes de qualquer `[[` é texto solto, ignorado.
pub fn extract(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;

    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            // Acha o `]]` de fechamento a partir daqui.
            if let Some(rel_end) = find_close(&body[i + 2..]) {
                let inner = &body[i + 2..i + 2 + rel_end];
                let title = inner.trim();
                if !title.is_empty() && !out.iter().any(|t| t == title) {
                    out.push(title.to_string());
                }
                i = i + 2 + rel_end + 2; // pula o fechamento
                continue;
            }
        }
        i += 1;
    }
    out
}

/// A posição do primeiro `]]` em `s`, se houver. Um `[[` no meio (elo aninhado)
/// não é suportado — o primeiro `]]` fecha, e é o que um humano espera.
fn find_close(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b']' && bytes[i + 1] == b']' {
            return Some(i);
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_titles() {
        assert_eq!(
            extract("veja [[Protocolo de sono]] e [[Academia]]"),
            vec!["Protocolo de sono", "Academia"]
        );
    }

    #[test]
    fn trims_and_dedupes() {
        assert_eq!(
            extract("[[ Nota ]] again [[Nota]]"),
            vec!["Nota"],
            "bordas aparadas e sem repetir o mesmo elo"
        );
    }

    #[test]
    fn ignores_empty_and_unclosed() {
        assert_eq!(extract("[[]] [[   ]] [[sem fim"), Vec::<String>::new());
    }

    #[test]
    fn plain_brackets_are_not_links() {
        assert_eq!(extract("um array[0] e [x] não são elos"), Vec::<String>::new());
    }

    #[test]
    fn a_title_with_accents_survives() {
        assert_eq!(extract("[[Saúde e ação]]"), vec!["Saúde e ação"]);
    }

    #[test]
    fn the_first_close_wins() {
        // "[[a]]b]]" → o elo é "a", e "b]]" é texto.
        assert_eq!(extract("[[a]]b]]"), vec!["a"]);
    }
}
