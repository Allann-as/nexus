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

**Data:** 2026-07-17 · **Status:** ~~aceito~~ **superseded pelo ADR-0018**

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

---

## ADR-0018 — SVG no Hub é permanente; ECharts só em tela de análise

**Data:** 2026-07-17 · **Status:** aceito · **supersede o ADR-0016**

**Contexto.** O ADR-0016 adiou o ECharts "para o M3", o que deixava implícito
que os micro-gráficos do Hub migrariam para ele quando a dependência chegasse.
Não vão. O que o 0016 tratou como adiamento é, na verdade, uma fronteira
permanente entre duas ferramentas que resolvem problemas diferentes.

**Decisão.** A regra:

> **SVG para ≤ ~100 pontos decorativos; ECharts para telas de análise.**

- **SVG, para sempre** (`design-system/charts.tsx`): sparklines, anéis e o gauge
  do Hub e dos cards de Esfera. **Nunca** instanciar engine de gráfico no Hub —
  ele é o caminho do cold start, e o orçamento dele é o do app inteiro (1,5 s,
  300 MB). Um gráfico ali é uma FORMA, não uma leitura precisa: sem eixo, sem
  tooltip, sem zoom. Quem quer o número exato abre a Esfera.
- **ECharts, a partir do M3**, e só onde a tela é de análise: calendário e
  heatmaps, Finanças (área acumulada, donut de alocação) e Insights. Lá o que se
  pede — eixo, tooltip, brush, zoom, legenda — não se reimplementa à mão, e a
  tela não está no caminho do cold start.

**Consequência.** A pergunta "isto vira ECharts depois?" tem resposta fixa e não
volta a cada milestone. E o `nexusTheme.ts` nasce no M3 com um gráfico de
verdade na tela para conferi-lo — em vez de ser escrito no escuro agora.

**O sinal de que a fronteira foi cruzada:** precisar de eixo, tooltip ou
interação num gráfico do Hub. A resposta certa aí não é importar ECharts no Hub;
é que aquele gráfico não era do Hub.

---

## ADR-0019 — Carreira vira magenta

**Data:** 2026-07-17 · **Status:** aceito · **complementa o ADR-0017**

**Contexto.** O ADR-0017 aceitou a paleta como veio e mitigou o risco com uma
regra de uso (a cor tinge, nunca codifica). A medição, porém, era ruim demais
para parar por aí: o violeta `#A78BFA` da Carreira contra o azul `#4D8DFF` das
Finanças dava **ΔE 2,5 em protanopia** e **ΔE 11 em visão normal** — ou seja,
duas Esferas vizinhas no Hub que nem quem enxerga todas as cores separa bem.
Uma regra de uso protege contra o mau uso; ela não conserta a paleta.

**Decisão.** Trocar a Carreira por magenta `#EC4899`, que abre distância de
matiz do azul das Finanças e do ciano dos Estudos. Aplicado na migration 0006,
com guarda `AND color = '#A78BFA'` para não pisar em quem já escolheu a própria
cor. O violeta continua na paleta do wizard — como opção, não como padrão.

**Consequência.** A **separação CVD passa**: o pior par da paleta sai de ΔE 2,5
para ΔE 10,6 (protanopia). O padrão de fábrica agora nasce separável, e a regra
do ADR-0017 volta a ser o que devia ser — uma rede de segurança, não a única
defesa.

**O que continua fora do alvo, e por decisão.** Estudos (ciano `#38BDF8`) ×
Finanças (azul `#4D8DFF`) ficam a ΔE 13 em visão normal, abaixo do piso de 15.
Aceito: as duas sempre aparecem com ícone e nome (ADR-0017), e Estudos-ciano faz
parte da identidade. Registrado para ninguém "descobrir" isto de novo daqui a
seis meses e achar que é bug.

---

## ADR-0020 — Adicionar um `kind` custa uma recriação de `nodes`

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** O DATA_MODEL §2 promete desde o M0 que criar um tipo de entidade é
rotina: "1 valor no CHECK de `kind` + 1 satélite + 1 migration". O M3 cobrou a
promessa pela primeira vez (`milestone`, os sub-desafios) e descobriu o preço: o
SQLite **não sabe alterar um CHECK**. A única via é o *12-step procedure* —
recriar a tabela mais referenciada do schema, com o dado do usuário dentro.

**Alternativas recusadas.**

- **Reaproveitar um kind existente.** `task` faria o sub-desafio vazar para as
  listas de tarefa, para o "Hoje" e para o Nexus Score. `goal` pediria métrica,
  unidade e direção que um checkbox não tem. Um kind errado é para sempre — a
  string fica gravada no banco do usuário.
- **Tabela fora do padrão Node** (`goal_milestones` solta). Sub-desafio perderia
  busca, tags, links e timeline de graça, e o Node Pattern passaria a ter uma
  exceção — que é como um padrão morre.
- **Largar o CHECK na recriação.** Ele é a única defesa contra um kind digitado
  errado virar uma linha que nunca mais aparece em lugar nenhum.

**Decisão.** Pagar o 12-step, uma vez, com teste para cada armadilha, e deixar a
receita pronta para o próximo (`book`, no M4).

**Consequência.** As FKs passam a ser desligadas no runner durante as migrations
— não é afrouxar, porque `foreign_key_check` passou a rodar depois sobre o banco
INTEIRO, o que é mais forte que a checagem incremental (que só olha o que foi
tocado). As três armadilhas do procedimento (CASCADE comendo os satélites, rowid
renumerado quebrando a busca, rename explodindo nos gatilhos) falham **em
silêncio** — por isso cada uma tem um teste, e não uma revisão.

**Lição.** "1 valor no CHECK" era uma frase escrita sem nunca ter sido executada.
A promessa continua verdadeira; ela só não era barata.

---

## ADR-0021 — Recorrência: subconjunto da RFC-5545, materializado

**Data:** 2026-07-17 · **Status:** aceito

**Contexto.** O prompt mestre pede "recorrência RFC-5545". A RFC inteira permite
"a cada 2 meses, na terceira sexta, exceto em dezembro, contando da segunda
semana ISO" — e suportá-la significa carregar um parser e um motor de expansão
para sempre.

**Decisão.** Um subconjunto fechado (`daily`/`weekly`/`monthly`/`yearly`, com
intervalo), em JSON legível na coluna, no mesmo formato do `Schedule` dos
hábitos. E **materializar** as ocorrências 18 meses à frente, em vez de expandir
na leitura.

**Consequência.** Desenhar um mês do calendário é um range scan por `starts_at`:
o custo depende do mês pedido, não de quantas regras existem nem de há quanto
tempo. Com RRULE expandida na leitura, abrir novembro/2027 exigiria expandir toda
regra do banco desde o começo dos tempos — a cada troca de mês.

O preço é a janela de 18 meses e um job que a estende. Aceito: é o mesmo trade
que o Google Agenda faz.

**O caso que decidiu o desenho.** Um evento no dia 31, repetido mensalmente. Em
fevereiro o dia 31 não existe, e há duas saídas: pular o mês ou grudar no último
dia. Pular é pior — "todo mês" que some em fevereiro é um lembrete que falha
justamente onde o usuário confiou nele. E a ocorrência seguinte é calculada a
partir da **âncora**, não da anterior: senão a série derivaria 31 → 28 → 28 → 28
e o evento migraria de dia para sempre.

**Conflito é detecção, nunca bloqueio.** Intervalo meio-aberto (quem acaba às 10h
não conflita com quem começa às 10h, senão toda agenda cheia acusaria conflito),
e o app mostra o conflito sem impedir a escrita. Marcar duas coisas no mesmo
horário é uma decisão que o usuário tem o direito de tomar; o NEXUS avisa, não
manda.

---

## ADR-0022 — Toda ocorrência lembra de que TURNO da regra ela é

**Data:** 2026-07-17 · **Status:** aceito · **complementa o ADR-0021**

**Contexto.** O M3 precisava estender a janela de 18 meses da 0007, e a extensão
tem uma pergunta só: "até que turno desta regra o banco já foi materializado?".
A resposta parecia ser `MAX(starts_at)`. Não é — e quem quebra isso é o
timeblocking da mesma 0007: arrastar uma ocorrência **reescreve** o `starts_at`
dela (é a PK, e o UPDATE acontece no lugar). Depois de um arrasto, `starts_at`
não diz mais de que turno a linha é.

**As duas bordas erradas, medidas no papel antes de existirem em produção:**

- `MAX(starts_at)` sobre tudo: o usuário empurra a última terça materializada
  (17/01/2028) para 01/03/2028. A borda vira março; a extensão continua de lá; as
  terças de 18/01 a 28/02 **nunca nascem**. Um buraco de seis semanas, em
  silêncio.
- `MAX(starts_at)` ignorando as movidas: a borda volta para a terça anterior, e a
  extensão **regenera o slot de 17/01** — a terça que o usuário tirou dali
  reaparece às 19h. É o mesmo erro que a 0007 evita ao manter a linha da
  cancelada na tabela, entrando pela porta do arrasto.

**Decisão.** `event_occurrences.rule_start` (0008): `starts_at` é **quando** a
ocorrência acontece (o usuário manda, arrastando); `rule_start` é **quem** ela é
(a regra manda). Mais um índice UNIQUE `(event_id, rule_start)` — a invariante
"uma linha por turno" dita ao banco, e não confiada ao código.

**Consequência.** A idempotência da extensão sai de graça: `INSERT OR IGNORE`
sobre a UNIQUE descarta o turno que já existe, e "já existe" passa a incluir o
turno cuja linha foi arrastada para outro dia. Sem o índice, a idempotência seria
uma promessa do Rust; com ele, é uma propriedade do arquivo.

**Verificado dirigindo o app**, não só no teste: arrastar o "Dentista" das 15h
para as 17h30 deixou `starts_at=17:30`, `rule_start=15:00`.

---

## ADR-0023 — O ledger registra fatos vividos, não configuração de medição

**Data:** 2026-07-17 · **Status:** aceito · **ratificado pelo arquiteto 2026-07-17**

**Contexto.** A constituição diz que toda mutação relevante grava no ledger na
mesma transação. O toggle "qual barra manda" (métrica × sub-desafios, §5 da
0007) é uma mutação. Grava?

**Decisão.** Não. O ledger é a história do usuário — o que ele FEZ. Trocar a
régua é dizer como o feito é medido, e o feito não mudou: o peso de hoje é o
mesmo com a barra na métrica ou nos sub-desafios. O precedente já estava no M2:
`set_habit_schedule` também não grava.

**Consequência.** A Timeline (M4) não enche de "trocou a barra" — eventos que
ninguém procuraria e que empurrariam para baixo os que importam. A mesma regra
vale para o `move_milestone`: arrastar um sub-desafio é arrumar a mesa, e o M2 já
tinha decidido isso para o `move_task`.

**O critério geral (ratificado pelo arquiteto, regra para as próximas sessões).**
Antes de gravar qualquer mutação no ledger, pergunte:

> **Isso aconteceu na VIDA do usuário, ou na CONFIGURAÇÃO do app?**

Só o primeiro entra no ledger. "Marquei o sub-desafio", "registrei a pesagem",
"concluí a tarefa" — vida vivida, grava. "Mudei como a barra é calculada",
"reordenei a lista", "troquei o horário do lembrete", "mudei a cor da Esfera" —
configuração de como o app se comporta ou mede, **não grava**. Preferências não
são história; enchê-la delas é afogar os fatos reais nos ajustes de mesa.

---

## ADR-0024 — "A terceira terça do mês": agendada para o M4, não inventada no M3

**Data:** 2026-07-17 · **Status:** aceito · **complementa o ADR-0021** · **revisado 2026-07-17 pelo arquiteto**

**Contexto.** O prompt do M3 pede um seed com um evento recorrente na "terceira
terça do mês". O ADR-0021 fechou o vocabulário da recorrência em
`daily`/`weekly`/`monthly`/`yearly` com intervalo — e cita **"na terceira
sexta"** como exemplo do que ficou deliberadamente de fora. O `Monthly` é por dia
do mês; `BYDAY=3TU` da RFC-5545 não é expressável.

**Decisão (M3).** O código ganha. O M3 não inventa a variante para fazer um seed
bonito — semeia uma mensal por dia do mês ("Reunião de condomínio, todo dia 15"),
porque uma variante nova é gravada em JSON no banco do usuário **para sempre**, e
isso é decisão de arquitetura, não detalhe de dado de demonstração.

**Decisão do arquiteto (revisão).** A regra veio da spec original e é caso real
de agenda — consultas, reuniões mensais, vencimentos. Ela **não vai para o V2**:
fica **agendada para o M4**, junto do template "Agenda simples", que é o
milestone que já toca o calendário. Assim o M3.5 (Saúde + Finanças, a prioridade
do usuário) não atrasa por ela.

**Escopo fechado do item M4:**

- `Recurrence::MonthlyByWeekday { interval, week, weekday }` no enum (JSON legível,
  `tag` explícito, igual às outras variantes).
- Expansão em `domain::recurrence`, ancorada na âncora como as demais.
- Testes, incluindo:
  - **a 5ª ocorrência que não existe no mês** ("quinta sexta de fevereiro"): a
    expansão pula o mês em vez de escorregar para o mês seguinte — o mesmo
    princípio do dia 31 (ADR-0021), decidido na âncora.
  - **interação com `rule_start` e a idempotência da extensão** (ADR-0022/0026):
    materializar, estender a janela e reexpandir tem que respeitar a UNIQUE
    `(event_id, rule_start)` e não duplicar nem ressuscitar ocorrência movida.

**Consequência.** "Terceira terça do mês" deixa de ser uma lacuna e vira um item
com dono (M4) e escopo escrito — nenhuma sessão futura precisa redescobrir o
preço nem redecidir o lugar.

---

## ADR-0025 — O contador conta a partir de um piso, e o piso é o dia em que ele nasceu

**Data:** 2026-07-17 · **Status:** aceito · **achado dirigindo a UI**

**Contexto.** A 0007 criou o sub-desafio 'counter' ("30 dias de academia"), que
se preenche pelos ticks do hábito ligado em vez de pedir um número à mão. O que
ela não disse foi **de quando contar**, e a leitura ficou
`COUNT(*) FROM habit_ticks WHERE habit_id = ? AND status = 'done'` — desde o
começo dos tempos.

**O que a tela mostrou.** O hábito "Academia" tem 120 dias de histórico. O
sub-desafio "30 dias de academia", criado hoje, nasceu **marcado, exibindo
51/30**: um desafio ganho sem ter sido feito. Nenhum teste pegou isso — todos
usavam hábitos sem passado, que é o que um teste naturalmente cria.

**Decisão.** `milestone_details.counts_from` (0009), 'YYYY-MM-DD' local
calculado em Rust. O padrão é o dia da criação. O passado é aceito ("conte desde
o início do mês"); o futuro, não — mesma regra do `day` de um tick e do
`noted_at` de um checkpoint, e pelo mesmo motivo: uma data futura envenena em
silêncio o número que a tela mostra.

`NULL` continua significando "conta tudo": é o que dizem as linhas anteriores à
0009, e reescrevê-las com uma data inventada trocaria o dado do usuário por um
palpite nosso.

**Consequência.** Um contador mede um desafio, não o arquivo. E a lição é a de
sempre neste projeto: **a suíte verde não viu; a tela viu.** Um app dirigido só
por teste é um app testado contra dados que nunca tiveram passado.

---

## ADR-0026 — A janela se estende por um comando explícito, disparado pela navegação

**Data:** 2026-07-17 · **Status:** aceito · **fecha o gap #1 do M3**

**Contexto.** A 0007 materializa 18 meses à frente da âncora e registrou, no
próprio arquivo, que a extensão não existia: "navegar para o mês 19 mostra um mês
vazio". Faltava decidir **quem** a dispara.

**Decisão.** Um command de escrita, `extend_materialization(untilMonth)`, que a
UI chama ao navegar — o `useMaterializationWindow` pede sempre 3 meses à frente
do mês aberto.

**Por que não na leitura do calendário.** Materializar é ESCREVER, e o pool de
leitura abre `READ_ONLY` + `query_only=ON` (§4 da ARCHITECTURE) justamente para
não escrever. Estender ali daria `SQLITE_READONLY` na cara de quem virou o mês.

**Por que não um job de fundo.** Um job que roda "de tempos em tempos" precisa de
uma thread viva e de uma resposta para "e se o usuário navegar antes de ele
rodar?". O gesto que torna a extensão necessária é a navegação — e é ele que a
paga.

**Por que 3 meses, e por que idempotente.** Quem segura a seta passa por doze
meses antes de soltar; a série tem que estar lá quando ele parar. A resposta
normal é `0 escritas` (o mês pedido já existe), então o custo de perguntar é uma
comparação. A UNIQUE da 0008 (ADR-0022) garante o resto.

**Sem ledger.** Estender a janela não é um fato da vida do usuário: é o NEXUS
terminando de escrever uma decisão que já foi registrada quando a série nasceu.
Um evento por extensão encheria a Timeline de linhas que ninguém causou. Ver
ADR-0023 para a fronteira.

**Verificado dirigindo o app:** 19 cliques na seta do mês, de julho/2026 a
fevereiro/2028 — o mês que a 0007 prometia vazio abriu com 37 compromissos, e a
borda das séries andou de 2028-01-18 para 2028-05-30, sem uma linha duplicada.

---

## ADR-0027 — O ledger admite fatos que não são nodes

**Data:** 2026-07-17 · **Status:** aceito · **M3.5**

**Contexto.** Até o M3, toda linha do ledger falava de um node — `entity_kind`
era um `Kind` (note, task, goal…). O aporte (M3.5) é o primeiro FATO da vida do
usuário que **não** é um node: ele vive em `contributions`, não em `nodes`.
Forçá-lo a um `Kind` gravaria uma mentira na coluna (`entity_kind = 'note'`), e o
BI que filtra por ela pegaria o aporte junto com as notas.

**Decisão.** `LedgerEntityKind`: `Node(Kind)` para tudo que era, mais variantes
soltas para os fatos sem node (`Contribution` hoje). `impl From<Kind>` deixa os
26 call sites antigos escreverem `Kind::X.into()` — a mudança é mecânica e o
compilador aponta cada um.

**Consequência.** O aporte é um fato de verdade no ledger (ADR-0023: "isso
aconteceu na vida do usuário?" — sim), com `event_type = value_recorded`, e a
Timeline (M4) vai desenhá-lo sem um caso especial. O modelo do ledger deixou de
presumir que história é sempre sobre um node — o que era uma limitação
acidental, não uma decisão.

**A regra que fica.** Um fato novo sem node (uma sessão de foco no M5, um
snapshot) ganha uma variante em `LedgerEntityKind`, não um `Kind` emprestado. O
`Kind` é o vocabulário dos NODES; o ledger tem o seu, maior.

---

## ADR-0028 — `category` do exame já existia; a Saúde Financeira é computada, não gravada

**Data:** 2026-07-17 · **Status:** aceito · **M3.5** · duas divergências da spec, registradas

**Contexto.** A spec do M3.5 pede duas coisas que o código já resolvia de outro
jeito. Registrar as divergências aqui, porque "o código ganha" (regra da Fase 3).

**1. `event_details.category` — a spec pede "adicione `category TEXT`".** Ela já
existe: a migration **0007** a adicionou (`ALTER TABLE event_details ADD COLUMN
category`), com o índice `idx_event_category`. Os exames são eventos com
`category='exame'`, e o `events_by_category` só lê o que já estava lá. **Nenhuma
migration nova para isso** — criar uma segunda coluna `category` seria um erro
de duplicação.

**2. Saúde Financeira "gravada no ledger → gráfico de evolução".** A nota é uma
FUNÇÃO PURA do histórico de aportes (regularidade, diversificação,
consistência): computá-la a cada aporte e empilhar snapshots num ledger
append-only cria duplicação e um problema de upsert (uma nota por mês, muitos
aportes por mês). **Decisão:** a nota é computada ao vivo para o gauge, com
breakdown e fórmula; a evolução mensal, quando a tela existir, recomputa a nota
ao fim de cada mês a partir do MESMO histórico — determinístico, sem escrita.

**Por que é a escolha certa, não um atalho.** Um insight do NEXUS é sempre
computado e explicável (constituição §2). Gravar a nota seria gravar uma
derivação — e derivações que divergem da fonte são exatamente o bug que o
ledger-como-fonte-única evita. O job de fechamento de mês do M4.5 pode
materializar rollups se a performance pedir; por ora, recomputar é barato e
honesto.

**Consequência.** A parcela "progresso dos objetivos financeiros" (25 pts) não
tem dado no M3.5 — os objetivos são M4. Ela se **redistribui** (ADR-0014), como
a rotina matinal do Nexus Score: a nota não é castigada por uma feature que
ainda não existe, e ganha a parcela sozinha quando o M4 chegar.

---

## ADR-0029 — Um `kind` novo custa uma recriação de `nodes`; dois custam uma só

**Data:** 2026-07-17 · **Status:** aceito · **M4** · **complementa o ADR-0020**

**Contexto.** O M4 traz dois tipos novos de node: `fin_goal` (as caixinhas) e
`book` (a Biblioteca). Cada um, sozinho, exigiria a recriação de `nodes` — o
SQLite não sabe alterar um CHECK (ADR-0020). Duas migrations separadas fariam o
DROP/CREATE da tabela mais referenciada do schema **duas vezes**, com o dado do
usuário dentro das duas.

**Decisão.** A migration **0011** paga o 12-step UMA vez para o milestone inteiro:
os dois kinds entram no mesmo CHECK, na mesma recriação. As três armadilhas
(CASCADE, rowid, rename dos gatilhos de FTS) têm teste em `migrations.rs`, agora
provando que uma SEGUNDA recriação sobre dados já existentes também as evita.

**Por que kinds próprios, e não reúso.** `fin_goal` não é um `goal`: uma caixinha
tem alvo em CENTAVOS e um banco, não métrica/unidade/direção — e vazaria para a
tela de Metas. `book` não é nenhum dos existentes. Um kind errado fica gravado no
banco do usuário para sempre (a lição do ADR-0020).

**Consequência.** `fin_goal_details`, `fin_goal_deposits`, `book_details` e
`reading_goals` nascem na mesma 0011. O custo do 12-step é pago o mínimo de vezes.

---

## ADR-0030 — "A terceira terça" existe agora, e pula o mês que não a tem

**Data:** 2026-07-17 · **Status:** aceito · **M4** · **cumpre o ADR-0024**

**Contexto.** O ADR-0024 agendou `MonthlyByWeekday` para o M4 com escopo fechado.

**Decisão.** `Recurrence::MonthlyByWeekday { interval, week, weekday }` (JSON
`monthly_by_weekday`, `week` 1–5, `weekday` 0=domingo). A expansão, quando o mês
não tem a N-ésima ocorrência (a 5ª sexta que não existe), **pula o mês** — decidido
na âncora, o mesmo princípio do dia 31 (ADR-0021), só que ali a saída é grudar no
último dia e aqui é pular (uma "5ª sexta" que virasse a 1ª do mês seguinte seria um
dia que ninguém pediu). Testes cobrem a 5ª inexistente e a idempotência da extensão
(reexpandir uma janela sobreposta devolve as mesmas datas, então a UNIQUE
`(event_id, rule_start)` nunca duplica).

**Na UI.** O `EventModal` não pede "semana" e "dia" num abstrato: ele deriva
`week`/`weekday` da DATA do evento ("Toda 3ª terça" aparece pronta quando o evento
cai numa 3ª terça). O usuário marca um evento; a opção se oferece sozinha.

---

## ADR-0031 — A parcela "Objetivos" da Saúde Financeira ganhou fonte

**Data:** 2026-07-17 · **Status:** aceito · **M4** · **cumpre o ADR-0028**

**Contexto.** O ADR-0028 deixou os 25 pontos de "progresso dos objetivos" se
**redistribuindo** no M3.5, porque as caixinhas eram do M4.

**Decisão.** A parcela agora lê a **média de progresso (`saved/target`, saturado em
1) das caixinhas ATIVAS** (`FinGoalRepository::active_progress`). `None` (nenhuma
caixinha) continua redistribuindo — a nota não pune quem não usa a feature. Nada em
`financial_health.rs` mudou: a redistribuição já estava lá, só faltava o número. O
`FinanceService` ganhou a injeção de `FinGoalRepository` que já estava reservada.

---

## ADR-0032 — Um marco de carreira é um fato do ledger, não um node

**Data:** 2026-07-17 · **Status:** aceito · **M4** · **aplica o ADR-0027**

**Contexto.** Uma promoção, uma certificação, um novo emprego (§2.3) precisam
aparecer na Timeline com destaque. São fatos da vida do usuário — mas não têm tela,
satélite nem status a editar.

**Decisão.** `LedgerEntityKind::CareerMilestone` — a terceira variante sem node
(depois de `Contribution`), exatamente como o ADR-0027 previu ("um fato novo sem
node ganha uma variante, não um `Kind` emprestado"). O `CareerService` fala direto
com o ledger: `record_milestone` grava um evento com `entity_kind='career_milestone'`
e `payload.kind` (promotion/certification/new_job…); o painel lê por
`by_entity_kind`. Sem satélite, sem CHECK de banco — a validação do tipo vive no
DTO (`CareerMilestoneKind`), porque um append-only não tem onde pôr um CHECK.

**Consequência.** Marcos são imutáveis (append-only). Se um dia forem editáveis,
viram nodes — mas isso é decisão de outro milestone.

---

## ADR-0033 — Notas: o corpo resincroniza só os wiki-links; anexos são outra coisa

**Data:** 2026-07-17 · **Status:** aceito · **M4** · primeiro uso pleno de `links`

**Contexto.** A tabela `links` (0001) existia sem consumidor de código. As Notas
(§2.5) são o primeiro: `[[wiki-links]]` resolvidos viram elos, com backlinks do
outro lado. Anexos também são elos (nota → arquivo).

**Decisão.**
- **Wiki-links** usam `link_type='references'`. Salvar o corpo REESCREVE só os
  'references' desta nota (delete + insert dos resolvidos) — tirar um `[[elo]]` do
  texto apaga o link, e o backlink some junto.
- **Anexos** usam `link_type='attached_to'` e **não são tocados** ao salvar o corpo:
  eles não vêm do texto. Sem essa separação, reeditar uma nota apagaria seus anexos.
- Um `[[Título]]` sem node correspondente fica **pendente**: sem link no banco (não
  se aponta para o que não há), pintado diferente na UI.
- **Anexos** são copiados para `media/AAAA/MM/<sha>.<ext>` com **SHA-256** (sha2):
  integridade e **dedup** — o mesmo conteúdo é gravado uma vez. Colar imagem do
  clipboard é o mesmo caminho, são só bytes.
- A URL do asset no front usa a **raiz real** (`data_root` → `%APPDATA%/Nexus`), não
  o `appDataDir()` do Tauri (que aponta para a pasta do identificador do bundle, um
  diretório diferente). O protocolo `asset:` é habilitado com escopo em
  `$APPDATA/Nexus/media/**` (feature `protocol-asset`), e a CSP já o admitia.

---

## ADR-0034 — A Timeline congela meses pela navegação, não por um job de fundo

**Data:** 2026-07-17 · **Status:** aceito · **M4** · **espelha o ADR-0026**

**Contexto.** A visão ANO lê `timeline_rollups` (meses congelados) para abrir em
< 100 ms sem varrer o ledger. Alguém tem que congelar.

**Decisão.** `ensure_rollups` congela todo mês COMPLETO ainda pendente, e a UI o
chama ao abrir a Timeline — o mesmo padrão da extensão do calendário (ADR-0026): o
gesto que torna o congelamento necessário é a navegação, e é ele que paga a escrita
(o pool de leitura é `query_only`; congelar ali daria `SQLITE_READONLY`). Idempotente
e barato quando não há nada a fazer (compara duas listas de meses).

**A visão ANO mescla congelado + ao vivo:** meses completos vêm dos rollups; o mês
CORRENTE, que ainda não fechou, é computado ao vivo do ledger — a tela nunca mostra
o mês em curso vazio.

**O que os rollups guardam, e o que fica para o M4.5.** Contagens por mês (eventos,
conquistas, marcações). O **Nexus Score histórico por mês** (que exigiria recomputar
o score sobre o estado de cada mês) fica para o M4.5, junto do `bi_engine` — o
rollup de contagem já entrega a visão ANO com textura, e o Score entra na mesma
tabela quando o motor chegar.

---

## ADR-0035 — O wizard cria só 'simple'; a Agenda é o calendário; a Checklist é um projeto

**Data:** 2026-07-17 · **Status:** aceito · **M4** · duas divergências da spec, registradas

**Contexto.** A §2.4 pede o wizard "+ Nova Esfera" com escolha de template
("Completa" ou "Agenda simples"), uma Agenda com "checkbox de concluído" e
Checklists reordenáveis.

**Decisão (divergências, porque o código ganha).**

1. **O wizard cria só `simple`.** `Template::user_creatable()` já retornava
   `[Simple]` (ADR-0013/0014): uma segunda Esfera "Completa" com dashboard de
   Finanças partiria o patrimônio em duas telas que nunca somam. E o template
   `simple` já traz Painel + Metas + Agenda + Checklists — a distinção "Completa vs
   Agenda" colapsa numa Esfera só, flexível. O wizard mostra o campo template
   desabilitado explicando por quê. (O wizard já existia no código; o M4 só ligou as
   tabs `simple`.)

2. **A Agenda é o calendário unificado.** Um compromisso é um `event` (mesma tabela,
   mesma tela): criar na Agenda e abrir o Calendário mostra o mesmo item. O "checkbox
   de concluído" por ocorrência **não** foi implementado: o modelo de eventos do M3
   não tem estado de conclusão por ocorrência (só scheduled/cancelled/moved), e
   forçá-lo exigiria uma coluna nova numa migration — decisão de outro milestone.
   Quem quer marcar "feito" usa uma Checklist ou uma Tarefa.

3. **Uma Checklist é um `project`; cada item é uma `task`.** `completed_at` da tarefa
   É o checkbox, e `sort_order` (REAL, ADR-0015) dá o reordenável — zero tabela nova.

---

## ADR-0036 — M4.5: dois kinds novos ('annual_goal', 'challenge') numa recriação só, e a Meta Anual REUSA o padrão de goal, não a tabela

**Data:** 2026-07-17 · **Status:** aceito · **M4.5** · **complementa o ADR-0029**

**Contexto.** O M4.5 traz a seção **Metas Anuais** e as **Temporadas/Desafios**.
Cada uma quer ser um node — pertence a uma Esfera, tem título, status, aparece na
busca, nos links e na Timeline —, e cada `kind` novo custa uma recriação de
`nodes` (ADR-0020: o SQLite não sabe alterar um CHECK).

**Decisão.**

1. **Um kind para cada, numa recriação só (0012).** `annual_goal` e `challenge`
   entram no mesmo 12-step — a TERCEIRA recriação do projeto, a segunda sobre dado
   já existente. As três armadilhas (CASCADE, rowid, rename dos gatilhos de FTS)
   ganham mais um teste em `migrations.rs`. É a decisão do ADR-0029 aplicada de
   novo: pagar a recriação o mínimo de vezes.

2. **A Meta Anual reusa o PADRÃO de goal, não a tabela `goal_details`.** Um
   `annual_goal_details` próprio guarda `year`, `goal_kind` (binary/quantitative),
   `metric_name`/`target_value`/`current_value`/`unit`. Por que não `goal_details`:
   ela tem `direction` e `start_value` obrigatórios que uma meta binária ("mudar de
   emprego") não tem, e `goal_checkpoints.goal_id` referencia `goal_details(node_id)`
   por FK — reusá-la obrigaria uma linha-fantasma em `goal_details` para cada meta
   anual. O progresso de uma meta anual quantitativa é `current_value/target_value`,
   e cada atualização de `current_value` vira um evento `goal_checkpoint` no **ledger**
   (a história da meta), não linhas numa tabela de checkpoints diários — uma meta
   anual é um horizonte, não um diário de medições como uma meta de peso.

3. **O estado da Meta Anual e da Temporada É o `nodes.status`.** ativa=`active`,
   concluída=`done`, abandonada=`dropped`, arquivada=`archived`. Nenhuma coluna de
   status nova. "Vencida" (a janela da temporada fechou sem bater o alvo) é
   **derivada** (`ends_on < hoje` e ainda `active`), nunca gravada: um estado que só
   depende da passagem do tempo mentiria até um job corrigi-lo.

**Escopo fechado da Temporada.** A fonte de progresso é um CHECK de dois valores:
`habit_days` (conta os ticks 'done' de um hábito ligado na janela — reusa
`habit_ticks`) ou `manual` (um contador que o usuário incrementa, cobrindo
qualquer objetivo que não seja um hábito). Ligar uma temporada a uma meta ou a um
projeto inteiro fica para V2 — `manual` já cobre o caso geral sem inchar o M4.5.

**Consequência.** `annual_goal_details` e `challenge_details` nascem na 0012. O
custo do 12-step é pago uma vez para os dois; o padrão node se estende sem virar
martelo (a Meta Anual pega o que precisa do goal, não a tabela inteira).

---

## ADR-0037 — XP e níveis são DERIVADOS do estado, nunca estado sagrado novo

**Data:** 2026-07-17 · **Status:** aceito · **M4.5**

**Contexto.** A gamificação (§2.2) dá XP por Esfera a cada feito e níveis por uma
curva (`nível n custa 100·n^1.5 XP`). A pergunta: XP é uma coluna que se soma a
cada tick, ou um número computado?

**Decisão.** **Computado.** XP por Esfera é a soma dos pontos de tudo que o usuário
fez (`habit_ticks`, tarefas concluídas, `goal_checkpoints`, livros terminados,
caixinhas fechadas, temporadas vencidas, metas anuais concluídas), agrupado pela
`area_id` do node — recomputável a qualquer momento a partir do estado. A tabela de
pontos e a curva de nível vivem em `domain::xp` (puras, testadas) e estão
documentadas em `docs/DATA_MODEL.md`. O resultado é cacheado em `insight_cache`
como qualquer outro insight; a fonte da verdade é o estado, não o cache.

**Por que não uma coluna de XP.** Uma coluna que se incrementa a cada ação é um
segundo estado que pode divergir do primeiro — exatamente o bug que o
ledger-como-fonte-única evita (a lição da Saúde Financeira, ADR-0028). Um XP
gravado que discorda do que os ticks dizem é um número em que ninguém confia. E a
constituição §2 manda: todo número do NEXUS é computado e explicável.

**Consequência.** Apagar um tick ajusta o XP na próxima recomputação, sem lixo a
reconciliar. **Subir de nível NÃO grava evento no ledger** neste milestone: o nível
é derivado, e um "leveled_up" gravado seria estado derivado congelado que a
recomputação poderia contradizer. A celebração de nível é da UI, no momento em que
a tela vê o número subir. (A evolução de skills da Carreira, no M4.6, é outra
história: lá o "subiu de nível" é um fato registrado pelo usuário, não uma derivação.)

---

## ADR-0038 — Conquistas: catálogo no código, desbloqueio no ledger, sincronização idempotente

**Data:** 2026-07-17 · **Status:** aceito · **M4.5** · unifica o 🏆 ad-hoc do M4

**Contexto.** O M4 já gravava "conquistas" soltas no ledger (a caixinha fechada, o
livro terminado) como eventos `completed` com um campo `achievement` no payload. O
M4.5 pede uma **galeria** (desbloqueadas + silhuetas das bloqueadas) e mais famílias
(streaks 7/30/100/365, N revisões, meses de aporte, temporadas). Isso precisa de
uma fonte única de "o que já foi desbloqueado".

**Decisão.**

- **O catálogo vive no código** (`domain::achievements`): cada conquista é uma regra
  (`métrica >= limiar`), e regras são código, não linhas. Cada uma traz `key`
  estável, título, descrição, ícone **Lucide** (nunca emoji — M4.6 §3.2) e um `tier`
  visual.
- **O desbloqueio é um evento no ledger** — `event_type = achievement_unlocked`,
  `entity_kind = achievement`, `entity_id = <key>`. Um fato da vida do usuário
  (ADR-0023: "aconteceu?" — sim), que a Timeline mostra e a galeria lê.
- **A sincronização é idempotente.** Um passo (`sync_achievements`) computa as `key`s
  que os contadores atuais satisfazem (`achievements::evaluate`), subtrai as que o
  ledger já registrou, e grava só a diferença — numa transação. Rodar duas vezes não
  duplica; o `entity_id = key` é a UNIQUE lógica.

**Por que não derivar a galeria só do estado, sem ledger.** Uma conquista tem uma
DATA (quando caiu) que só o ledger guarda, e a Timeline a quer como fato. Derivar
"desbloqueada agora" a cada abertura perderia o "desbloqueada em março".

**Sobre o 🏆 do M4.** Os eventos `book_finished`/`fin_goal_complete` continuam como
fatos próprios ("livro terminado", "objetivo alcançado"); o catálogo tem conquistas
que a sincronização desbloqueia lendo o MESMO estado (ex.: `book_first`), sem
conflito — são camadas distintas: o fato da vida, e a conquista que ele cruza.

---

## ADR-0039 — O Nexus Score do dia é congelado no ledger; o passado nunca é recomputado

**Data:** 2026-07-17 · **Status:** aceito · **M4.5** · decisão do arquiteto (§1 do prompt)

**Contexto.** O Score do dia (`domain::score`) é computado ao vivo para o Hub. Para
a Timeline mostrar a evolução histórica do Score, alguém precisa guardá-lo — e a
pergunta é se o histórico é recomputado sob demanda ou congelado.

**Decisão (do arquiteto).** **Congelar.** O Score de um dia vira um evento diário no
ledger — `event_type = nexus_score`, `entity_kind = daily_score`, `entity_id = <dia
YYYY-MM-DD>` — com o valor e a **versão da fórmula** no payload. O fechamento de mês
o agrega em `timeline_rollups` (a tabela que já existe desde a 0003, cumprindo o
ADR-0034). **O passado nunca é recomputado.**

**Por que congelar, e não recomputar.** É a filosofia do ledger: a história é o que
você viu na época. Recomputar o Score de um dia de 2024 sobre a fórmula de 2026
reescreveria o que o app te mostrou naquele dia — e a fórmula EVOLUI (pesos podem
mudar quando features novas entram, como os 20% da rotina matinal ou os 25% dos
objetivos financeiros que já se redistribuíram). A versão no payload documenta a
transição: se a fórmula muda, muda daí para frente, e cada linha antiga diz sob qual
versão nasceu.

**Um por dia.** O `entity_id = dia` é a UNIQUE lógica; congelar o Score de um dia que
já tem linha é no-op. O congelamento roda no fechamento do dia (na abertura do app,
para o dia anterior ainda não gravado) — o mesmo padrão "a navegação paga a escrita"
do ADR-0026/0034, e pela mesma razão (o pool de leitura é `query_only`).

---

## ADR-0040 — O bi_engine: worker com debounce, cache lido pelo front, dois comandos

**Data:** 2026-07-17 · **Status:** aceito · **M4.5** · realiza a §5 do prompt mestre

**Contexto.** A §5 pede um motor de BI "fora da thread de UI": conexões read-only,
resultados no `insight_cache` com `input_hash`, recomputação na abertura do app e
marcação debounced de 30 s. Faltava decidir a forma concreta no NEXUS.

**Decisão.**

- **`InsightService` (application)** lê do pool `query_only` (`with_read`) e grava
  só o cache. Três métodos: `get` (lê o cache, instantâneo), `recompute` (faz a
  conta e grava) e `refresh_if_stale` (recomputa **só se** a `input_signature` mudou
  — uma comparação de string barata; a segunda trava, além do worker).
- **`input_signature`** é uma string com os contadores e marcas d'água das fontes
  (`COUNT`/`MAX(ts)` de `habit_ticks`, `COUNT` de `event_occurrences`/`nodes`,
  `MAX(seq)` do `ledger`, `COUNT` de `goal_checkpoints`). É o `input_hash` do
  DATA_MODEL §5 — gravada crua, sem hash: legível e determinística.
- **`InsightWorker` (thread + mpsc)** aquece o cache no boot e, depois, recomputa
  **debounced**: `mark_dirty` sinaliza, e o worker espera 30 s de silêncio (via
  `recv_timeout`) antes de refazer — uma rajada de marcações custa UMA recomputação.
- **Dois comandos.** `get_insights` (o front lê o cache, instantâneo) e
  `recompute_insights` (cutuca o worker **e** faz um `refresh_if_stale` síncrono,
  devolvendo o pacote fresco). O comando síncrono garante que a tela veja dado
  atual sem corrida; ele roda na thread-pool de comandos do Tauri, nunca na de UI.

**O que o motor calcula no M4.5.** Correlações entre pares de hábitos (2×2 sobre os
dias em que ambos estavam agendados, `domain::correlation`) e a guarda anti-burnout
(`domain::burnout`). Ofensores por dia da semana e heatmaps **já existiam** como
comandos próprios desde o M3.5 (`habit_weekday_stats`, `habit_heatmap`); tendências
de meta são a `domain::projection` do M3. O motor é o lar dos insights que cruzam
entidades (correlação) ou exigem janela móvel (burnout) — não uma segunda casa para
o que já tem tela.

**Divergência honesta da spec.** A carga da semana da guarda anti-burnout é
`ticks 'done' + ocorrências de evento`, não "`duration_min` + eventos": hábitos não
têm duração no schema (só `target_value`/`unit`), então a contagem de cumprimentos é
o proxy de carga disponível hoje. Fica registrado para não parecer esquecimento; se
um dia hábitos ganharem duração, a fórmula soma minutos sem mudar a arquitetura.

**Job noturno e fechamento de mês.** O `refresh_if_stale` no boot cobre a
recomputação diária; um agendador noturno dedicado entra com o M5 (backup/manutenção),
onde já haverá um lugar para tarefas periódicas. O congelamento de rollups do Score
é o ADR-0039/0034.

---

## ADR-0041 — O Score congelado é COMPORTAMENTAL; rotina e inbox são sinais de agora

**Data:** 2026-07-17 · **Status:** aceito · **M4.5** · **refina o ADR-0039**

**Contexto.** O ADR-0039 decidiu congelar o Nexus Score de cada dia no ledger. Ao
implementar, uma pergunta apareceu: o score ao vivo (`domain::score::compute`) tem
QUATRO parcelas — hábitos (40%), tarefas (30%), rotina matinal (20%) e inbox zerada
(10%). Duas delas não são reconstruíveis para um dia que passou:

- **Rotina matinal** é INFERIDA do estado corrente (qual hábito tem lembrete antes
  das 12h, `DashboardService::morning_routine_progress`) — não há registro histórico
  de "qual era a rotina naquele dia".
- **Inbox zerada** é o inbox de HOJE; o inbox de uma terça de três meses atrás não é
  reconstruível sem reprocessar todo o ledger de triagem, e mesmo assim de forma frágil.

**Decisão.** O score CONGELADO usa só as duas parcelas que a história prova:
**hábitos (agendados/cumpridos) e tarefas (planejadas/concluídas) do dia**, com os
pesos redistribuídos entre elas (ADR-0014) — `domain::score::behavioural`. O payload
grava `formulaVersion = "m4.5-behavioural"`, então a diferença fica documentada em
cada linha. O score AO VIVO do Hub continua com as quatro parcelas: ele mede o agora,
onde rotina e inbox existem.

**Duas aproximações honestas, registradas.** (1) A agenda dos hábitos aplicada ao
passado é a agenda ATUAL — trocas de agenda não são versionadas; um hábito que virou
"3× por semana" ontem conta como tal para todo o histórico. (2) Só hábitos ATIVOS
entram; um hábito arquivado depois some da reconstrução. Ambas movem o número de
alguns pontos em casos raros e nunca a direção da tendência — que é o que o gráfico
mostra.

**Sem rollup pré-agregado para o Score.** Ao contrário das contagens de evento (que
podem ser milhares por mês e por isso viram `timeline_rollups`), o score é ≤ 1 evento
por dia — ≤ 366 por ano. Ler e mediar um ano de scores congelados do ledger é trivial;
pré-agregar seria complexidade sem ganho. O `score_history` lê direto do ledger
(`entity_kind = daily_score`), filtrado por `day` (usa `idx_ledger_day`).

**A escrita mora na abertura.** `freeze_daily_scores` congela os dias FECHADOS ainda
sem linha (teto de 60 dias por passada), idempotente pelo `entity_id = dia`. Mesmo
padrão "a navegação paga a escrita" do ADR-0026/0034 — o pool de leitura é `query_only`.

---

## ADR-0042 — Aurora 2.0: emoji fora da UI, e a coluna `emoji` da caixinha vira nome de ícone

**Data:** 2026-07-17 · **Status:** aceito · **M4.6** · §3.2 do redesign

**Contexto.** O redesign Aurora 2.0 baniu emoji da interface: eles quebram a
consistência tipográfica premium. A varredura achou emoji em telas (conquistas,
carreira, caixinhas, estrelas de nota), em `title_snapshot`s gerados pelo backend
(o 🏆/📖/★ que a Timeline desenha) e na personalização das caixinhas — o usuário
escolhia um EMOJI para cada caixinha, guardado em `fin_goal_details.emoji` (0011).

**Decisão.**

1. **Toda a UI passa a Lucide/SVG.** Ícones por componente (carreira, troféus) ou
   por NOME resolvido em runtime (`DynamicIcon` para conquistas, `GoalIcon` para
   caixinhas). Um teste vitest (`no-emoji.test.ts`) varre `src/` via
   `import.meta.glob` e falha se um emoji reaparecer — a rede de segurança que o
   arquiteto pediu, no espírito do teste do catálogo de conquistas.

2. **A coluna `fin_goal_details.emoji` passa a guardar o NOME de um ícone Lucide**
   (`"target"`, `"gamepad2"`…), não um emoji. O nome da coluna é **legado** — como
   "Aurora" nomeia só a camada de gradiente (ADR-0015), "emoji" agora nomeia "o
   ícone". Não há migration: a coluna é TEXT, e `GoalIcon` cai num ícone padrão
   (`Target`) para qualquer valor que não seja um nome conhecido — as caixinhas
   antigas, que guardam um emoji de verdade, continuam abrindo, só com o ícone
   padrão. Reescrever os dados do usuário por um palpite seria pior que o fallback.

3. **Os `title_snapshot`s NOVOS nascem sem emoji** ("Objetivo alcançado — X",
   "Terminou \"Y\" (5/5)"). Os ANTIGOS, já no ledger, mantêm o emoji: o ledger é
   append-only e imutável (a história é o que você viu na época). A Timeline
   renderiza o que está gravado; o passado não é reescrito para agradar o presente.

**Consequência.** A UI é tipograficamente consistente daqui para frente, sem tocar
no dado histórico. O único emoji que sobrevive é o de linhas de ledger antigas — e
esse é intocável por princípio. O `favicon` de um Artifact de preview não conta: é
a aba do navegador, não a UI do NEXUS.

## ADR-0043 — A marca é o astrolábio, e um logo é ativo fixo — não se tinge com o tema

**Data:** 2026-07-18 · **Status:** aceito · **M4.6** · §1 do redesign

**Contexto.** A primeira leva de logos (M4.6 1/n, "bolinhas ligadas por traços")
foi rejeitada por genérica. O arquiteto pediu execução de outro nível: grade de
construção real, UMA cor dominante numa rampa tonal (não matizes chapados), luz
consistente, hierarquia de traço, detalhe que recompensa o zoom, e três níveis de
detalhe (marca → ícone → favicon 16px). Foram gerados três conceitos novos em
`docs/logo-concepts-v2/` (astrolábio, fita-N, selo facetado), cada um construído
por `generate.mjs` — a geometria nasce de math a partir do centro, nada "a olho".

**Decisão.**

1. **O conceito escolhido é o ASTROLÁBIO.** Anéis concêntricos = as esferas da
   vida; o limbo externo graduado como instrumento de medida; a alidade cruzando o
   centro a −34°; o núcleo como o nexo, e é ele que brilha. A metáfora fecha com o
   produto: o NEXUS é o instrumento com que se navega a própria vida.

2. **A geometria mora em `generate.mjs` (docs) e em `design-system/NexusMark.tsx`
   (app), com os MESMOS números** (centro 120, raios 104/84/65/47, alidade −34°). O
   componente React é a marca in-app (cabeçalho do menu, e o Sobre quando o item 8
   chegar); o splash do `index.html` desenha a mesma figura antes do React montar.

3. **Um logo é ativo de marca com UMA identidade — não se tinge com o tema nem com a
   Esfera.** Por isso `NexusMark` usa a rampa índigo (`#7C8CF8` e vizinhos) em hex
   cru, a exceção consciente à regra "hex cru em componente é bug": a variável de
   tema seria o erro aqui. O `NexusMark` antigo (um "N" em `var(--accent)`) tingia
   com o tema — era placeholder, não marca.

4. **Os ícones do bundle vêm de uma variante BOLD** (`astrolabe/appicon.svg`): anéis
   grossos, núcleo grande, 12 tiques. O astrolábio detalhado vira borrão em 32px; a
   variante bold é o nível "ícone simplificado" da receita, e sobrevive ao downscale
   do `tauri icon` para 32/16px com dignidade. O afinamento por-tamanho do `.ico`
   (arte diferente por resolução) fica para o M6, que finaliza o ícone e o instalador.

**Consequência.** A marca tem permanência e uma só identidade em qualquer fundo. Os
outros dois conceitos ficam arquivados em `docs/logo-concepts-v2/` — se um dia a
marca for revista, o ponto de partida é rico, não um recomeço do zero.

## ADR-0044 — Navegação interna por Esfera: um padrão único, com indicador de estado real

**Data:** 2026-07-18 · **Status:** aceito · **M4.6** · §2.3/2.4 do redesign

**Contexto.** Dentro de uma Esfera, a navegação eram tabs "pill" (Painel/Metas/
Checkpoints…) num `Record<Template, Tab[]>` local do `SphereScreen`: rótulo puro,
sem ícone, sem estado, e o estado da tab morava num `useState` (não deep-linkável,
o "voltar" não voltava). O redesign pediu navegação **contextual da Esfera** com
ícone + **micro-indicador de estado** por seção, e teclado de primeira classe.

**Decisão.**

1. **Um catálogo único (`features/spheres/sections.ts`), como `app/navigation.ts` é
   para o global.** `SPHERE_SECTIONS[template]` dá as seções (chave, rótulo, ícone
   Lucide, e qual indicador cada uma mostra). O `SphereNav` desenha, o `SphereScreen`
   resolve o conteúdo, e a Command Palette registra cada seção como destino — todos
   leem a MESMA lista. A anatomia é idêntica em toda Esfera (ADR-0044 é sobre isso):
   o que muda por Esfera é cor, ícones e seções, nunca o desenho.

2. **O micro-indicador é REAL ou não existe.** `resolveIndicator` (função pura)
   traduz um `IndicatorKind` num rótulo a partir de números crus (o `SphereCard` do
   Hub, custo zero, para streak/checkpoints/projetos; um `count_nodes` barato para
   metas/caixinhas/leitura ativas). Sem dado → o indicador é **omitido**, nunca um
   zero inventado. Streak de 0, `habitsTodayTotal` de 0 etc. somem.

3. **A seção ativa mora no URL (`?s=<chave>`), não em estado.** Deep-linkável, o
   "voltar" funciona, e é o que permite o **Ctrl+K abrir "Saúde · Treino" direto**.
   Troca de seção usa `replace` (as setas não devem entulhar o histórico). Chave
   inválida cai na primeira seção.

4. **Teclado:** o `SphereNav` é um `tablist` de verdade — roving tabindex, setas/
   Home/End movem e ativam, `1–9` saltam. Motion na troca: a `key={active}` remonta
   o bloco e dispara `nexus-section-enter` (fade + 6px, `--dur-base`, `--ease` =
   `cubic-bezier(0.2,0,0,1)`), neutralizado pelo `prefers-reduced-motion` global.

5. **As pills antigas morreram em TODAS as Esferas no mesmo commit** — nada de
   estado híbrido. O conceito de tab "com marco" (desabilitada até um milestone)
   saiu junto: no M4.6 toda seção já tem conteúdo.

**Consequência.** Uma anatomia só, consistente, que segura conteúdos muito
diferentes (checkpoints da Saúde, aportes das Finanças, biblioteca dos Estudos) sem
um design por Esfera. Os indicadores começam onde o dado já existe; Carreira (item 6)
e Estudos (item 7) aprofundam os seus quando trouxerem os dados novos.

## ADR-0045 — Uma recriação de `nodes` para 'skill' E 'subject': olhar o item 7 antes de escrever a migration do 6

**Data:** 2026-07-18 · **Status:** aceito · **M4.6** · §2.6/2.7 do redesign

**Contexto.** O item 6 (Carreira) pede competências com nível; o item 7 (Estudos),
logo depois, pede matérias e sessões de estudo. Um `kind` novo custa a recriação de
`nodes` (o SQLite não sabe alterar um CHECK — ADR-0020), a operação mais cara e
perigosa do schema. A regra do projeto é pagá-la o mínimo de vezes (ADR-0029/0036).
Escrever a migration do 6 sem olhar o 7 arriscaria uma QUINTA recriação semanas
depois.

**Decisão.** Levantar os kinds dos DOIS itens agora e pagar UMA recriação (a quarta,
migration `0013`) para ambos:

1. **`skill`** (Carreira) — uma competência tem um NÍVEL que sobe; não é um `project`
   (entregável com tarefas). Satélite `skill_details` (level, category, max_level).
2. **`subject`** (Estudos) — uma matéria é a espinha do rastreio de estudo, com
   progresso próprio agregando sessões/livros/notas; não é um `project` (que
   Idiomas/Faculdade/Cursos seguem reusando). Satélite `subject_details`.

**O que NÃO virou kind, de propósito:**

- **Sessão de estudo** é um LOG de alta frequência (`study_sessions`), como
  `contributions` (ADR-0027) e `habit_ticks` — não um node: sem tela própria, sem
  busca. Liga-se a matéria/livro/competência por `ON DELETE SET NULL` (a hora
  estudada sobrevive ao apagamento do vínculo).
- **Cargo/promoção** continua sendo fato do ledger sem node (`career_milestone`,
  ADR-0032). O item 6 dá forma de TRAJETÓRIA ao que já existe — não duplica.
- **Subir de nível de competência** é um evento de ledger (`skill_level_up`),
  agregado como XP; o nível atual é estado em `skill_details.level`, gravado na mesma
  transação (ADR-0037 — a exceção documentada: um fato do usuário, não derivação).

3. **A recriação e as três tabelas-satélite entram todas na `0013`, mesmo o Estudos
   só ganhando repo/comandos no sub-commit seguinte.** Criar `subject_details` e
   `study_sessions` agora (DDL barato, sem recriação) evita uma segunda migration; se
   o item 7 precisar de mais colunas, um `ALTER TABLE ADD COLUMN` as adiciona sem
   recriar nada.

4. **Revisão espaçada (SM-2) fica ADIADA** — só entra se couber sem inchar o item 7.
   Nada dela toca a `0013`; quando chegar, é tabela nova sem recriação. (Nota de
   escopo, formalizada por ADR próprio se e quando for construída.)

**Consequência.** Quatro recriações no total (0007, 0011, 0012, 0013), cada uma
paga por mais de um kind quando possível. O item 6 constrói sobre `skill` agora; o
item 7 constrói sobre `subject`/`study_sessions` sem tocar em migration de recriação.

## ADR-0046 — Metas de carreira linkáveis: um `link_type` direcional 'contributes_to'

**Data:** 2026-07-18 · **Status:** aceito · **M4.6** · §2.6 (item 6c) do redesign

**Contexto.** Uma meta de carreira precisa "contar para" uma Meta Anual (e, por
tabela, um item de Estudos): o arquiteto pediu o vínculo com backlink visível dos
DOIS lados ("na meta de carreira: conta para 2026: Y; na meta anual: ligada a meta
de carreira X"). A tabela `links` (§2 do DATA_MODEL) já é a relação N:N universal,
mas seu `link_type` era um CHECK fechado (`related/blocks/references/attached_to`).

**Decisão.**

1. **Um `link_type` novo: `contributes_to`** (`migration 0014`, recriando `links`).
   Direcional — `source` (a meta de carreira) contribui para `target` (a meta anual
   ou o item de Estudos). A recriação de `links` é barata: sem gatilhos de FTS, sem
   dependência de rowid, e nada a referencia (é a ponta filha das FKs para `nodes`),
   então não há as três armadilhas do 12-step de `nodes`.

2. **Um só tipo, não vários.** Escolha do arquiteto entre `contributes_to`,
   `contributes_to`+`studies_for`, ou reusar `related`. A DIREÇÃO (source/target) +
   os KINDS das duas pontas já geram os rótulos dos dois lados — não é preciso um
   tipo por relação. Um livro/matéria como alvo reusa o mesmo `contributes_to`.

3. **O linking é genérico** (`LinkRepository`/`LinkService`/`NodeLinkSection`),
   separado dos wiki-links das notas (que têm caminho próprio no `NoteService`). O
   comando de usuário só admite `related` e `contributes_to` (os outros são de
   nota/anexo). O alvo se acha pela busca FTS filtrada a `annual_goal`/`book`/
   `subject` — então quando o `subject` do item 7 ganhar UI, já é linkável de graça.

4. **O backlink aparece dos dois lados** lendo a MESMA linha: na meta de carreira,
   o `outgoing` ("conta para {X}"); na meta anual, o `incoming` ("meta de carreira:
   {Y}"). O lado da meta anual é leitura — o vínculo se cria e se desfaz do lado da
   meta de carreira.

**Consequência.** As esferas deixam de ser ilhas: uma meta de carreira agora se
amarra ao ano e aos estudos, com a relação visível e reversível dos dois lados. O
mecanismo é genérico — qualquer par de nodes é linkável no futuro sem schema novo.

## ADR-0047 — A sessão de estudo: um LOG que vale 10 XP, e as estatísticas que ela alimenta

**Data:** 2026-07-18 · **Status:** aceito · **M4.6** · §2.7 (item 7) · **aplica o ADR-0027/0045**

**Contexto.** O item 7 (Estudos) ativa a fundação que a `0013` deixou pronta
(`subject_details`, `study_sessions` — ADR-0045): matérias com progresso agregado,
o registro de sessões de estudo, e estatísticas de leitura e de estudo. Faltava
decidir **quanto vale uma sessão** em XP, **onde ela mora** no ledger, e **como as
estatísticas honram** a constituição (§2: determinístico, explicável, sem inventar).

**Decisão.**

1. **A sessão é um LOG, não um node** — como o aporte (ADR-0027) e o `habit_tick`.
   Vive em `study_sessions`; registrá-la grava estado **e** o evento
   `study_session_logged` (`entity_kind='study_session'`, o `entity_id` é o id da
   linha) na MESMA transação. Ganha uma variante `LedgerEntityKind::StudySession` —
   um fato sem node, exatamente o que o ADR-0027 previu ("um fato novo sem node
   ganha uma variante, não um `Kind` emprestado").

2. **Uma sessão vale `XP_STUDY_SESSION = 10`** — o tier do gesto diário (o mesmo do
   `habit_done`). A sessão é o gesto atômico da Esfera Estudos, como o tick é o do
   hábito: um ato de disciplina que soma pela repetição. O valor é **plano por
   sessão, não por minuto** — uma sessão de 3 h não rende mais XP que três de 1 h, e
   ninguém "sobe de nível" inflando os minutos. Como o XP é derivado e é a motivação
   do próprio usuário, jogar com a contagem de sessões só engana a si mesmo; o valor
   plano tira o incentivo de mentir na duração, que é o que envenenaria as médias.
   O XP atribui à Esfera da **matéria** (ou do livro/competência ligados, por
   `COALESCE`) — uma sessão de tópico livre sem vínculo conta só no XP geral.

3. **As estatísticas são determinísticas, com a fórmula à mostra e omitidas sem
   amostra** (o padrão dos insights, §2). Estudo: horas na semana (soma dos minutos
   dos últimos 7 dias ÷ 60) com tendência vs. a semana anterior, constância (dias
   distintos com sessão nos últimos 30) e melhores horários. Leitura: páginas/dia
   (páginas dos livros terminados no ano ÷ dias decorridos) e tempo médio para
   terminar (média de fim − início sobre os livros com as duas datas) — funções
   puras do estado dos livros, **computadas, nunca gravadas** (a filosofia da Saúde
   Financeira, ADR-0028). Sem dado → `None`, e a UI não desenha um zero inventado.

4. **A hora do dia sai do `ts` convertido para o fuso LOCAL** — a única exceção ao
   costume de nunca usar `strftime(..., 'localtime')`. As sessões guardam o `day`
   local (como os ticks), mas o "melhor horário" precisa do TURNO, e a sessão não
   grava o turno: o `ts` (epoch ms) é a única fonte da hora. `strftime('%H',
   ts/1000, 'unixepoch', 'localtime')` dá o "às 21h" que o usuário viveu. É um stat
   de leitura na máquina do usuário — o fuso é o dele, e a conversão é honesta.

5. **A matéria (`subject`) reusa o padrão node**: título/Esfera/status no node,
   satélite só com `category` e `target_minutes` (a meta em minutos). O progresso é
   **computado** das sessões (horas, contagem, último dia, livros tocados, itens
   vinculados por `links` — ADR-0046), nunca gravado. Trocar a meta é configuração
   e **não** vai ao ledger (ADR-0023); criar a matéria é um fato e vai.

6. **A revisão espaçada (SM-2) segue ADIADA** (ADR-0045). O item 7 entregou matérias,
   sessões e as duas famílias de estatística sem ela — cabê-la agora incharia o
   milestone. Quando (e se) for construída, é tabela nova sem recriação, com ADR
   próprio. A decisão do ADR-0045 fica de pé: nada de SM-2 no M4.6.

**Consequência.** A Esfera Estudos deixa de ser só a Biblioteca: as horas viram um
número que se acumula, com ritmo, constância e horários — "um mini-jogo da minha
vida" também no estudo, sem uma linha de estado derivado gravada. O XP tem uma
fonte nova, coerente com a escala (tick=10 … livro=60), documentada em
`domain::xp` e no DATA_MODEL. O `xp_by_area` ganhou um ramo; nada mais mudou na
arquitetura de gamificação.

## ADR-0048 — Dirigir a UI NUNCA toca o banco real: `NEXUS_DATA_DIR` isola o dev

**Data:** 2026-07-18 · **Status:** aceito · **M4.6** · **regra do arquiteto** · **complementa o ADR-0012**

**Contexto.** A verificação do item 7 dirigiu o app de verdade (ADR-0012, o método
que acha bugs que a suíte não vê) — e o app dev abre o MESMO diretório de dados que
o app instalado (`%APPDATA%/Nexus`, `Paths::resolve`). Resultado: a dirigida criou
uma matéria de teste ("Cálculo I2") e uma sessão de 245 min **dentro da vida real
do usuário**. A migração automática `11 → 14` do banco dele foi aceitável
(idempotente e testada); dado SINTÉTICO entrando na vida real, não.

**Decisão (do arquiteto, regra permanente).**

1. **Dirigidas de UI rodam num diretório de dados ISOLADO, nunca no
   `%APPDATA%/Nexus` real.** `Paths::resolve` passa a honrar a variável de ambiente
   **`NEXUS_DATA_DIR`**: se setada, o app (e o `seed_demo`, que também usa
   `resolve`) ancora ali. O `Paths::at` já aceitava uma raiz arbitrária desde o M0 —
   o `--data-dir` que o comentário dele previa chegou como env var, mais simples de
   passar para o `tauri dev` e o `cargo run --example`.

2. **O fluxo do dev:** `NEXUS_DATA_DIR=<pasta de teste>` → `seed_demo` popula essa
   pasta com dados sintéticos → `tauri dev` abre nela. O `.devdata/` do repositório
   é o padrão (gitignorado). O `%APPDATA%/Nexus` real só é tocado quando o próprio
   usuário abre o app — nunca por automação.

3. **A tela "Seus dados" (item 8) mostra o `data_root` ativo.** Além de informar,
   isso deixa VISÍVEL quando o app está rodando em modo dev com dados de teste (o
   caminho aponta para `.devdata`, não para `%APPDATA%`) — uma salvaguarda a mais
   contra confundir os dois mundos.

4. **Corrigir estado é direito do usuário; a história é imutável.** O mesmo episódio
   pediu uma forma de REMOVER uma sessão lançada por engano. `delete_study_session`
   apaga a linha de `study_sessions` (estado — recomputa progresso, XP e
   estatísticas), mas **não toca o ledger**: o evento `study_session_logged`
   permanece (append-only, ADR-0047). É o mesmo princípio de desmarcar um hábito —
   some do estado, fica na história. Vale para o usuário legítimo (todo mundo
   registra errado um dia), não só para a limpeza do artefato de teste.

**Consequência.** O banco real do usuário fica intocado por qualquer verificação
futura. A limpeza do artefato desta vez foi feita pelos MESMOS caminhos de código
(`archive` da matéria + `delete` da sessão), com o ledger preservado — um registro
honesto de que o teste aconteceu e foi corrigido. A regra é permanente: nenhuma
sessão futura repete o erro.

## ADR-0049 — Grão e vinheta emolduram a viewport, não a página; e são estáticos

**Contexto.** O item 9 do M4.6 pediu profundidade no fundo além do gradiente + dot
grid + aurora que o Midnight já tinha: um grão de filme quase imperceptível e uma
vinheta leve. Duas dúvidas de arquitetura: (a) ONDE essas camadas moram e (b) como
não violar o orçamento de movimento (§6) nem a regra de zero animação em idle.

**Decisão.**

1. **Aurora e dot grid seguem no `.nx-page` e ROLAM com o conteúdo** — eles são a
   identidade da TELA (tingidos por `--sphere`), e sempre foram
   `background-attachment: local`. Grão e vinheta, ao contrário, emolduram os
   OLHOS: uma vinheta que rola deixa de ser vinheta (o escurecimento sairia do
   canto da janela e viajaria pelo meio do texto). Então elas moram numa camada
   NOVA, `.nx-viewport-fx`, montada sobre o `<main>` do `Shell` — que é
   `overflow-hidden` e do tamanho da janela. A página rola POR DENTRO dele; a
   moldura fica parada. É o mesmo motivo pelo qual o `<main>` já era
   `overflow-hidden` em vez de rolante (cada tela é dona da própria rolagem).

2. **Zero elementos de conteúdo, zero JS.** A camada é um único `<div aria-hidden>`
   `pointer-events: none`. A vinheta é um `radial-gradient` elíptico; o grão é um
   `feTurbulence` embarcado como **data-URI** (nada de rede, ADR-0001) em `overlay`
   sobre um tile de 140 px, num pseudo-elemento. No tema claro o `overlay` clareia
   demais — vira `multiply` com alfa menor.

3. **Estáticas por construção — nada a desligar em `prefers-reduced-motion`.** O
   plano falava em "respeitar reduced-motion", mas a forma certa de respeitá-lo é
   não introduzir movimento nenhum: não há partícula, não há `@keyframes`, não há
   `backdrop-filter` (o efeito caro que a §6 raciona). O fundo continua custando
   ~zero. Novos tokens `--grain-alpha` (dark/light) mantêm a intensidade fora do
   componente, como o resto das opacidades de fundo.

**Consequência.** O Hub e toda tela ganham casca de profundidade sem um único frame
de animação e sem um elemento a mais no fluxo de conteúdo. A moldura é imune à
rolagem porque o seu container, por definição, não rola.

## ADR-0050 — A senha do backup é opcional, mora em claro fora do backup, e o restauro é aplicado no boot

**Data:** 2026-07-18 · **Status:** aceito

**Contexto.** O auto-backup (M5) precisa cifrar o zip SEM o usuário presente (roda
sozinho na abertura do dia). Isso força a senha a estar guardada em algum lugar
legível pelo app. E o restauro precisa trocar o arquivo `nexus.db`, que está aberto
e travado enquanto o app roda.

**Decisão.**

1. **A senha é OPCIONAL.** Sem senha, o backup é um zip em claro — perfeitamente
   restaurável. A cifra AES-256 protege o backup em REPOUSO num lugar que não é
   totalmente confiável: a cópia na pasta de sync (OneDrive/Dropbox), que sai da
   máquina. O modelo de ameaça é "alguém pega o zip na nuvem", não "alguém tem
   acesso de administrador ao seu disco local" — contra este último, cifrar o
   backup com uma senha guardada ao lado não protege coisa alguma, e o app inteiro
   é local-first sem essa pretensão.

2. **A senha é guardada em `backup-config.json`, em claro, na raiz de dados — NUNCA
   dentro do banco.** Se ela vivesse no `nexus.db`, estaria dentro do próprio
   backup que ela cifra (e um atacante com o zip decifraria com a senha que o
   próprio zip carrega — absurdo). Fora do banco, a cópia remota do backup não traz
   a senha junto. Consequência que a UI declara COM TODAS AS LETRAS (regra explícita
   do arquiteto): **perder a senha é perder o backup.** Não há recuperação — é o
   preço de não ter servidor que a guarde.

3. **O `BackupStatus` nunca devolve a senha** — só um `has_password: bool`. A senha
   entra (ao configurar) e não volta; trocar exige digitá-la de novo. A UI usa um
   tri-estado (`None` mantém, `Some("")` desliga, `Some(x)` troca) para editar a
   config sem nunca precisar reexibir o segredo.

4. **O restauro é aplicado no BOOT, não na hora.** `restore_backup` só MARCA
   (`.pending-restore.json`); o `lib::run` chama `apply_pending_restore` antes do
   `Db::open`, quando nenhuma conexão segura o `nexus.db` (o Windows tranca arquivos
   abertos). O marcador é sempre removido após a tentativa — um restauro que falha
   não entra em loop. E a troca só ocorre DEPOIS de o snapshot extraído passar no
   `quick_check`: um zip corrompido ou uma senha errada aborta com o banco vivo
   intacto. A UI, ao marcar, pede o reinício.

**Consequência.** O auto-backup roda cifrado e sem supervisão; a senha nunca entra
no artefato que protege; e o restauro é seguro por construção — ou devolve um banco
que passou no quick_check, ou não toca no que já existe. O `%APPDATA%/Nexus` real
segue intocado por qualquer verificação de dev (ADR-0048): tudo isto foi provado no
banco de teste isolado.

## ADR-0051 — Dois backups independentes: o CÓDIGO no GitHub, os DADOS no sistema do M5

**Data:** 2026-07-18 · **Status:** aceito · **M5**

**Contexto.** O usuário pediu o código protegido contra a perda da máquina, antes de
seguir o M5. O NEXUS já tinha um sistema de backup — mas o do M5 (ADR-0050) protege
os DADOS do usuário (o `nexus.db`), não o código-fonte. São dois artefatos com donos,
ameaças e destinos diferentes, e confundi-los seria um erro: um zip cifrado do banco
não recupera o repositório, e um clone do repositório não traz um único dia da vida
registrada.

**Decisão.**

1. **O backup do CÓDIGO é o GitHub.** O repositório **privado** `Allann-as/nexus`
   guarda toda a história e as tags de milestone. `git push --follow-tags` a cada fim
   de milestone/tag é a regra permanente — a máquina pode morrer que a história do
   projeto sobrevive na origem remota.

2. **O backup dos DADOS é o sistema do M5** (ADR-0050): o zip do `nexus.db`, opcional-
   mente cifrado, na pasta de sync. Ele protege a VIDA REGISTRADA, que nunca entra no
   git.

3. **Os dois são independentes por construção e nunca se cruzam.** O `.gitignore`
   barra `.devdata/`, `src-tauri/target`, `dist`, `node_modules` e qualquer `.db` — o
   repositório carrega SÓ código e docs (auditado: 301 arquivos rastreados, zero dado
   real, zero banco). Reciprocamente, o backup do M5 carrega SÓ o banco, nunca o
   código. Binários (instaladores) não vão para nenhum dos dois: moram em **GitHub
   Releases** (M6), nunca commitados no git.

**Consequência.** Perder a máquina é recuperável em duas etapas ortogonais: `git
clone` traz o código, restaurar o zip do M5 traz os dados. Nenhum artefato mistura os
dois domínios, e cada um tem a proteção certa para a sua ameaça — o código contra a
perda de hardware, os dados contra a perda de hardware E contra o vazamento da cópia
na nuvem (a cifra do ADR-0050).

## ADR-0052 — O Modo Foco: um LOG que só nasce do bloco CONCLUÍDO, no molde da sessão de estudo

**Data:** 2026-07-18 · **Status:** aceito · **M5** · **aplica o ADR-0027/0047**

**Contexto.** O M5 pede um Modo Foco: um timer pomodoro configurável, disparável a
partir de qualquer tarefa, que registra o foco, vale XP e alimenta o insight das
"melhores horas de foco". A pergunta de arquitetura não é COMO desenhar o timer
(isso é frontend), mas O QUE vira fato: quando um bloco de foco entra na história,
quanto vale, e onde mora.

**Decisão.**

1. **Um bloco de foco é um LOG, não um node** — vive em `focus_sessions` (0015, um
   `CREATE TABLE` simples, sem recriação de `nodes`), exatamente como a sessão de
   estudo (ADR-0047) e o aporte (ADR-0027). Registrá-lo grava estado E o evento
   `focus_session_logged` (`entity_kind='focus_session'`,
   `LedgerEntityKind::FocusSession`) na MESMA transação. A tarefa focada é uma
   ligação opcional `ON DELETE SET NULL`: os minutos focados sobrevivem ao
   apagamento da tarefa. Sem tarefa, o bloco guarda um `label` livre.

2. **Só o bloco CONCLUÍDO vira fato.** O timer do frontend só chama
   `log_focus_session` quando zera; abandonar no meio não grava nada, não rende XP,
   não polui as estatísticas. Este é o guard central: diferente da sessão de estudo
   (minutos auto-reportados), o foco é TEMPO-GATED — para logar, o tempo tem de
   passar de verdade. É a semântica do pomodoro (um bloco interrompido não conta) e
   a defesa contra o farm de XP.

3. **Um bloco vale `XP_FOCUS_SESSION = 10`** — o tier do gesto diário (hábito,
   sessão de estudo), **plano por bloco**, não por minuto: um bloco de 50 min não
   vale mais que um de 25, então ninguém "sobe de nível" esticando a duração. O XP
   atribui à Esfera da tarefa focada (`xp_by_area`, um JOIN a `nodes` pela tarefa);
   foco livre sem tarefa cai em `area_id` NULL e conta só no XP geral. Documentado
   em `domain::xp` e no DATA_MODEL §5.9/5.13, a fonte única de sempre.

4. **Foco e estudo não se fundem, de propósito.** São dois LOGs distintos porque
   são dois gestos distintos: estudar uma matéria (minutos de aprendizado) e focar
   numa tarefa (atenção sustentada num entregável) medem coisas diferentes. Somá-los
   num só contador esconderia a informação de cada um. Que o mesmo intervalo de tempo
   possa render os dois é aceitável — o usuário só engana a si mesmo, e cada série
   conta sua própria história (ADR-0047 §2).

5. **As estatísticas são o padrão dos insights** (constituição §2): minutos na
   semana com tendência, constância dos últimos 30 dias, e as melhores horas de foco
   (a hora local de `ts`, como o estudo — o bloco guarda o `day`, não o turno).
   Determinísticas, com a fórmula à mostra, **omitidas sem amostra** — nunca um zero
   inventado. Apagar um bloco é correção de ESTADO (`delete_focus_session` recomputa
   XP e stats); o evento no ledger permanece, como desmarcar um hábito (ADR-0048 §4).

**Consequência.** O foco entra na constituição do NEXUS sem uma exceção: mesmo molde
de LOG, mesma disciplina de XP derivado, mesma honestidade de estatística. O timer é
livre para evoluir no frontend (durações, pausas, som) sem tocar na arquitetura — o
backend só sabe de um fato, "focou N minutos, concluído", e o resto é derivação.
