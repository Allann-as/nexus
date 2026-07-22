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
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{Local, TimeZone};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
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

/// A configuração de backup — persistida FORA do banco (`backup-config.json` na
/// raiz de dados), de propósito: a senha nunca pode viver dentro do próprio
/// backup que ela protege. Ver ADR-0050.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupConfig {
    /// O auto-backup diário está ligado? Ligado por padrão — "seus dados a salvo"
    /// é o estado inicial, não um opt-in.
    pub enabled: bool,
    /// A senha do AES-256, se o usuário optou por cifrar. `None` = zip em claro,
    /// que ainda é um backup perfeitamente restaurável.
    pub password: Option<String>,
    /// Uma pasta extra (ex.: OneDrive/Dropbox) para onde cada backup é copiado.
    pub sync_dir: Option<String>,
}

impl Default for BackupConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            password: None,
            sync_dir: None,
        }
    }
}

/// O resumo que o rodapé/Configurações mostram — o indicador de "último backup".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// O instante do backup mais recente, ou `None` se nunca houve um.
    pub last_backup_ms: Option<i64>,
    pub count: usize,
    pub enabled: bool,
    /// A UI mostra "protegido por senha" sem NUNCA devolver a senha em si.
    pub has_password: bool,
    pub sync_dir: Option<String>,
    /// A política de retenção VIGENTE — 7 diários / 4 semanais / 12 mensais.
    ///
    /// Vai no status porque a tela precisa dizer o que sobrevive à poda, e a
    /// frase dela estava com os três números escritos à mão. Numa tela de
    /// backup, uma promessa desatualizada sobre o que é guardado é a pior
    /// espécie de número copiado: ninguém descobre que ela é falsa até precisar
    /// do backup que a poda levou. Ver ADR-0108.
    pub keep_daily: usize,
    pub keep_weekly: usize,
    pub keep_monthly: usize,
}

/// O marcador de um restauro pendente, lido no boot antes de o banco abrir.
#[derive(Debug, Serialize, Deserialize)]
struct PendingRestore {
    name: String,
    password: Option<String>,
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

    /// A configuração atual (ou o padrão, se o arquivo ainda não existe).
    pub fn config(&self) -> Result<BackupConfig> {
        load_config(&self.paths)
    }

    /// Grava a configuração.
    pub fn set_config(&self, cfg: &BackupConfig) -> Result<()> {
        save_config(&self.paths, cfg)
    }

    /// O resumo para a UI: quando foi o último backup, quantos há, e a config —
    /// menos a senha, que nunca sai daqui.
    pub fn status(&self) -> Result<BackupStatus> {
        let cfg = load_config(&self.paths)?;
        let list = self.list()?;
        Ok(BackupStatus {
            last_backup_ms: list.first().map(|b| b.created_at_ms),
            count: list.len(),
            enabled: cfg.enabled,
            has_password: cfg.password.is_some(),
            sync_dir: cfg.sync_dir,
            // Direto dos `const` do domínio que a poda obedece — uma fonte só.
            keep_daily: crate::domain::backup::KEEP_DAILY,
            keep_weekly: crate::domain::backup::KEEP_WEEKLY,
            keep_monthly: crate::domain::backup::KEEP_MONTHLY,
        })
    }

    /// Cria um backup COM a configuração corrente: cifra com a senha salva (se
    /// houver) e copia para a pasta de sync (se houver). É o "backup agora" da UI
    /// e o corpo do auto-backup — um só caminho, para manual e automático saírem
    /// idênticos.
    ///
    /// Best-effort na cópia de sync: se a pasta externa sumiu (pen drive
    /// desconectado, OneDrive pausado), o backup local ainda vale — a falha da
    /// cópia é registrada, não propagada.
    pub fn create_configured(&self) -> Result<BackupInfo> {
        let cfg = load_config(&self.paths)?;
        let info = self.create(cfg.password.as_deref())?;
        if let Some(dir) = cfg.sync_dir.as_deref() {
            if let Err(e) = copy_to_sync(&self.paths.backups.join(&info.name), dir) {
                tracing::warn!(error = %e, dir, "cópia do backup para a pasta de sync falhou");
            }
        }
        Ok(info)
    }

    /// O auto-backup: cria um snapshot se HOJE ainda não tem um e a auto-cópia
    /// está ligada. Idempotente por dia — chamado na abertura do app (a "primeira
    /// escrita do dia" na prática é a primeira vez que o app roda no dia). Devolve
    /// `Some` só quando de fato criou um.
    pub fn auto_backup_if_due(&self) -> Result<Option<BackupInfo>> {
        let cfg = load_config(&self.paths)?;
        if !cfg.enabled {
            return Ok(None);
        }

        let today = self.clock.today_local();
        let has_today = self
            .list()?
            .iter()
            .any(|b| local_day(b.created_at_ms).as_deref() == Some(today.as_str()));
        if has_today {
            return Ok(None);
        }

        self.create_configured().map(Some)
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

/// Marca um backup para ser restaurado no PRÓXIMO boot, antes de o banco abrir.
///
/// Não restaura agora: o `nexus.db` está aberto e travado enquanto o app roda. A
/// UI grava o marcador e pede um reinício; `apply_pending_restore` faz o trabalho
/// no boot seguinte, quando nenhuma conexão segura o arquivo. Valida cedo que o
/// backup existe, para o usuário não reiniciar atrás de um arquivo que não está lá.
pub fn stage_restore(paths: &Paths, name: &str, password: Option<String>) -> Result<()> {
    let zip = paths.backups.join(name);
    if !zip.exists() {
        return Err(NexusError::NotFound(format!(
            "backup {name} não encontrado"
        )));
    }
    let pending = PendingRestore {
        name: name.to_string(),
        password,
    };
    let json = serde_json::to_vec(&pending)
        .map_err(|e| NexusError::Storage(format!("marcador de restauro ilegível: {e}")))?;
    fs::write(pending_path(paths), json).map_err(io_err)
}

/// Aplica um restauro pendente, se houver, ANTES de o banco abrir. Chamado no
/// topo do boot. Devolve `true` se restaurou.
///
/// O marcador é SEMPRE removido no fim — restaurou ou falhou —, para um restauro
/// que der errado não entrar em loop a cada boot. Se falhar, o banco atual (que
/// nunca foi tocado, pois a troca só ocorre após o quick_check passar) segue
/// válido e o app abre normalmente.
pub fn apply_pending_restore(paths: &Paths) -> Result<bool> {
    let marker = pending_path(paths);
    let bytes = match fs::read(&marker) {
        Ok(b) => b,
        Err(_) => return Ok(false), // sem marcador = nada a fazer
    };
    let pending: PendingRestore = serde_json::from_slice(&bytes)
        .map_err(|e| NexusError::Storage(format!("marcador de restauro corrompido: {e}")))?;

    let zip = paths.backups.join(&pending.name);
    let outcome = restore_from_zip(paths, &zip, pending.password.as_deref());
    let _ = fs::remove_file(&marker);
    outcome.map(|_| true)
}

fn pending_path(paths: &Paths) -> PathBuf {
    paths.root.join(".pending-restore.json")
}

fn reset_marker_path(paths: &Paths) -> PathBuf {
    paths.root.join(".pending-reset")
}

/// Marca um ZERAMENTO ("Começar do zero", v1.1 D1) para o próximo boot: apaga o
/// banco vivo antes de abrir, e o `Db::open` recria um banco VAZIO (migrations do
/// zero, as 5 Esferas do sistema semeadas). Como o restauro, não pode acontecer
/// com o banco aberto — daí o marcador aplicado no boot.
///
/// PIN e preferências vivem em arquivos SEPARADOS na raiz de dados
/// (`security.json`, `backup-config.json`, `settings.json`) e NÃO são tocados:
/// zerar os dados não é esquecer quem é o dono nem as escolhas dele.
pub fn stage_reset(paths: &Paths) -> Result<()> {
    fs::write(reset_marker_path(paths), b"1").map_err(io_err)
}

/// Aplica um zeramento pendente, se houver, ANTES de o banco abrir. Remove o
/// `nexus.db` e seus sidecars do WAL; o boot recria tudo vazio. O marcador some
/// SEMPRE, para um zeramento não entrar em loop a cada boot.
pub fn apply_pending_reset(paths: &Paths) -> Result<bool> {
    let marker = reset_marker_path(paths);
    if !marker.exists() {
        return Ok(false);
    }
    remove_if_exists(&paths.db);
    remove_if_exists(&paths.db.with_extension("db-wal"));
    remove_if_exists(&paths.db.with_extension("db-shm"));

    // Só consome o marcador quando o banco DE FATO saiu. Numa corrida de
    // reinicialização no Windows, o processo anterior pode largar o handle do
    // arquivo um instante DEPOIS de sair, e o `remove` falha em silêncio — se
    // apagássemos o marcador aqui, um zeramento seria "consumido" sem ter zerado
    // nada. Mantendo o marcador, o próximo boot (com ninguém segurando o arquivo)
    // refaz e conclui. O backup já está feito desde que o marcador nasceu, então
    // repetir a tentativa é seguro.
    if paths.db.exists() {
        return Err(NexusError::Storage(
            "o banco seguia travado no zeramento; refeito no próximo boot".into(),
        ));
    }
    let _ = fs::remove_file(&marker);
    Ok(true)
}

fn config_path(paths: &Paths) -> PathBuf {
    paths.root.join("backup-config.json")
}

/// Lê a config; um arquivo ausente devolve o padrão (auto-backup ligado).
pub fn load_config(paths: &Paths) -> Result<BackupConfig> {
    match fs::read(config_path(paths)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| NexusError::Storage(format!("config de backup ilegível: {e}"))),
        Err(_) => Ok(BackupConfig::default()),
    }
}

pub fn save_config(paths: &Paths, cfg: &BackupConfig) -> Result<()> {
    let json = serde_json::to_vec_pretty(cfg)
        .map_err(|e| NexusError::Storage(format!("config de backup não serializável: {e}")))?;
    fs::write(config_path(paths), json).map_err(io_err)
}

/// Copia um zip de backup para a pasta de sync, criando-a se preciso.
fn copy_to_sync(zip: &Path, sync_dir: &str) -> Result<()> {
    let dir = Path::new(sync_dir);
    fs::create_dir_all(dir).map_err(io_err)?;
    let name = zip
        .file_name()
        .ok_or_else(|| NexusError::Storage("nome de backup inválido para copiar".into()))?;
    fs::copy(zip, dir.join(name)).map_err(io_err)?;
    Ok(())
}

/// O dia LOCAL ('YYYY-MM-DD') de um instante — a chave "já tem backup de hoje?".
fn local_day(ms: i64) -> Option<String> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|d| d.format("%Y-%m-%d").to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::clock::test_support::FixedClock;
    use chrono::TimeZone;

    /// (epoch-ms, dia local) de uma data, consistentes entre si — o dia derivado
    /// do ms é o mesmo que o relógio reporta, senão a checagem "já tem backup de
    /// hoje?" nunca casaria.
    fn moment(y: i32, m: u32, d: u32) -> (i64, String) {
        let dt = Local.with_ymd_and_hms(y, m, d, 10, 0, 0).single().unwrap();
        (dt.timestamp_millis(), dt.format("%Y-%m-%d").to_string())
    }

    fn open(paths: &Paths) -> Arc<Db> {
        let db = Arc::new(Db::open(paths).unwrap());
        db.with_write(|c| {
            c.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Saúde');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                 VALUES ('n1', 'note', 'oi', 'a1', 1, 1);",
            )?;
            Ok(())
        })
        .unwrap();
        db
    }

    #[test]
    fn auto_backup_runs_once_per_day() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = open(&paths);
        let (ms, day) = moment(2026, 7, 18);
        let engine = BackupEngine::new(db, paths.clone(), Arc::new(FixedClock::new(ms, &day)));

        // Primeira vez no dia: cria.
        assert!(engine.auto_backup_if_due().unwrap().is_some());
        // De novo no MESMO dia: não duplica.
        assert!(engine.auto_backup_if_due().unwrap().is_none());
        assert_eq!(engine.list().unwrap().len(), 1);
    }

    #[test]
    fn auto_backup_respects_the_disabled_switch() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = open(&paths);
        let (ms, day) = moment(2026, 7, 18);
        let engine = BackupEngine::new(db, paths.clone(), Arc::new(FixedClock::new(ms, &day)));

        engine
            .set_config(&BackupConfig {
                enabled: false,
                password: None,
                sync_dir: None,
            })
            .unwrap();

        assert!(engine.auto_backup_if_due().unwrap().is_none());
        assert_eq!(engine.list().unwrap().len(), 0, "desligado não cria backup");
    }

    #[test]
    fn status_reports_the_latest_backup_and_hides_the_password() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = open(&paths);
        let (ms, day) = moment(2026, 7, 18);
        let engine = BackupEngine::new(db, paths.clone(), Arc::new(FixedClock::new(ms, &day)));

        engine
            .set_config(&BackupConfig {
                enabled: true,
                password: Some("segredo".into()),
                sync_dir: None,
            })
            .unwrap();
        let info = engine.create(Some("segredo")).unwrap();

        let status = engine.status().unwrap();
        assert_eq!(status.last_backup_ms, Some(info.created_at_ms));
        assert_eq!(status.count, 1);
        assert!(status.has_password, "a UI sabe que há senha...");
        // ...mas o BackupStatus não carrega a senha em campo nenhum (só o bool).
    }

    #[test]
    fn a_staged_restore_is_applied_on_the_next_boot() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();

        // Faz um backup e fecha o banco.
        let name = {
            let db = open(&paths);
            let (ms, day) = moment(2026, 7, 18);
            let engine = BackupEngine::new(
                db.clone(),
                paths.clone(),
                Arc::new(FixedClock::new(ms, &day)),
            );
            let info = engine.create(None).unwrap();
            drop(engine);
            drop(db);
            info.name
        };

        // Corrompe o banco e marca o restauro.
        fs::write(&paths.db, b"lixo").unwrap();
        stage_restore(&paths, &name, None).unwrap();

        // "Boot": aplica o pendente e abre.
        assert!(
            apply_pending_restore(&paths).unwrap(),
            "o restauro pendente foi aplicado"
        );
        assert!(
            !pending_path(&paths).exists(),
            "o marcador some depois de aplicado"
        );

        let db = Db::open(&paths).unwrap();
        let nodes: i64 = db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(nodes, 1, "os dados voltaram");

        // Um segundo boot não repete nada (marcador já foi embora).
        assert!(!apply_pending_restore(&paths).unwrap());
    }

    #[test]
    fn a_staged_reset_recreates_an_empty_db_on_the_next_boot() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();

        // Um banco com dados do usuário, depois fechado.
        {
            let db = open(&paths); // insere a área 'a1' e o node 'n1'
            drop(db);
        }

        stage_reset(&paths).unwrap();
        assert!(
            apply_pending_reset(&paths).unwrap(),
            "o zeramento pendente foi aplicado"
        );
        assert!(
            !reset_marker_path(&paths).exists(),
            "o marcador some depois de aplicado"
        );

        // "Boot": o banco recria VAZIO (migrations), sem os dados do usuário.
        let db = Db::open(&paths).unwrap();
        let nodes: i64 = db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(nodes, 0, "os nodes do usuário sumiram");
        // As 5 Esferas do sistema renascem (semeadas na migration 0005).
        let system: i64 = db
            .with_read(|c| {
                Ok(
                    c.query_row("SELECT COUNT(*) FROM areas WHERE is_system = 1", [], |r| {
                        r.get(0)
                    })?,
                )
            })
            .unwrap();
        assert_eq!(system, 5, "as Esferas do sistema voltam vazias");

        // Um segundo boot não repete o zeramento (marcador já foi embora).
        assert!(!apply_pending_reset(&paths).unwrap());
    }
}
