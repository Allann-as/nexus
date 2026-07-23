# QA-fase12 — Release local (limpar dados de teste + instalador)

> Fase de empacotamento. Build autorizado. Ordem seguida: backup → limpeza → versão →
> build → cópia → verificação. Sem tag/GitHub Release.

## 1. Backup (feito ANTES de tocar em dados)
- `data_dir` de produção: **`%APPDATA%\Nexus`** (`C:\Users\allan\AppData\Roaming\Nexus`).
  Resolução = `base.data_dir()/Nexus`; `NEXUS_DATA_DIR` (ADR-0048) só em dev/dirigidas.
- Backup copiado para a Área de Trabalho:
  **`C:\Users\allan\OneDrive\Desktop\NEXUS-backup-20260723-034520\`** (≈ **8 MB**):
  - `prod-appdata\` — `nexus.db` (4 KB) + `nexus.db-wal` (**2,5 MB**, onde os dados viviam) +
    `-shm` + `nexus.db.m35-backup` (552 KB) + **`security.json`** (a senha).
  - `dev-devdata\` — `nexus.db` (832 KB) + WAL (4 MB) + `-shm`.

## 2. Limpeza para start-limpo
**a) Seed de teste não roda em produção — por construção.** O dado de teste (caixinha
"PlayStation 5", hábitos "teste") vem de **`src-tauri/examples/seed_demo.rs`**, invocado só
pelo `dev.ps1`. `cargo build --release` compila o binário `bin`, **não** os examples — o seed
**não entra no instalador**. O boot de produção só semeia as 5 esferas de fábrica + bancos
(migrations 0005/0006), que é dado de fábrica, não teste. **Nenhuma mudança de código foi
necessária** (não havia seed no boot para guardar atrás de flag).

**b) Start limpo de verdade.** O app instalado usaria `%APPDATA%\Nexus`, que **já tinha**
banco + `security.json` — abriria BLOQUEADO, não em onboarding. Após o backup, **movi a
pasta inteira** (nada apagado, reversível):
`%APPDATA%\Nexus` → **`%APPDATA%\Nexus.pre-release-20260723-034556`**
(levou junto `nexus.db*`, `security.json`, `backups/`, `exports/`, `logs/`, `media/`,
`retrospectives/`). Sem `security.json`, `configured:false` = primeiro acesso.

**PROVA (binário de RELEASE, `NEXUS_DATA_DIR` numa pasta vazia):**
```
security.json  -> NÃO existe  => onboarding
verify_db:  quick_check ok | user_version 21 | foreign_key_check ok
  nodes 0 · ledger 0 · habit_ticks 0 · contributions 0 · goal_details 0 · areas 5
  INTEGRO
```
→ zero hábito "teste", zero caixinha de lixo, zero evento; só as **5 esferas de fábrica**.
As 21 migrations rodaram (inclui a 0021 de cores Fin/Est).

## 3. Versão 1.3.0 — consistente
`tauri.conf.json` = 1.3.0 · `package.json` = 1.3.0 · `Cargo.toml` = 1.3.0. Sem ajuste.
Binário: `ProductName=NEXUS  FileVersion=1.3.0  ProductVersion=1.3.0`.

## 4. Build do instalador
`npm run tauri build` → **EXIT 0** (release `optimized`, 5m21s). Dois bundles:
- **NSIS**: `src-tauri\target\release\bundle\nsis\NEXUS_1.3.0_x64-setup.exe` — **3,67 MB**
- **MSI**: `src-tauri\target\release\bundle\msi\NEXUS_1.3.0_x64_en-US.msi` — **5,23 MB**
- Binário: `src-tauri\target\release\nexus.exe` — 7,99 MB (23/07 04:00)

> **Atenção registrada:** havia bundles `1.3.0` de **22/07 18:59** na pasta, de um build
> ANTERIOR às fases 10/11 (logo velha, bugs não corrigidos). O primeiro build desta fase foi
> interrompido; **re-rodei até concluir** para não entregar o artefato velho. Os artefatos
> acima são de **23/07 03:59–04:00**.

## 5. Instalador na Área de Trabalho
- **`C:\Users\allan\OneDrive\Desktop\NEXUS-Setup-v1.3.0.exe`**
- **3,67 MB** (3.852.422 bytes) — existe: **True**

## 6. Verificação
- **Ícone (prova real):** extraí o ícone **embutido no `nexus.exe` de release** e olhei —
  é o **núcleo orbital**, não o "N" (`docs/verify-fase10/17-icone-do-exe.png`). Isso fecha a
  dúvida que ficou aberta na fase anterior.
- **Assinatura:** **ausente** — build local **não assinado**. O Windows mostrará
  "editor desconhecido" no SmartScreen. Não havia `signingIdentity`/certificado e não inventei um.
- **Updater:** `bundle.createUpdaterArtifacts = **false**`, **sem endpoints**, **sem plugin
  updater**, **sem dependência de rede no `Cargo.toml`**. Nada busca atualização — 100% offline.
- **Instalação em perfil limpo:** **não executada** — a janela nativa não roda neste ambiente
  (ver notas). Provei o equivalente pelo estado do `data_dir` + `verify_db` acima.
- **Medição de 5 anos** (banco sintético separado, `.devdata-scale`, depois removido):
  | Medida | Valor | Orçamento |
  |---|---|---|
  | Tamanho do `.db` | **84,41 MB** (+ WAL 72,26 MB antes do checkpoint) | — |
  | **Abertura do banco (frio)** | **284,17 ms** | 1500 ms ✅ |
  | Busca FTS | 3,95 ms | 50 ms ✅ |
  | Um mês da Timeline | 0,15 ms | 100 ms ✅ |
  | **Ping local** (`ledger.count`) | **0,10 ms** | 50 ms ✅ |

  Volume: 50.000 nodes + 400.000 eventos de ledger (5 anos). Tudo dentro do orçamento.
- **Regressão final:** `tsc` **0** · `vitest` **129/129** · `cargo test` **EXIT 0** ·
  grep de rede (`fetch(`/`reqwest`/`http(s)://`/`WebSocket`/`axios`/`ws://`/`TcpStream`) = **zero**.

## 7. Notas honestas
- A janela nativa não renderiza/dirige neste ambiente, então **não instalei e cliquei** no
  perfil limpo — isso é do Allan. O que provei: o binário de release **boota**, cria o
  `data_dir`, roda as 21 migrations e fica em **onboarding** com o banco **vazio**.
- O instalador **não é assinado** (sem certificado). É esperado para build local.
- Para **desfazer** a limpeza (voltar aos dados de teste): renomeie
  `%APPDATA%\Nexus.pre-release-20260723-034556` de volta para `%APPDATA%\Nexus`.
- Nenhuma mudança de código nesta fase (versão já estava correta; o seed já estava fora do
  build de produção) — o commit traz apenas este relatório.
