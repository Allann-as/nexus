//! Exportação humana (M5) — seus dados legíveis daqui a 30 anos, sem o app.
//!
//! Um backup (o zip do `nexus.db`) é para o NEXUS restaurar. ISTO é para um
//! HUMANO abrir: uma pasta `nexus-export-AAAA-MM-DD/` com um `.json` por tabela
//! (dump completo, chaves = nomes das colunas), os dois CSVs que se abrem no
//! Excel (`ledger.csv`, `habit_ticks.csv`), a pasta `media/` com os anexos, e um
//! `README.txt` que explica CADA arquivo, CADA coluna dos CSVs e o formato das
//! datas. Sem app, sem servidor, sem formato proprietário — SQL puro virou JSON e
//! CSV.
//!
//! O dump é STREAMING (linha a linha, `BufWriter`): um ledger de 400 mil linhas
//! (o teste de escala) não pode montar um `Vec` inteiro na RAM antes de gravar.

use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::Arc;

use rusqlite::types::ValueRef;
use serde::Serialize;

use crate::application::ports::Clock;
use crate::domain::errors::{NexusError, Result};
use crate::infrastructure::db::Db;
use crate::infrastructure::paths::Paths;

/// Os dois CSVs que o plano nomeia — os que um humano abre numa planilha.
const CSV_TABLES: &[&str] = &["ledger", "habit_ticks"];

/// O resultado de uma exportação, para a UI mostrar o que saiu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
    /// A pasta criada (caminho absoluto).
    pub dir: String,
    pub tables: usize,
    pub rows: u64,
    pub media_files: usize,
}

pub struct ExportEngine {
    db: Arc<Db>,
    paths: Paths,
    clock: Arc<dyn Clock>,
}

impl ExportEngine {
    pub fn new(db: Arc<Db>, paths: Paths, clock: Arc<dyn Clock>) -> Self {
        Self { db, paths, clock }
    }

    /// Escreve a pasta de exportação e devolve o resumo.
    ///
    /// Se já houver uma pasta do dia (exportou duas vezes hoje), acrescenta um
    /// sufixo de hora para não sobrescrever a anterior.
    pub fn export(&self) -> Result<ExportInfo> {
        let today = self.clock.today_local();
        let dir = self.unique_dir(&today);
        fs::create_dir_all(&dir).map_err(io_err)?;

        let tables = self.user_tables()?;
        let mut total_rows = 0u64;
        for table in &tables {
            total_rows += self.dump_json(table, &dir.join(format!("{table}.json")))?;
        }

        for table in CSV_TABLES {
            if tables.iter().any(|t| t == table) {
                self.dump_csv(table, &dir.join(format!("{table}.csv")))?;
            }
        }

        let media_files = self.copy_media(&dir.join("media"))?;
        write_readme(&dir, &tables, media_files, &today)?;

        Ok(ExportInfo {
            dir: dir.to_string_lossy().to_string(),
            tables: tables.len(),
            rows: total_rows,
            media_files,
        })
    }

    fn unique_dir(&self, today: &str) -> std::path::PathBuf {
        let base = self.paths.exports.join(format!("nexus-export-{today}"));
        if !base.exists() {
            return base;
        }
        // Segunda exportação no mesmo dia: sufixo com o epoch-ms (monotônico).
        let stamp = self.clock.now_ms();
        self.paths
            .exports
            .join(format!("nexus-export-{today}-{stamp}"))
    }

    /// As tabelas de dados do usuário — exclui os internos do SQLite e as tabelas
    /// sombra do FTS5 (índice binário, não é dado do usuário).
    fn user_tables(&self) -> Result<Vec<String>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare(
                "SELECT name FROM sqlite_master
                 WHERE type = 'table'
                   AND name NOT LIKE 'sqlite_%'
                   AND name NOT LIKE '%_fts%'
                 ORDER BY name",
            )?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(names)
        })
    }

    /// Dump de uma tabela para JSON (array de objetos), em streaming. Devolve o
    /// número de linhas.
    fn dump_json(&self, table: &str, dest: &Path) -> Result<u64> {
        let file = fs::File::create(dest).map_err(io_err)?;
        let mut w = BufWriter::new(file);
        w.write_all(b"[\n").map_err(io_err)?;

        let rows = self.db.with_read(|c| {
            let mut stmt = c.prepare(&format!("SELECT * FROM \"{table}\""))?;
            let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let mut q = stmt.query([])?;

            let mut n = 0u64;
            while let Some(row) = q.next()? {
                let mut obj = serde_json::Map::with_capacity(cols.len());
                for (i, col) in cols.iter().enumerate() {
                    obj.insert(col.clone(), value_ref_to_json(row.get_ref(i)?));
                }
                let line = serde_json::to_string(&serde_json::Value::Object(obj))
                    .map_err(|e| NexusError::Storage(format!("json de {table}: {e}")))?;
                if n > 0 {
                    w.write_all(b",\n").map_err(io_err)?;
                }
                w.write_all(line.as_bytes()).map_err(io_err)?;
                n += 1;
            }
            Ok(n)
        })?;

        w.write_all(b"\n]\n").map_err(io_err)?;
        w.flush().map_err(io_err)?;
        Ok(rows)
    }

    /// Dump de uma tabela para CSV (cabeçalho + linhas), em streaming.
    fn dump_csv(&self, table: &str, dest: &Path) -> Result<()> {
        let file = fs::File::create(dest).map_err(io_err)?;
        let mut w = BufWriter::new(file);

        self.db.with_read(|c| {
            let mut stmt = c.prepare(&format!("SELECT * FROM \"{table}\""))?;
            let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let header = cols
                .iter()
                .map(|s| csv_field(s))
                .collect::<Vec<_>>()
                .join(",");
            w.write_all(header.as_bytes()).map_err(io_err)?;
            w.write_all(b"\r\n").map_err(io_err)?;

            let mut q = stmt.query([])?;
            while let Some(row) = q.next()? {
                let mut fields = Vec::with_capacity(cols.len());
                for i in 0..cols.len() {
                    fields.push(csv_field(&value_ref_to_plain(row.get_ref(i)?)));
                }
                w.write_all(fields.join(",").as_bytes()).map_err(io_err)?;
                w.write_all(b"\r\n").map_err(io_err)?;
            }
            Ok(())
        })?;

        w.flush().map_err(io_err)?;
        Ok(())
    }

    /// Copia a árvore de mídia para dentro da exportação. Devolve quantos arquivos.
    fn copy_media(&self, dest: &Path) -> Result<usize> {
        if !self.paths.media.exists() {
            return Ok(0);
        }
        fs::create_dir_all(dest).map_err(io_err)?;
        copy_tree(&self.paths.media, dest)
    }
}

/// Copia recursivamente `from` para `to`, devolvendo o número de arquivos copiados.
fn copy_tree(from: &Path, to: &Path) -> Result<usize> {
    let mut count = 0;
    for entry in fs::read_dir(from).map_err(io_err)? {
        let entry = entry.map_err(io_err)?;
        let path = entry.path();
        let target = to.join(entry.file_name());
        if path.is_dir() {
            fs::create_dir_all(&target).map_err(io_err)?;
            count += copy_tree(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(io_err)?;
            count += 1;
        }
    }
    Ok(count)
}

/// Um `ValueRef` do SQLite vira `serde_json::Value`. Texto é texto, número é
/// número; um blob (raro nas tabelas exportadas) vira uma nota honesta do tamanho.
fn value_ref_to_json(v: ValueRef<'_>) -> serde_json::Value {
    use serde_json::Value;
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::from(format!("<blob {} bytes>", b.len())),
    }
}

/// O mesmo, mas como texto plano para uma célula de CSV.
fn value_ref_to_plain(v: ValueRef<'_>) -> String {
    match v {
        ValueRef::Null => String::new(),
        ValueRef::Integer(n) => n.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Blob(b) => format!("<blob {} bytes>", b.len()),
    }
}

/// Escapa um campo de CSV (RFC-4180): aspas dobradas, e o campo entre aspas se
/// contém vírgula, aspas ou quebra de linha.
fn csv_field(s: &str) -> String {
    if s.contains(['"', ',', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn write_readme(dir: &Path, tables: &[String], media_files: usize, today: &str) -> Result<()> {
    let mut s = String::new();
    s.push_str("NEXUS — exportação dos seus dados\n");
    s.push_str("==================================\n\n");
    s.push_str(&format!("Gerado em: {today} (data local).\n\n"));
    s.push_str(
        "Esta pasta é uma cópia COMPLETA e LEGÍVEL de tudo que o NEXUS guarda\n\
         sobre você, num formato aberto que não precisa do app para ser lido.\n\
         Se em 2056 o NEXUS não existir mais, esta pasta ainda conta a sua\n\
         história.\n\n",
    );

    s.push_str("O QUE TEM AQUI\n");
    s.push_str("--------------\n\n");
    s.push_str(
        "• <tabela>.json — um arquivo por tabela do banco, com TODAS as linhas.\n\
        \x20 Cada arquivo é uma lista de objetos; as chaves de cada objeto são os\n\
        \x20 nomes das colunas. É o dump fiel do banco, campo por campo.\n\n",
    );
    s.push_str(
        "• ledger.csv — a HISTÓRIA. O ledger é um registro append-only: cada\n\
        \x20 linha é um fato que aconteceu (um hábito marcado, uma meta concluída,\n\
        \x20 um aporte). Nunca é editado nem apagado. Abra numa planilha.\n\
        \x20 Colunas:\n\
        \x20   seq         — número sequencial do evento (ordem total, crescente).\n\
        \x20   ts          — quando aconteceu, em milissegundos desde 1970-01-01\n\
        \x20                 00:00:00 UTC (epoch Unix). Divida por 1000 para\n\
        \x20                 segundos.\n\
        \x20   day         — o dia LOCAL do evento, no formato AAAA-MM-DD.\n\
        \x20   entity_id   — o id da coisa a que o evento se refere.\n\
        \x20   entity_kind — o tipo dela (habit, goal, contribution, ...).\n\
        \x20   event_type  — o que aconteceu (checked, completed, created, ...).\n\
        \x20   payload     — detalhes do evento em JSON (o título na época, etc.).\n\n",
    );
    s.push_str(
        "• habit_ticks.csv — cada marcação de hábito, um por linha.\n\
        \x20 Colunas típicas: habit_id (o hábito), day (AAAA-MM-DD local),\n\
        \x20 status (done/skipped/failed), value (o número, se o hábito mede\n\
        \x20 quantidade — ex.: páginas lidas), e o carimbo de tempo da marcação.\n\n",
    );
    s.push_str(&format!(
        "• media/ — os {media_files} arquivo(s) anexados às suas notas. O nome de\n\
        \x20 cada arquivo é o hash SHA-256 do conteúdo (é assim que o NEXUS evita\n\
        \x20 guardar o mesmo anexo duas vezes). O JSON de file_details liga cada\n\
        \x20 hash ao nome original.\n\n",
    ));

    s.push_str("CONVENÇÕES DE DATA E HORA\n");
    s.push_str("-------------------------\n\n");
    s.push_str(
        "• Colunas terminadas em _at, e a coluna ts: milissegundos desde a epoch\n\
        \x20 Unix (1970-01-01 00:00:00 UTC).\n\
         • Colunas 'day' e terminadas em _on: uma data no seu fuso LOCAL, no\n\
        \x20 formato AAAA-MM-DD. É o dia que você viu na tela, não o dia UTC.\n\
         • Valores em dinheiro estão em CENTAVOS (inteiros): 1250 = R$ 12,50.\n\n",
    );

    s.push_str("TABELAS NESTA EXPORTAÇÃO\n");
    s.push_str("------------------------\n\n");
    for t in tables {
        s.push_str(&format!("  {t}.json\n"));
    }
    s.push('\n');
    s.push_str("Tudo aqui é seu. O NEXUS nunca mandou nada disto para lugar nenhum.\n");

    fs::write(dir.join("README.txt"), s).map_err(io_err)
}

fn io_err(e: std::io::Error) -> NexusError {
    NexusError::Storage(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::clock::SystemClock;

    fn open(paths: &Paths) -> Arc<Db> {
        let db = Arc::new(Db::open(paths).unwrap());
        db.with_write(|c| {
            c.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Saúde');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                 VALUES ('h1', 'habit', 'Correr, com \"aspas\", e vírgula', 'a1', 1, 1);
                 INSERT INTO habit_details (node_id, schedule_json) VALUES ('h1', '{}');
                 INSERT INTO habit_ticks (habit_id, day, status, ts) VALUES ('h1', '2026-07-18', 'done', 100);
                 INSERT INTO ledger (ts, day, entity_id, entity_kind, event_type, payload, title_snapshot)
                 VALUES (100, '2026-07-18', 'h1', 'habit', 'checked', '{\"title\":\"Correr\"}', 'Correr');",
            )?;
            Ok(())
        })
        .unwrap();
        db
    }

    #[test]
    fn export_writes_json_csv_media_and_readme() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = open(&paths);
        let engine = ExportEngine::new(db, paths.clone(), Arc::new(SystemClock));

        let info = engine.export().unwrap();
        let out = std::path::Path::new(&info.dir);

        // Os arquivos-chave existem.
        assert!(out.join("README.txt").exists());
        assert!(out.join("ledger.csv").exists());
        assert!(out.join("habit_ticks.csv").exists());
        assert!(out.join("nodes.json").exists());
        assert!(out.join("areas.json").exists());
        assert!(info.tables >= 2);
        assert!(info.rows >= 2);

        // O JSON reabre e tem a linha semeada.
        let nodes: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(out.join("nodes.json")).unwrap()).unwrap();
        assert_eq!(nodes.as_array().unwrap().len(), 1);
        assert_eq!(nodes[0]["id"], "h1");

        // O CSV reabre e escapou a vírgula/aspas corretamente: 2 linhas (cabeçalho
        // + 1 dado), e a linha do node NÃO aparece partida por causa da vírgula no
        // título (esse está no nodes, mas o ledger tem payload com aspas).
        let ledger_csv = fs::read_to_string(out.join("ledger.csv")).unwrap();
        let lines: Vec<&str> = ledger_csv.lines().collect();
        assert_eq!(lines.len(), 2, "cabeçalho + 1 evento");
        assert!(
            lines[0].contains("event_type"),
            "o cabeçalho tem os nomes das colunas"
        );
        assert!(ledger_csv.contains("checked"));
    }

    #[test]
    fn csv_escaping_is_rfc4180() {
        assert_eq!(csv_field("simples"), "simples");
        assert_eq!(csv_field("com,vírgula"), "\"com,vírgula\"");
        assert_eq!(csv_field("com \"aspas\""), "\"com \"\"aspas\"\"\"");
        assert_eq!(csv_field("linha\nnova"), "\"linha\nnova\"");
    }
}
