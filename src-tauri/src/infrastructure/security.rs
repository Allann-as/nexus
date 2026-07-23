//! A tela de bloqueio por PIN (M5.5 §3.5).
//!
//! O que ela é, e o que ela NÃO é — a decisão honesta (ADR-0054): isto é
//! privacidade de TELA, não cifra de disco. O `nexus.db` continua legível no
//! disco por quem tem acesso à máquina; o PIN só impede que alguém que pega o
//! computador desbloqueado abra o app e leia a sua vida. Por isso o PIN nunca é
//! guardado em claro — mas também não se finge que o banco está protegido.
//!
//! A config vive FORA do banco (`security.json` na raiz de dados), como a do
//! backup: assim o PIN sobrevive a um restauro de backup (restaurar um snapshot
//! antigo não reabre a sua tela) e é lido no boot sem depender do banco.
//!
//! O hash é SHA-256 iterado sobre `salt || pin`, com salt aleatório por
//! instalação (UUID v4). Não é Argon2 — e não precisa ser: o espaço é de 10^6
//! PINs e o atacante que tem o arquivo também tem o banco em claro ao lado. O
//! stretch existe para que o hash não seja instantâneo, não para resistir a um
//! adversário com o disco.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::domain::errors::{NexusError, Result};
use crate::infrastructure::paths::Paths;

/// O PIN de fábrica, semeado no primeiro boot. O usuário troca ou desliga nas
/// Configurações. Documentado no MANUAL — não é segredo, é o ponto de partida.
const DEFAULT_PIN: &str = "242807";
const ITERATIONS: u32 = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinConfig {
    /// O app abre bloqueado? Desligado = sem tela de PIN.
    enabled: bool,
    /// Salt aleatório por instalação (UUID v4), como texto.
    salt: String,
    /// SHA-256 iterado de `salt || pin`, em hex. Vazio quando desligado.
    hash: String,
    iterations: u32,
}

/// O que a UI vê — NUNCA o hash nem o salt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    /// Há um PIN ativo? A tela de bloqueio no boot segue isto.
    pub enabled: bool,
    /// Já existe uma senha CADASTRADA neste computador (o `security.json`)?
    ///
    /// Distingue os dois "sem cadeado" que antes eram o mesmo: `enabled:false,
    /// configured:true` é quem DESLIGOU a tela de bloqueio (abre direto); já
    /// `configured:false` é o PRIMEIRO ACESSO — nunca houve senha, e o boot
    /// abre o onboarding (§3) em vez de um bloqueio genérico. Antes da fase 9 o
    /// app semeava um PIN de fábrica e este segundo estado não existia.
    pub configured: bool,
}

pub struct SecurityService {
    paths: Paths,
}

impl SecurityService {
    pub fn new(paths: Paths) -> Self {
        Self { paths }
    }

    fn config_path(&self) -> PathBuf {
        self.paths.root.join("security.json")
    }

    fn load(&self) -> Result<Option<PinConfig>> {
        match fs::read(self.config_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| NexusError::Storage(format!("security.json ilegível: {e}"))),
            Err(_) => Ok(None),
        }
    }

    fn save(&self, cfg: &PinConfig) -> Result<()> {
        let json = serde_json::to_vec_pretty(cfg)
            .map_err(|e| NexusError::Storage(format!("security não serializável: {e}")))?;
        fs::write(self.config_path(), json)
            .map_err(|e| NexusError::Storage(format!("não consegui gravar security.json: {e}")))
    }

    /// Semeia o PIN de fábrica se ainda não há config. Idempotente.
    ///
    /// NÃO é mais chamado no boot (fase 9): o primeiro acesso passou a ser o
    /// onboarding, que deixa o usuário criar a própria senha. Fica como capacidade
    /// de ferramenta/teste — semear um banco de dirigida com um PIN conhecido.
    pub fn ensure_seeded(&self) -> Result<()> {
        if self.load()?.is_none() {
            self.save(&new_config(DEFAULT_PIN, true)?)?;
        }
        Ok(())
    }

    /// A tela de boot lê isto para decidir o que abrir: onboarding (sem
    /// `security.json`), bloqueio (PIN ativo) ou direto para o app (PIN desligado).
    pub fn status(&self) -> Result<LockStatus> {
        match self.load()? {
            Some(cfg) => Ok(LockStatus {
                enabled: cfg.enabled,
                configured: true,
            }),
            None => Ok(LockStatus {
                enabled: false,
                configured: false,
            }),
        }
    }

    /// Confere um PIN contra o hash guardado. `false` também quando não há PIN
    /// ativo — a UI não deveria chamar aqui nesse caso, mas nunca "passa por
    /// engano".
    pub fn verify(&self, pin: &str) -> Result<bool> {
        let Some(cfg) = self.load()? else {
            return Ok(false);
        };
        if !cfg.enabled {
            return Ok(false);
        }
        let salt = Uuid::parse_str(&cfg.salt)
            .map_err(|e| NexusError::Storage(format!("salt inválido: {e}")))?;
        Ok(hash_pin(pin, salt.as_bytes(), cfg.iterations) == cfg.hash)
    }

    /// Troca (ou define) o PIN. Se já há um PIN ativo, o atual é exigido — trocar
    /// sem provar quem é seria a fechadura que qualquer um reconfigura.
    pub fn set_pin(&self, current: Option<&str>, new_pin: &str) -> Result<()> {
        validate_pin(new_pin)?;
        if let Some(cfg) = self.load()? {
            if cfg.enabled {
                let ok = current
                    .map(|c| self.verify(c))
                    .transpose()?
                    .unwrap_or(false);
                if !ok {
                    return Err(NexusError::Validation("PIN atual incorreto".into()));
                }
            }
        }
        self.save(&new_config(new_pin, true)?)
    }

    /// Desliga a tela de bloqueio — exige o PIN atual. O arquivo permanece, com
    /// `enabled: false` e sem hash: nada de PIN em claro esquecido no disco.
    pub fn disable(&self, current: &str) -> Result<()> {
        if !self.verify(current)? {
            return Err(NexusError::Validation("PIN atual incorreto".into()));
        }
        self.save(&PinConfig {
            enabled: false,
            salt: String::new(),
            hash: String::new(),
            iterations: ITERATIONS,
        })
    }
}

/// Um PIN é exatamente 6 dígitos — o que a tela desenha (6 círculos).
fn validate_pin(pin: &str) -> Result<()> {
    if pin.len() == 6 && pin.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(NexusError::Validation("o PIN deve ter 6 dígitos".into()))
    }
}

fn new_config(pin: &str, enabled: bool) -> Result<PinConfig> {
    validate_pin(pin)?;
    let salt = Uuid::new_v4();
    Ok(PinConfig {
        enabled,
        hash: hash_pin(pin, salt.as_bytes(), ITERATIONS),
        salt: salt.to_string(),
        iterations: ITERATIONS,
    })
}

/// SHA-256 iterado: a primeira rodada absorve `salt || pin`, as seguintes
/// esticam o digest. `hex` porque o resultado vive num JSON legível.
fn hash_pin(pin: &str, salt: &[u8], iterations: u32) -> String {
    let mut buf = Vec::with_capacity(salt.len() + pin.len());
    buf.extend_from_slice(salt);
    buf.extend_from_slice(pin.as_bytes());
    let mut digest = Sha256::digest(&buf);
    for _ in 1..iterations {
        digest = Sha256::digest(digest);
    }
    to_hex(&digest)
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> (SecurityService, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        (SecurityService::new(paths), dir)
    }

    #[test]
    fn seeds_default_pin_once() {
        let (s, _d) = svc();
        s.ensure_seeded().unwrap();
        assert!(s.status().unwrap().enabled);
        assert!(s.verify("242807").unwrap());
        assert!(!s.verify("000000").unwrap());
    }

    #[test]
    fn ensure_seeded_is_idempotent() {
        let (s, _d) = svc();
        s.ensure_seeded().unwrap();
        s.set_pin(Some("242807"), "111111").unwrap();
        // um segundo seed não deve reverter para o PIN de fábrica
        s.ensure_seeded().unwrap();
        assert!(s.verify("111111").unwrap());
        assert!(!s.verify("242807").unwrap());
    }

    #[test]
    fn change_pin_requires_current() {
        let (s, _d) = svc();
        s.ensure_seeded().unwrap();
        assert!(s.set_pin(Some("000000"), "111111").is_err());
        assert!(s.set_pin(Some("242807"), "111111").is_ok());
        assert!(s.verify("111111").unwrap());
    }

    #[test]
    fn disable_requires_current_and_stores_no_pin() {
        let (s, _d) = svc();
        s.ensure_seeded().unwrap();
        assert!(s.disable("000000").is_err());
        s.disable("242807").unwrap();
        assert!(!s.status().unwrap().enabled);
        // desligado, verify nunca passa
        assert!(!s.verify("242807").unwrap());
    }

    #[test]
    fn a_fresh_install_is_unconfigured_then_onboards() {
        let (s, _d) = svc();
        // Sem `security.json`: o primeiro acesso. O boot abre o onboarding.
        let st = s.status().unwrap();
        assert!(!st.configured, "sem arquivo, não há senha cadastrada");
        assert!(!st.enabled);
        // O onboarding cria a senha do zero — sem `current`, porque não há atual.
        s.set_pin(None, "135790").unwrap();
        let st = s.status().unwrap();
        assert!(st.configured, "criar a senha passa a existir cadastro");
        assert!(st.enabled);
        assert!(s.verify("135790").unwrap());
    }

    #[test]
    fn disabling_keeps_configured_true() {
        // Quem DESLIGA a tela de bloqueio não volta ao onboarding: já tem cadastro,
        // o app só abre direto. `configured` os separa.
        let (s, _d) = svc();
        s.set_pin(None, "222333").unwrap();
        s.disable("222333").unwrap();
        let st = s.status().unwrap();
        assert!(!st.enabled);
        assert!(st.configured, "desligar não é apagar o cadastro");
    }

    #[test]
    fn rejects_non_six_digit_pin() {
        let (s, _d) = svc();
        s.ensure_seeded().unwrap();
        assert!(s.set_pin(Some("242807"), "12345").is_err());
        assert!(s.set_pin(Some("242807"), "abcdef").is_err());
        assert!(s.set_pin(Some("242807"), "1234567").is_err());
    }
}
