# QA — Fase 9: Bloqueio C-HUD, identidade progressiva, onboarding e borda infinita

Branch `fase9-bloqueio-borda`. Este relatório separa, com honestidade, **o que foi
verificado por compilação/teste/medição** do **que exige a dirigida ao vivo** (o app
rodando numa janela, clicando de verdade).

## Limite deste relatório (leia primeiro)

O ambiente onde a fase foi implementada **compila, testa e mede**, mas **não renderiza
nem dirige a janela do Tauri** (a GUI de desktop). Então:

- Tudo que é **lógica, contrato e número** foi verificado aqui e está marcado
  `[OK · automático]`.
- Tudo que é **pixel, animação, contraste e gesto na tela** está marcado
  `[⏳ dirigida ao vivo]` — é a passada de qualidade que o dono já planejava fazer.
  Cada item traz o que esperar e onde olhar, para essa passada ser rápida.

Nada aqui é afirmado como "vi funcionar na tela" sem ter visto — a lente das três
lições vale para este documento também.

## Portão automático (tudo verde)

| Passo | Resultado |
|---|---|
| `cargo fmt --check` | OK |
| `cargo clippy --all-targets -D warnings` | OK (0 warnings) |
| `cargo test` | **647** testes, 0 falhas (inclui 2 novos de `configured`) |
| `tsc --noEmit` | OK (0 erros) |
| `vitest run` | **129** testes, 0 falhas (inclui o crivo anti-emoji) |
| `vite build` | OK (aviso de chunk > 500kB é pré-existente, não regressão) |

## Escala — 5 anos de dados (medido, não estimado)

Banco de teste isolado (`seed_scale`: 50.000 nodes, 400.000 linhas de ledger), aberto
**a frio** em `--release` com o `bench_scale`:

| Medida | Valor | Orçamento |
|---|---|---|
| **Tamanho do `.db` em disco** (estado estável, após checkpoint do WAL) | **84,4 MB** | — |
| **Cold open** (abertura do banco a frio) | **254 ms** | 1500 ms |
| **"ping" da barra HUD** (`ledger.count()`, o número que a barra mostra) | **0,11 ms** | 50 ms |
| Busca FTS | 4,75 ms | 50 ms |
| Um mês da Timeline | 0,19 ms | 100 ms |

Leitura: o crescimento é **saudável**. Cinco anos cabem em ~84 MB e abrem a frio em
~0,25 s. O "ping" é latência local real de uma leitura ao núcleo — a 0,1 ms, a barra
mostra honestamente **`ping <1ms`**; ele sobe devagar conforme o ledger cresce (é a
latência do SEU núcleo, com os SEUS dados), nunca um número inventado nem uma
requisição de rede. Nota: logo após um seed em lote o WAL fica gordo (o total
`db+wal` chegou a 156 MB antes do checkpoint); o app faz checkpoint no uso normal, e o
estado estável é os 84 MB acima — que é o que o `system_info` reporta com o WAL já
integrado.

Comando para reproduzir:
```
$env:NEXUS_DATA_DIR = "<pasta isolada>"
cargo run --release --example seed_scale --manifest-path src-tauri/Cargo.toml
cargo run --release --example bench_scale --manifest-path src-tauri/Cargo.toml
```

## Fluxo de identidade

**1. Estado limpo (sem senha) → onboarding.** `[OK · automático]` no backend /
`[⏳ dirigida ao vivo]` na tela.
Backend: sem `security.json`, `lock_status` devolve `{enabled:false, configured:false}`
(teste `a_fresh_install_is_unconfigured_then_onboards`). O boot deixou de semear o PIN
de fábrica (`state.rs`), então um perfil novo cai no `OnboardingScreen`. Criar senha
(com confirmação) chama `set_pin(None, pin)`; o nome, `set_display_name`. Ambos
gravam em disco, fora do banco.
Na tela (dirigir com um `NEXUS_DATA_DIR` novo, ex.: `.\dev.ps1 -Reseed` apontando para
uma pasta vazia SEM `security.json`): confirmar que abre em "Passo 1 de 2 · Crie sua
senha", que a confirmação que não bate volta ao passo 1 avisando, que o passo 2 pede o
nome, e que "Entrar no NEXUS" entra no app. Reabrir → o nome volta na saudação.

**2. Retorno → bloqueio + identidade progressiva.** `[⏳ dirigida ao vivo]`
Código: com `configured:true, enabled:true`, abre o `LockScreen`. A saudação de cima é
**genérica por hora, sem nome**. O terminal digita "ledger íntegro OK" (só se
`boot_telemetry` voltou — ADR-0109) e "aguardando operador▮". PIN certo → `setAuthed`
trava o teclado, o terminal revela ABAIXO "operador identificado" (com um Check) e
"Seja bem-vindo de volta, **{nome}**.", segura ~850 ms e então a cortina sobe. O nome
só é lido no instante da revelação.
Dirigir: confirmar as linhas crescendo para baixo, o nome só depois do PIN, e a
suavidade do timing.

**3. PIN errado.** `[⏳ dirigida ao vivo]`
Código: tremor nas bolinhas + aro vermelho + linha `> senha incorreta` (âmbar/vermelho)
que some depois; volta a "aguardando operador"; **nenhum nome vaza**. Do 3º erro, o
atraso de resfriamento por tentativa foi preservado.

**4. Trocar o nome nas Configurações.** `[OK · automático]` no contrato /
`[⏳ dirigida ao vivo]` na saudação.
A tela de bloqueio e o onboarding leem/gravam a MESMA fonte (`settings.json` via
`display_name`), a mesma chave `["app-settings"]` do Hub. Trocar lá reflete na
saudação de retorno.

**5. Trocar a senha nas Configurações.** `[OK · automático]`
Inalterado nesta fase; `set_pin` exige o atual (testes `change_pin_requires_current`).
A antiga para, a nova funciona.

**6. Reduced-motion.** `[⏳ dirigida ao vivo]` (lógica `[OK · automático]`)
`prefersReducedMotion()` (SO **ou** a preferência das Configurações, via
`data-reduced-motion`) desliga: o `Starfield` desenha um quadro estático e não abre
rAF; a datilografia entrega cada linha inteira de imediato; o cursor congela aceso.
Dirigir com "Reduzir movimento" ligado e confirmar que nada anima e tudo fica legível.

## Borda infinita / seções

**7. Cada seção — fundo de ponta a ponta, sem faixa destoante.** `[⏳ dirigida ao vivo]`
Estrutura verificada: a `.nx-page` ficou **transparente** (sem grafite sólido, sem
dot-grid, sem os aros da bússola); a rail e a barra do topo ficaram translúcidas; um
único `Starfield` fixo (`Shell.tsx`, `-z-10` no contexto `isolate` da Shell) cobre a
viewport. As três cores de fundo que davam a emenda (`--bg-void` da moldura,
`--bg-surface` da rail, `--bg-base` da página) deixaram de competir. A cor vem de
`--tint` (a seção ativa, via `useSectionTint`): Esfera → cor dela; fora → fósforo.
Dirigir: entrar em CADA Esfera (Saúde, Casa, Finanças, Metas, Carreira, Estudos) e
confirmar (a) fundo estelar sem faixa, (b) starfield + barra tingidos pela cor,
(c) transição suave na troca (o canvas persegue o alvo ~400 ms; a barra transiciona por
CSS), (d) painéis legíveis. **Ponto de atenção que só o olho decide:** a intensidade da
tinta e a opacidade dos painéis (`--panel-bg`, 80% escuro / 88% claro) — se o texto
perder contraste sobre a poeira, subir o alfa do token. E o **tema CLARO**: o starfield
nasceu escuro (o Cockpit "nasce escuro"); ver se as estrelas de fósforo sobre fundo
claro não ficam ruidosas — se ficarem, é um ajuste de alfa por tema.

**8. Métricas da barra são reais.** `[OK · automático]`
`SectionMeters` lê o `SphereCard` que o Hub já calcula (cache quente): mostra
`feitos/total checkpoints hoje` e `streak N` **só quando há dado** (some senão — estado
vazio honesto). Fora de uma Esfera, a barra não inventa métrica. Bater os números
contra o conteúdo da Esfera na dirigida.

## Regressão (o que já existia)

As mudanças da fase 9 na parte de "borda infinita" são de **CSS/pintura**, não de
lógica: a `.nx-page` transparente, o `Card` translúcido (`--panel-bg`, alfa — **sem**
`backdrop-filter` por card, para respeitar o princípio dos tokens de que o
backdrop-filter é o efeito mais caro), a rail/barra translúcidas. Os itens 9–15 abaixo
têm a **lógica inalterada**; o que muda é o fundo atrás deles.

- **9. Hábitos/checkpoints, 10. Metas (4 tipos + sub-desafios), 11. Finanças,
  12. Estudos, 13. Notas (+ anexo de imagem), 14. Timeline/insights,
  15. Navegação/modais:** `[⏳ dirigida ao vivo]` — lógica não tocada. Verificar na
  dirigida que cada função ainda opera E que o conteúdo continua legível sobre o novo
  fundo. **13 (anexo de imagem):** o `assetProtocol`/scope não foi tocado nesta fase;
  o bug histórico não deve reaparecer, mas confirme que a imagem ainda carrega.
- **Verificação estática feita:** o único `-z-10` de feature (`GoalCard`) foi analisado
  contra a remoção do `isolation` da `.nx-page` — o gradiente segue recortado pelo
  `overflow-hidden` do próprio card e o conteúdo pinta acima dele; sem regressão de
  empilhamento. `sticky` (Inbox) depende do container de rolagem, não do fundo.

## Ofensor conhecido / decisão registrada

- **PIN de fábrica removido no boot.** Antes, o app semeava `242807` no primeiro boot;
  agora o primeiro acesso é o onboarding (o usuário cria a senha). Instalações que já
  têm `security.json` (o PIN semeado antes, ou um trocado à mão) **seguem intactas** — a
  migração é não tocar no que existe. O MANUAL, que documentava o `242807`, precisa de
  uma nota nesse sentido (fora do escopo desta fase — sinalizado).
- **Glass dos painéis por alfa, não por blur.** O mockup pede `backdrop-filter: blur`
  nos painéis; com dezenas de cards sobre um canvas vivo, isso estouraria o custo que os
  tokens vigiam. Optou-se por translucidez por **alfa** (`--panel-bg`) nos cards, com
  `backdrop-filter` só na rail e na barra do topo (poucos elementos) e nos overlays já
  existentes. Se a dirigida ao vivo achar que os painéis pedem o blur, é um ajuste de
  uma linha — mas convém medir o custo antes.
