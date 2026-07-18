//! Casos de uso da Biblioteca e do painel de Estudos.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Book, BookPatch, BookRepository, Clock, IdGen, NewBook, NewNode, ReviewNote,
};
use crate::domain::entities::{validate_title, BookStatus, Kind, Status};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::parse_day;

/// O painel da Esfera Estudos: o que estou lendo, a meta anual, a estante.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudiesOverview {
    /// 'YYYY' do ano corrente.
    pub year: String,
    /// A meta de livros no ano, se definida.
    pub reading_goal: Option<i64>,
    /// Livros marcados 'lido' neste ano.
    pub finished_this_year: i64,
    /// O que está sendo lido agora (status 'lendo'), com o % de páginas.
    pub reading_now: Vec<Book>,
    /// Total de livros na estante (não arquivados).
    pub total_books: i64,
}

/// As estatísticas de leitura (M4.6, item 7) — funções puras do estado dos livros,
/// recomputadas, nunca gravadas (mesma filosofia da Saúde Financeira, ADR-0028).
/// Cada número traz a fórmula à mostra (constituição §2); `None` quando falta dado.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStats {
    pub year: String,
    /// Livros marcados 'lido' neste ano.
    pub books_finished_year: i64,
    /// Páginas dos livros terminados neste ano (só os com contagem de páginas).
    pub pages_this_year: i64,
    /// `pages_this_year / dias decorridos no ano`, ou `None` sem páginas.
    pub pages_per_day: Option<f64>,
    /// Média de dias entre começar e terminar um livro — só os com as duas datas.
    pub avg_days_to_finish: Option<f64>,
    /// Quantos livros entraram na média (têm início e fim) — o tamanho da amostra.
    pub sample_size: i64,
    pub formula: String,
}

pub struct BookService {
    pub books: Arc<dyn BookRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl BookService {
    pub fn create(
        &self,
        title: &str,
        area_id: Option<String>,
        author: Option<String>,
        total_pages: Option<i64>,
        shelf: Option<String>,
    ) -> Result<Book> {
        let title = validate_title(title)?;
        if let Some(p) = total_pages {
            if p <= 0 {
                return Err(NexusError::Validation(
                    "o número de páginas precisa ser positivo".into(),
                ));
            }
        }
        if let Some(ref a) = area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a} não existe")));
            }
        }

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::Book),
            event_type: EventType::Created,
            payload: json!({ "shelf": shelf }),
            title_snapshot: title.clone(),
        };

        self.books.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Book,
                title: title.clone(),
                area_id: area_id.clone(),
                parent_id: None,
            },
            &NewBook {
                title,
                area_id,
                author,
                total_pages,
                shelf,
            },
            &event,
        )
    }

    pub fn list(&self, area_id: Option<&str>) -> Result<Vec<Book>> {
        self.books.list(area_id)
    }

    /// Atualiza a página atual. Um livro na fila que ganha páginas vira 'lendo'
    /// e registra o dia em que começou.
    pub fn set_progress(&self, id: &str, current_page: i64) -> Result<Book> {
        let book = self.books.get(id)?;
        let page = current_page.max(0);
        let mut patch = BookPatch {
            current_page: Some(page),
            ..Default::default()
        };
        if book.status == BookStatus::Fila && page > 0 {
            patch.status = Some(BookStatus::Lendo);
            if book.started_on.is_none() {
                patch.started_on = Some(Some(self.clock.today_local()));
            }
        }
        self.books.update(id, &patch)
    }

    /// Muda o status de leitura à mão. 'lido' passa pelo fluxo de terminar (que
    /// grava a conquista), então aqui só tratamos fila/lendo/abandonado.
    pub fn set_status(&self, id: &str, status: BookStatus) -> Result<Book> {
        if status == BookStatus::Lido {
            return self.finish(id, None, None);
        }
        let book = self.books.get(id)?;
        let node_status = match status {
            BookStatus::Abandonado => Status::Dropped,
            _ => Status::Active,
        };
        let mut patch = BookPatch {
            status: Some(status),
            node_status: Some(node_status),
            ..Default::default()
        };
        if status == BookStatus::Lendo && book.started_on.is_none() {
            patch.started_on = Some(Some(self.clock.today_local()));
        }
        self.books.update(id, &patch)
    }

    pub fn set_shelf(&self, id: &str, shelf: Option<String>) -> Result<Book> {
        self.books.update(
            id,
            &BookPatch {
                shelf: Some(shelf),
                ..Default::default()
            },
        )
    }

    pub fn set_rating(&self, id: &str, rating: Option<i64>) -> Result<Book> {
        validate_rating(rating)?;
        self.books.update(
            id,
            &BookPatch {
                rating: Some(rating),
                ..Default::default()
            },
        )
    }

    /// Termina o livro: 'lido', nota, conquista no ledger, e a resenha (se dada)
    /// vira uma nota linkada (§2.2).
    pub fn finish(&self, id: &str, rating: Option<i64>, review: Option<String>) -> Result<Book> {
        validate_rating(rating)?;
        let book = self.books.get(id)?;
        let now = self.clock.now_ms();
        let today = self.clock.today_local();

        let stars = rating.map(|r| format!(" ({r}/5)")).unwrap_or_default();
        let completion = NewLedgerEvent {
            ts: now,
            day: today.clone(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Book),
            event_type: EventType::Completed,
            payload: json!({
                "achievement": "book_finished",
                "rating": rating,
            }),
            title_snapshot: format!("Terminou \"{}\"{stars}", book.title),
        };

        let review_note = review
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
            .map(|body| {
                let note_id = self.ids.new_id();
                let title = format!("Resenha: {}", book.title);
                ReviewNote {
                    event: NewLedgerEvent {
                        ts: now,
                        day: today.clone(),
                        entity_id: note_id.clone(),
                        entity_kind: LedgerEntityKind::Node(Kind::Note),
                        event_type: EventType::Created,
                        payload: json!({ "reviewOf": id }),
                        title_snapshot: title.clone(),
                    },
                    note_id,
                    title,
                    body_md: body,
                }
            });

        self.books
            .finish_with_event(id, rating, &today, now, &completion, review_note.as_ref())
    }

    /// O painel de Estudos.
    pub fn studies_overview(&self, area_id: Option<&str>) -> Result<StudiesOverview> {
        let year = self.clock.today_local()[..4].to_string();
        let all = self.books.list(area_id)?;
        let reading_now: Vec<Book> = all
            .iter()
            .filter(|b| b.status == BookStatus::Lendo)
            .cloned()
            .collect();

        Ok(StudiesOverview {
            reading_goal: self.books.reading_goal(&year)?,
            finished_this_year: self.books.finished_in_year(&year)?,
            reading_now,
            total_books: all.len() as i64,
            year,
        })
    }

    /// As estatísticas de leitura da Esfera Estudos (item 7): ritmo e tempo médio.
    pub fn reading_stats(&self, area_id: Option<&str>) -> Result<ReadingStats> {
        let today = parse_day(&self.clock.today_local())?;
        let year = self.clock.today_local()[..4].to_string();
        // Dias decorridos no ano: o ordinal de hoje (1 em 1º de janeiro).
        let days_elapsed = chrono::Datelike::ordinal(&today) as i64;
        let books = self.books.list(area_id)?;

        let finished_this_year: Vec<&Book> = books
            .iter()
            .filter(|b| b.status == BookStatus::Lido)
            .filter(|b| b.finished_on.as_deref().map(|d| d.starts_with(&year)) == Some(true))
            .collect();

        let books_finished_year = finished_this_year.len() as i64;
        let pages_this_year: i64 = finished_this_year
            .iter()
            .filter_map(|b| b.total_pages)
            .filter(|p| *p > 0)
            .sum();
        let pages_per_day = if pages_this_year > 0 && days_elapsed > 0 {
            Some(pages_this_year as f64 / days_elapsed as f64)
        } else {
            None
        };

        // Média de dias para terminar: só livros com início E fim registrados.
        let spans: Vec<i64> = books
            .iter()
            .filter(|b| b.status == BookStatus::Lido)
            .filter_map(|b| {
                let sd = parse_day(b.started_on.as_deref()?).ok()?;
                let fd = parse_day(b.finished_on.as_deref()?).ok()?;
                let days = (fd - sd).num_days();
                (days >= 0).then_some(days)
            })
            .collect();
        let sample_size = spans.len() as i64;
        let avg_days_to_finish =
            (sample_size > 0).then(|| spans.iter().sum::<i64>() as f64 / sample_size as f64);

        Ok(ReadingStats {
            books_finished_year,
            pages_this_year,
            pages_per_day,
            avg_days_to_finish,
            sample_size,
            formula: format!(
                "Páginas/dia = páginas dos livros terminados em {year} ÷ {days_elapsed} dias \
                 decorridos no ano. Tempo médio para terminar = média de (dia que terminou − \
                 dia que começou) sobre {sample_size} livro(s) com as duas datas."
            ),
            year,
        })
    }

    pub fn set_reading_goal(&self, target: i64) -> Result<()> {
        if target <= 0 {
            return Err(NexusError::Validation(
                "a meta de leitura precisa ser positiva".into(),
            ));
        }
        let year = self.clock.today_local()[..4].to_string();
        self.books
            .set_reading_goal(&year, target, self.clock.now_ms())
    }
}

fn validate_rating(rating: Option<i64>) -> Result<()> {
    if let Some(r) = rating {
        if !(0..=5).contains(&r) {
            return Err(NexusError::Validation(format!(
                "nota inválida: {r} (esperado 0..=5 estrelas)"
            )));
        }
    }
    Ok(())
}
