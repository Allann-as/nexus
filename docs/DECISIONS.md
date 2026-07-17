# NEXUS — Decision Records (ADRs)

Registros curtos de toda decisão não-óbvia. Formato: contexto → decisão →
consequência. Um ADR nunca é editado depois de aceito; ele é **substituído** por
outro que o supersede.

---

## ADR-0001 — Ambiente de build: Rust + MSVC instalados na sessão

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** A máquina tinha Node 24, npm, pnpm e git, mas **não tinha Rust nem
o MSVC C++ Build Tools**. O Tauri não compila sem os dois. O WebView2 (150.x) já
estava presente — o Windows 11 o embarca.

**Decisão.** Instalar `Rustlang.Rustup` e `Microsoft.VisualStudio.2022.BuildTools`
(workload `VCTools` + recomendados) via winget.

**Consequência.** Rust 1.97.1, MSVC 14.44, Windows SDK 10.0.26100. O instalador do
VS pediu reinício, mas um teste de link real (`cargo run` num crate trivial)
passou sem reiniciar — o aviso era espúrio e foi ignorado com evidência, não com
suposição.

---

## ADR-0002 — Projeto fora do OneDrive (`C:\dev\nexus`)

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** A sessão abriu em `C:\Users\allan\OneDrive\Desktop\Nexus`, uma pasta
sincronizada. O `target/` do Rust gera dezenas de milhares de arquivos e vários
GB; o `node_modules/` agrava. O OneDrive tentaria sincronizar tudo isso, travando
arquivos durante o build (falhas intermitentes de link) e consumindo cota.

**Decisão.** Criar o projeto em `C:\dev\nexus`, como o próprio prompt mestre
sugeria. Confirmado com o usuário.

**Consequência.** Builds rápidos e determinísticos. O instalador final ainda é
copiado para a Área de Trabalho (M6) — o entregável chega onde o usuário espera,
sem que o repositório viva lá.

---

## ADR-0003 — `domain/errors.rs` conhece `rusqlite`

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** A regra de dependência diz que `domain` não importa
`rusqlite`/`tauri`. Mas erros de storage precisam virar erros de domínio em
**algum** ponto, e espalhar `.map_err(...)` por cada repositório é ruído puro.

**Decisão.** `domain/errors.rs` implementa `From<rusqlite::Error>` (e `r2d2`,
`rusqlite_migration`) convertendo para `NexusError::Storage(String)` na fronteira.
Nenhum tipo estrangeiro entra na variante — só texto já formatado.

**Consequência.** O `?` funciona naturalmente nos repositórios. A regra de
dependência é violada em **um arquivo, de forma consciente e documentada**, em vez
de erodida em dezenas. Se um dia trocarmos o SQLite, o conserto é local.

**Alternativa rejeitada.** Um `StorageError` genérico em `application/` com
conversão manual em cada repositório: mais puro no papel, muito mais cerimônia,
sem ganho real.

---

## ADR-0004 — `#![allow(linker_messages)]`

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** O `crate-type = ["staticlib","cdylib","rlib"]` do Tauri faz o linker
MSVC imprimir "Criando biblioteca ..." no stdout. O lint `linker_messages` do
rustc (on by default) transforma isso em warning. A DoD exige **zero warnings**;
não há como calar o linker.

**Decisão.** `#![allow(linker_messages)]` no `lib.rs`, com comentário apontando
para este ADR.

**Consequência.** O gate de zero-warning volta a ser significativo em vez de
conviver com ruído permanente. **Custo real:** warnings genuínos do linker também
ficam suprimidos neste crate. Aceito porque o link é exercitado a cada build e uma
falha real de link é um **erro**, não um warning.

---

## ADR-0005 — `cargo build --release` não produz um app funcional

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Durante a verificação do M0, o binário de release abriu mostrando
`ERR_CONNECTION_REFUSED` em `localhost:1420` — a janela tentava carregar o
servidor de dev. O backend estava perfeito (log confirmou `schema migrated
from=0 to=1`); o frontend é que não estava embutido.

**Causa.** Só a CLI do Tauri orquestra o bundle: roda `beforeBuildCommand`
(`vite build`) e compila com o ambiente que faz `generate_context!` embutir o
`frontendDist`. `cargo build --release` sozinho compila o Rust e nada mais.

**Decisão.** `npx tauri build` é o **único** caminho para um artefato executável.
No `check.ps1`, `cargo build --release` permanece — mas apenas como *checagem de
compilação em modo release*, nunca como produtor de app.

**Consequência.** Ficou explícito no `ARCHITECTURE.md` §8. Reforça a exigência do
roadmap de **testar o app instalado, não o dev build** — este bug seria invisível
em `tauri dev`.

---

## ADR-0006 — Verificação por keystrokes sintéticos: abandonada

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Para verificar `Ctrl+K` e os chords `G+<tecla>` no app real, tentei
dirigir a janela com `SendKeys` do WScript.Shell. O Windows bloqueia troca de
foreground por processo em background; mesmo com o truque de `AttachThreadInput`,
o foco voltou para o editor **entre** a checagem de guarda e o envio das teclas.
Resultado: as teclas foram digitadas na janela errada — duas vezes, incluindo o
chat do usuário.

**Decisão.** Não dirigir a UI com keystrokes sintéticos neste ambiente. A
verificação do M0 se apoia no que é observável com segurança: a janela abre
(0,86 s), renderiza, e o Dashboard exibe dados **lidos do SQLite** via IPC — o que
prova a cadeia React → invoke → Rust → SQLite ponta a ponta.

**Consequência.** A camada de teclado fica coberta por `tsc` e revisão, não por
teste de ponta a ponta. **Dívida registrada:** se um dia quisermos E2E de teclado,
o caminho correto é WebDriver (`tauri-driver`), que fala com o WebView em vez de
disputar o foco global do SO — não `SendKeys`.

---

## ADR-0007 — `retry: false` no TanStack Query

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** O TanStack Query retenta 3× por padrão, um comportamento desenhado
para redes instáveis.

**Decisão.** `retry: false` global.

**Consequência.** O backend é um arquivo SQLite local: não existe link instável
para atravessar. Uma falha aqui é um bug real (lock, corrupção, regressão) e deve
aparecer **imediatamente**, não ser mascarada por três tentativas silenciosas.

---

## ADR-0008 — Hash routing

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Em produção a app carrega sob o protocolo `tauri://`, sem servidor
HTTP por trás.

**Decisão.** `createHashRouter` em vez de `createBrowserRouter`.

**Consequência.** Rotas profundas resolvem sem servidor. URLs ficam com `#/` —
irrelevante num app desktop sem barra de endereço.

---

## ADR-0013 — Streak de `TimesPerWeek` é contado por semana

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** "Dia não agendado não quebra streak" é regra explícita do prompt.
Para `Daily` e `Weekdays` isso é direto: pule o dia. Mas "3× por semana" não tem
dia certo — **todo** dia serve e **nenhum** é obrigatório. Contado por dia, o
streak seria 1 para sempre.

**Decisão.** `TimesPerWeek` conta **semanas** que bateram a meta; as demais
contam dias. A semana corrente em curso tem carência (não conta, não quebra),
espelhando a carência de "hoje" no streak diário.

**Consequência.** O número passa a significar o que a pessoa entende por
"sequência" em cada modalidade. `is_weekly()` no `Schedule` é o que separa os
dois caminhos em `streak::compute`.

---

## ADR-0014 — Nexus Score: pesos redistribuídos e `None` quando não há nada

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** Os pesos (40/30/20/10) pressupõem que a pessoa tem hábitos,
tarefas e rotina matinal. E quem não tem rotina matinal? E o dia sem nada
agendado?

**Decisão.**

1. **Redistribuir**: só as parcelas aplicáveis entram, normalizadas para 100.
   Sem rotina, os 20% se diluem nas outras.
2. **`None`, não zero**, quando nada se aplica.

**Consequência.** Um score que castiga por não usar uma feature mede a feature,
não o dia; um que presenteia com 20 grátis vira enfeite. E zero num dia sem nada
agendado seria uma acusação falsa — `None` diz a verdade: não havia o que medir.
A UI mostra os pesos **efetivos**, não a tabela teórica.

---

## ADR-0015 — Ordem de tarefas em `REAL`, não `INTEGER`

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** O drag reorder precisa de ordem manual persistida.

**Decisão.** `task_details.sort_order REAL`. Arrastar entre dois vizinhos grava a
**média** deles.

**Consequência.** Mover é **1 update de 1 linha**. Com inteiros seria renumerar
todas as linhas seguintes a cada arrasto — O(n) escritas por gesto. **Custo:** a
precisão do double satura após ~50 inserções no mesmo ponto; quando o intervalo
cai abaixo de `MIN_GAP` (1e-6), `renumber_project_tasks` reespaça em inteiros e a
conta refaz com folga. Coberto por teste que arrasta 60× no mesmo ponto e exige
que a ordem continue estritamente crescente.

---

## ADR-0016 — `double_option` no patch de tarefa

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** Um patch parcial precisa distinguir "não mexer neste campo" de
"apagar este campo". O `Option<Option<T>>` do serde colapsa os dois em `None`, e
atributos serde não existem em parâmetro de função Tauri.

**Decisão.** Um `TaskPatchDto` com `#[serde(default, deserialize_with = "double_option")]`
por campo anulável, recebido como um único argumento.

**Consequência.** `campo ausente` → não mexer; `"dueAt": null` → limpar;
`"dueAt": 123` → definir. Sem isso, editar a prioridade de uma tarefa apagaria
silenciosamente a data dela. Cinco testes fixam o contrato — é sutil demais para
ficar por conta da intenção.

---

## ADR-0010 — FTS5 contentless: o vínculo é o `rowid`, não uma coluna `node_id`

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** A `search_index` nasceu com uma coluna `node_id UNINDEXED` e a
busca juntava por ela (`JOIN nodes n ON n.id = s.node_id`). Compilou, migrou,
não deu erro — e **retornava zero resultados sempre**. Os testes que esperavam
`[]` passavam; só os que esperavam encontrar algo falharam.

**Diagnóstico (medido, não suposto).** Um teste isolado mostrou:

```
match_count       = 1      <- o índice ESTÁ populado, o MATCH funciona
rowid_readback    = Some(1)
node_id_readback  = None   <- a coluna UNINDEXED volta NULL
```

Numa tabela `content=''`, o FTS5 **não armazena valor de coluna nenhum** — nem
os `UNINDEXED`. Ler qualquer coluna devolve NULL. O JOIN casava contra NULL e
não encontrava nada, **em silêncio**.

**Decisão.** Remover `node_id` da tabela FTS e vincular por
`search_index.rowid = nodes.rowid` (`nodes` tem PK TEXT mas continua sendo
tabela com rowid). `snippet()`/`highlight()` também não existem aqui, pelo mesmo
motivo: o trecho é montado em Rust a partir de `nodes`/`note_details`.

**Consequência.** Uma coluna que nunca poderia funcionar sai do schema. Achado
adicional: com alias, `MATCH` exige o **nome da tabela** (`search_index MATCH`),
não o alias (`s MATCH` não resolve).

**Lição.** Uma feature pode falhar em silêncio e passar por todos os testes que
esperam vazio. Só testes que exigem um resultado **positivo** pegam isto.

---

## ADR-0011 — `NodePatch` em vez de oito argumentos

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** `update_with_event` chegou a oito parâmetros e o clippy barrou
(`too_many_arguments`, 8/7). Silenciar com `#[allow]` era um clique.

**Decisão.** Aceitar o recado e trocar por `NodePatch<'a>` com `Default`.

**Consequência.** A assinatura caiu para 4 parâmetros e as chamadas ficaram
autoexplicativas (`NodePatch { status: Some(s), ..Default::default() }`) em vez
de `(id, None, Some(x), None, None, now, &e)` — onde trocar dois `None` de lugar
compila e faz a coisa errada. O lint estava certo.

---

## ADR-0009 — Fontes via `@fontsource`, nunca CDN

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Inter e JetBrains Mono são a identidade tipográfica do Aurora. O
caminho usual (`@import` do Google Fonts) é uma chamada de rede em runtime —
proibido pela regra 1 da constituição.

**Decisão.** Pacotes `@fontsource-variable/inter` e `@fontsource/jetbrains-mono`
resolvidos de `node_modules` no build; `assetsInlineLimit: 0` os emite como
assets locais.

**Consequência.** Zero rede, e a tipografia é idêntica com o cabo desconectado —
que é o único modo em que o NEXUS deve rodar.

---

## ADR-0012 — Verificação de UI: clique guardado por `WindowFromPoint`

**Data:** 2026-07-17 · **Status:** aceito · **complementa o ADR-0006**

**Contexto.** O ADR-0006 abandonou `SendKeys` porque teclas seguem o **foco de
teclado**, que não dá para segurar — e foram parar na janela errada. Mas ainda
era preciso verificar a UI real do M1.

**Decisão.** Dirigir por **clique**, não por tecla, com uma guarda que o foco não
consegue enganar: um clique vai para o que está **sob o cursor**, então
`WindowFromPoint(x,y)` + `GetAncestor(GA_ROOT)` prova, antes de clicar, que o
alvo é a janela do NEXUS. Se não for, aborta. Para desocluir sem roubar foco:
`SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)`, sempre desfeito num `finally`.

**Consequência.** Verificado de verdade: navegação, lista do Inbox e a triagem
ponta a ponta (badge 5→4, toast, item saindo da lista). A guarda provou o valor
na prática — recusou o primeiro clique porque o editor estava por cima.

**Limite honesto.** Continua sendo automação de SO, não E2E de verdade. Para
suíte de regressão o caminho é `tauri-driver` (WebDriver), que fala com o WebView
em vez de disputar a mesa do Windows.

---

## ADR-0013 — Esferas SÃO `areas`: um conceito, dois nomes

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** O M2.5 reorganiza o produto em torno de **Esferas da Vida**. A
tentação era criar uma tabela `spheres` e um conceito novo. Mas o que uma Esfera
faz — agrupar nodes, ter cor e ícone, arquivar sem apagar — é exatamente o que
`areas` faz desde a migration 0001, e `areas.id` é FK em `nodes` e em todo
satélite.

**Decisão.** Uma Esfera é uma linha de `areas`. A tabela **não** é renomeada:
`areas` está em cinco migrations imutáveis. "Esfera" é o nome na UI; `Area` é o
nome no código e no banco. Duas colunas novas (0005): `template` (que tela abrir)
e `is_system` (as 5 instaladas).

**Consequência.** Zero migração de dados, zero FK reescrita, e todo node que já
tinha `area_id` já pertence a uma Esfera. O custo é um nome duplo, documentado
em `entities.rs` e em `ipc.ts` — o glossário vive nos dois pontos de entrada.

**Alternativa recusada.** Renomear a tabela via recriação (`CREATE TABLE spheres`
+ copiar + dropar): uma migration destrutiva sobre a tabela mais referenciada do
schema, em troca de um ganho puramente cosmético.

---

## ADR-0014 — Ids fixos e legíveis no seed das 5 Esferas

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** A convenção do 0001 é UUIDv7 para todo id. Mas as 5 Esferas do
sistema nascem numa migration SQL, onde não há gerador de UUID.

**Decisão.** Ids fixos e legíveis (`sphere-health`, `sphere-finance`, …) para
essas 5 linhas e para os 6 bancos. O UUIDv7 continua valendo para tudo que o
usuário cria em runtime, onde a ordenação temporal mantém os inserts no fim da
B-tree.

**Consequência.** A migration É o seed: uma fonte só, sem um segundo seed em Rust
que possa divergir dela. `INSERT OR IGNORE` faz a operação ser idempotente.
Nenhum código busca por esses ids — a UI decide comportamento por `template`,
nunca por id, senão renomear "Saúde" quebraria a tela.

---

## ADR-0015 — Aurora → Midnight, e o tema claro derivado em vez de removido

**Data:** 2026-07-17 · **Status:** aceito · **supersede o design system do M0**

**Contexto.** O Aurora (M0) escolheu explicitamente buscar o "uau" só em
tipografia e hierarquia — "nunca de gradientes ou sombras pesadas", dizia o
`tokens.css`. O resultado, com o app cheio: fundo preto chapado, cards planos,
dado sem protagonismo. O usuário resumiu como "projeto de iniciante". A premissa
do Aurora estava errada, não a execução dela.

**Decisão.** Reescrever os tokens como **Midnight**: navy profundo (nunca #000),
fundo em três camadas (base + dot grid + aurora radial), números mono/tabular
grandes como protagonistas, e cor por Esfera tingindo cada tela via `--sphere`.
Os arquivos ficam onde estavam — renomear `design-system/` só produziria um diff
de imports.

**Sobre o tema claro:** o plano do Midnight especifica apenas o escuro. O claro
existe desde o M0, com toggle em Configurações. Ele foi **derivado** (as mesmas
camadas, com `--dot-alpha`/`--aurora-alpha` menores, porque sobre branco o mesmo
alfa vira sujeira em vez de brilho), não removido: apagar um recurso que funciona
por omissão de um documento seria uma decisão tomada por descuido.

**Consequência.** "Aurora" agora nomeia só a camada de gradiente radial do fundo
— o que aliás era mais uma razão para o design system deixar de se chamar assim.

---

## ADR-0016 — Sem ECharts no M2.5: SVG onde SVG é a ferramenta certa

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** O plano lista `nexusTheme.ts` (tema do ECharts) como entrega do
M2.5. Mas os únicos gráficos do M2.5 são 6 sparklines de 30 pontos e dois arcos
de progresso.

**Decisão.** Adiar ECharts (e o tema) para o M3, quando entram calendário e
gráficos com eixo, tooltip e zoom. No M2.5, `design-system/charts.tsx` em SVG.

**Consequência.** Uma instância de engine de gráficos por card do Hub custaria
uma ordem de grandeza mais de RAM e de tempo de montagem que as ~20 linhas de
`path` que ela desenharia — na tela que abre a cada cold start, contra um
orçamento de 1,5s e 300MB. Um tema escrito sem nenhum gráfico na tela para
conferir também seria um tema escrito no escuro.

---

## ADR-0017 — A cor da Esfera nunca é a única pista

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** A paleta das Esferas veio especificada no plano e está semeada na
0005. Rodada no validador de paletas (OKLab + simulação de daltonismo), ela
falha: Carreira `#A78BFA` × Finanças `#4D8DFF` ficam a ΔE 11 em visão **normal**
e ΔE 2,5 em protanopia — indistinguíveis por cor sozinha.

**Decisão.** Manter a paleta (é a identidade escolhida pelo usuário, e
`areas.color` é editável no banco) e tratar a cor como **tingimento, nunca como
codificação**. Todo lugar que mostra uma Esfera mostra também o ícone e o nome.

**Consequência.** Uma regra dura para o resto do produto: nenhum gráfico pode
plotar Esferas como séries distinguíveis só por cor com legenda de bolinha. Onde
isso for preciso (BI do M4.5), a série carrega rótulo direto.

**Nota.** Isto **não** vale para paletas categóricas de dados (ex.: alocação por
classe de ativo, M3.5) — essas nascem para codificar por cor e devem passar no
validador antes de entrar.
