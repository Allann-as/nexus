//! O motor de backup (M5) — o adaptador de storage do "seus dados estão a salvo".
//!
//! Vive na infraestrutura, ao lado do `Db`, porque é fundamentalmente sobre o
//! MOTOR: um snapshot consistente vem de `VACUUM INTO`, a validação de um backup
//! vem de `PRAGMA quick_check`, e a restauração é uma troca de arquivo no disco.
//! A POLÍTICA de retenção, essa sim, é pura e mora no domínio
//! (`domain::backup::retention_plan`) — aqui só se lê a pasta e se apaga o que ela
//! condena.
//!
//! Regra de ouro do M5 (o arquiteto foi explícito): **um backup só existe se a
//! restauração funciona.** Por isso o par `create`/`restore_from_zip` é coberto
//! por um teste de CICLO COMPLETO (`tests/backup.rs`): backup → corromper →
//! restaurar → quick_check → dados idênticos. Backup sem teste de restore é teatro.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::Arc;

use chrono::{Local, TimeZone};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use zip::write::SimpleFileOptions;
use zip::{AesMode, CompressionMethod, ZipArchive, ZipWriter};

use crate::application::ports::Clock;
use crate::domain::backup::retention_plan;
use crate::domain::errors::{NexusError, Result};
use crate::infrastructure::db::Db;
use crate::infrastructure::paths::Paths;

/// O nome do banco dentro do zip. Fixo: o restore procura exatamente por ele.
const ENTRY: &str = "nexus.db";

/// O que a UI mostra sobre um backup — sem abrir o zip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub created_at_ms: i64,
    pub size_bytes: u64,
}

/// O motor: cria snapshots, lista, poda e restaura.
pub struct BackupEngine {
    db: Arc<Db>,
    paths: Paths,
    clock: Arc<dyn Clock>,
}

impl BackupEngine {
    pub fn new(db: Arc<Db>, paths: Paths, clock: Arc<dyn Clock>) -> Self {
        Self { db, paths, clock }
    }

    /// Um snapshot consistente do banco vivo, empacotado num zip (AES-256 se
    /// `password`), seguido da poda por retenção. Não fecha o app: `VACUUM INTO`
    /// escreve um arquivo novo a partir de uma leitura transacionalmente
    /// consistente, sem tocar o banco em uso.
    ///
    /// Devolve o backup recém-criado. A poda roda DEPOIS de gravar: o novo
    /// snapshot já conta para a faixa "diária" da política.
    pub fn create(&self, password: Option<&str>) -> Result<BackupInfo> {
        let now_ms = self.clock.now_ms();
        let stamp = Local
            .timestamp_millis_opt(now_ms)
            .single()
            .ok_or_else(|| NexusError::Storage("relógio inválido para nomear o backup".into()))?;
        let name = format!("nexus-{}.zip", stamp.format("%Y%m%d-%H%M%S"));
        let dest = self.paths.backups.join(&name);

        // O snapshot cru vai para um temp; VACUUM INTO exige um destino que ainda
        // não existe. O caminho é literal e app-controlado, mas escapamos a aspa
        // simples por higiene (VACUUM INTO não aceita bind de parâmetro em toda
        // versão, então formatamos com cuidado).
        let snap = self.paths.backups.join(".snapshot.tmp");
        let _ = fs::remove_file(&snap);
        let snap_lit = snap.to_string_lossy().replace('\'', "''");
        self.db.with_write(|c| {
            c.execute_batch(&format!("VACUUM main INTO '{snap_lit}'"))?;
            Ok(())
        })?;

        // Zipa e, aconteça o que acontecer, remove o snapshot cru — ele nunca deve
        // ficar largado em claro ao lado do zip cifrado.
        let zipped = self.zip_snapshot(&snap, &dest, password);
        let _ = fs::remove_file(&snap);
        zipped?;

        self.prune()?;

        let size_bytes = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        Ok(BackupInfo {
            name,
            created_at_ms: now_ms,
            size_bytes,
        })
    }

    /// Os backups na pasta, do mais recente ao mais antigo.
    pub fn list(&self) -> Result<Vec<BackupInfo>> {
        let mut out = Vec::new();
        let dir = match fs::read_dir(&self.paths.backups) {
            Ok(d) => d,
            Err(_) => return Ok(out), // pasta ainda não existe = nenhum backup
        };
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(created_at_ms) = parse_stamp(&name) else {
                continue; // ignora .snapshot.tmp e qualquer coisa fora do padrão
            };
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(BackupInfo {
                name,
                created_at_ms,
                size_bytes,
            });
        }
        out.sort_by_key(|i| std::cmp::Reverse(i.created_at_ms));
        Ok(out)
    }

    /// Aplica a política de retenção (7 diários / 4 semanais / 12 mensais).
    /// Devolve quantos backups foram apagados.
    pub fn prune(&self) -> Result<usize> {
        let infos = self.list()?;
        let stamps: Vec<i64> = infos.iter().map(|i| i.created_at_ms).collect();
        let plan = retention_plan(&stamps);

        let mut removed = 0;
        for info in &infos {
            if plan.delete.contains(&info.created_at_ms)
                && fs::remove_file(self.paths.backups.join(&info.name)).is_ok()
            {
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn zip_snapshot(&self, snap: &Path, dest: &Path, password: Option<&str>) -> Result<()> {
        let file = fs::File::create(dest).map_err(io_err)?;
        let mut zip = ZipWriter::new(file);

        let mut opts = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            // Um banco de anos pode passar de 4 GB; o cabeçalho Zip64 evita o teto.
            .large_file(true);
        if let Some(pw) = password {
            opts = opts.with_aes_encryption(AesMode::Aes256, pw);
        }

        zip.start_file(ENTRY, opts).map_err(zip_err)?;
        let mut reader = fs::File::open(snap).map_err(io_err)?;
        io::copy(&mut reader, &mut zip).map_err(io_err)?;
        zip.finish().map_err(zip_err)?;
        Ok(())
    }
}

/// Restaura um backup POR CIMA do banco vivo — a operação que prova que o backup
/// vale alguma coisa.
///
/// Função livre (sem `&self`) de propósito: a troca de arquivo não pode acontecer
/// enquanto uma conexão segura o `nexus.db` (o Windows tranca arquivos abertos).
/// Quem chama garante que o `Db` já foi liberado — no teste, o handle sai de
/// escopo antes; no app, o restauro é APLICADO NO BOOT, antes de o `Db` abrir
/// (chega no wire da UI, commit seguinte).
///
/// Segurança acima de tudo: o banco vivo só é tocado DEPOIS de o snapshot extraído
/// passar no `quick_check`. Um zip corrompido ou uma senha errada aborta com o
/// banco original intacto.
pub fn restore_from_zip(paths: &Paths, zip_path: &Path, password: Option<&str>) -> Result<()> {
    // 1. Extrai o banco do zip para uma área de staging ao lado do banco vivo.
    let staging = paths.root.join(".restore-staging.db");
    let _ = fs::remove_file(&staging);

    {
        let file = fs::File::open(zip_path).map_err(io_err)?;
        let mut archive = ZipArchive::new(file).map_err(zip_err)?;
        let mut entry = match password {
            Some(pw) => archive
                .by_name_decrypt(ENTRY, pw.as_bytes())
                .map_err(zip_err)?,
            None => archive.by_name(ENTRY).map_err(zip_err)?,
        };
        let mut out = fs::File::create(&staging).map_err(io_err)?;
        io::copy(&mut entry, &mut out).map_err(io_err)?;
    }

    // 2. Valida ANTES de substituir. Um backup que não passa no quick_check não
    //    entra no lugar de um banco que talvez ainda esteja bom.
    let verdict = quick_check_file(&staging)?;
    if verdict != "ok" {
        let _ = fs::remove_file(&staging);
        return Err(NexusError::Integrity(format!(
            "o backup não passou no quick_check: {verdict}"
        )));
    }

    // 3. Troca atômica-o-suficiente: apaga o banco vivo e seus sidecars do WAL, e
    //    promove o staging. O -wal/-shm do banco antigo NÃO podem sobreviver — eles
    //    pertencem ao arquivo que acabou de sair.
    remove_if_exists(&paths.db);
    remove_if_exists(&paths.db.with_extension("db-wal"));
    remove_if_exists(&paths.db.with_extension("db-shm"));
    fs::rename(&staging, &paths.db).map_err(io_err)?;
    Ok(())
}

/// Abre um arquivo de banco só-leitura e roda o `quick_check` — o mesmo veredito
/// que o `Db::open` exige na abertura.
fn quick_check_file(path: &Path) -> Result<String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let verdict: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    Ok(verdict)
}

fn remove_if_exists(p: &Path) {
    let _ = fs::remove_file(p);
}

/// `nexus-YYYYMMDD-HHMMSS.zip` → epoch-ms no fuso local. `None` para qualquer
/// nome fora do padrão (inclusive o `.snapshot.tmp`).
fn parse_stamp(name: &str) -> Option<i64> {
    let core = name.strip_prefix("nexus-")?.strip_suffix(".zip")?;
    let dt = chrono::NaiveDateTime::parse_from_str(core, "%Y%m%d-%H%M%S").ok()?;
    Local
        .from_local_datetime(&dt)
        .single()
        .map(|d| d.timestamp_millis())
}

fn io_err(e: std::io::Error) -> NexusError {
    NexusError::Storage(e.to_string())
}

fn zip_err(e: zip::result::ZipError) -> NexusError {
    NexusError::Storage(format!("zip: {e}"))
}
