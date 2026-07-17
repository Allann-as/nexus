//! Commands da Biblioteca e do painel de Estudos.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::Book;
use crate::application::use_cases::books::StudiesOverview;
use crate::domain::entities::BookStatus;
use crate::domain::errors::Result;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBookDto {
    pub title: String,
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub total_pages: Option<i64>,
    #[serde(default)]
    pub shelf: Option<String>,
}

#[tauri::command]
pub fn create_book(state: State<'_, AppState>, book: NewBookDto) -> Result<Book> {
    state.books.create(
        &book.title,
        book.area_id,
        book.author,
        book.total_pages,
        book.shelf,
    )
}

#[tauri::command]
pub fn list_books(state: State<'_, AppState>, area_id: Option<String>) -> Result<Vec<Book>> {
    state.books.list(area_id.as_deref())
}

#[tauri::command]
pub fn set_book_progress(
    state: State<'_, AppState>,
    id: String,
    current_page: i64,
) -> Result<Book> {
    state.books.set_progress(&id, current_page)
}

#[tauri::command]
pub fn set_book_status(state: State<'_, AppState>, id: String, status: BookStatus) -> Result<Book> {
    state.books.set_status(&id, status)
}

#[tauri::command]
pub fn set_book_shelf(
    state: State<'_, AppState>,
    id: String,
    shelf: Option<String>,
) -> Result<Book> {
    state.books.set_shelf(&id, shelf)
}

#[tauri::command]
pub fn set_book_rating(
    state: State<'_, AppState>,
    id: String,
    rating: Option<i64>,
) -> Result<Book> {
    state.books.set_rating(&id, rating)
}

#[tauri::command]
pub fn finish_book(
    state: State<'_, AppState>,
    id: String,
    rating: Option<i64>,
    review: Option<String>,
) -> Result<Book> {
    state.books.finish(&id, rating, review)
}

#[tauri::command]
pub fn studies_overview(
    state: State<'_, AppState>,
    area_id: Option<String>,
) -> Result<StudiesOverview> {
    state.books.studies_overview(area_id.as_deref())
}

#[tauri::command]
pub fn set_reading_goal(state: State<'_, AppState>, target: i64) -> Result<()> {
    state.books.set_reading_goal(target)
}
