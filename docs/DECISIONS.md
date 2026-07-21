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

## ADR-0053 — Os orçamentos de performance, provados a 5 anos: `seed_scale` + `bench_scale`

**Data:** 2026-07-18 · **Status:** aceito · **M5**

**Contexto.** A constituição fixa orçamentos de performance (cold start < 1,5s, busca
< 50ms, um mês da Timeline < 100ms, scroll 60fps, RAM < 300MB). Até o M5 eles eram
uma promessa arquitetural (CQRS, índices certos, `WITHOUT ROWID`, rollups) sem uma
medição contra o volume de uma vida inteira. "Orçamento estourado = corrigir AGORA"
exige um número, não uma intenção.

**Decisão.**

1. **Duas ferramentas de dev permanentes**, não um teste que se joga fora:
   `examples/seed_scale.rs` popula um banco de teste com **50.000 nodes e 400.000
   eventos de ledger** (5 anos a ~219 eventos/dia), e `examples/bench_scale.rs` abre
   esse banco **a frio** e cronometra os caminhos de leitura pelos MESMOS
   repositórios que a UI usa. Ficam no repositório para reprovar qualquer regressão
   futura de escala.

2. **O seed de escala insere em LOTE, ao contrário do `seed_demo`.** O `seed_demo`
   escreve pelos casos de uso, para provar as REGRAS; o `seed_scale` insere direto
   nas tabelas, porque o alvo é o VOLUME dos caminhos de LEITURA. As linhas seguem
   válidas — o gatilho de FTS indexa cada node no INSERT, o ledger é append-only por
   gatilho. Determinístico, sem RNG.

3. **Isolamento inegociável (ADR-0048):** ambos abortam se `NEXUS_DATA_DIR` não
   estiver definida — o banco de escala vive em `.devdata-scale/` (gitignorado), nunca
   no `%APPDATA%/Nexus` real.

**Resultado medido** (release, banco de 5 anos, a frio):

| Orçamento | Medido | Teto |
|---|---|---|
| Abertura do banco (parcela de cold start) | **318 ms** | 1500 ms |
| Busca FTS | **4,2 ms** | 50 ms |
| Um mês da Timeline (1ª página) | **1,2 ms** | 100 ms |

Todos passam com folga de uma ordem de grandeza — o CQRS e os índices seguram a
escala como projetados. **Scroll 60fps e RAM < 300MB** dependem do app rodando e são
verificados na dirigida ao vivo do M6 (app instalado, não o dev).

**Consequência.** Os orçamentos deixam de ser fé e viram número reproduzível. Se um
dia uma query nova varrer o ledger inteiro (o erro clássico), o `bench_scale` a pega
antes do usuário — a rede de segurança de escala que faltava.

## ADR-0054 — A tela de bloqueio por PIN é privacidade de TELA, não cifra de disco

**Contexto.** O M5.5 §3.5 pede uma tela de bloqueio por PIN na abertura do app. A
tentação é vendê-la como "seus dados protegidos". Seria mentira: o NEXUS é um único
`nexus.db` em `%APPDATA%/Nexus`, em claro no disco. Cifrar o banco de verdade (SQLCipher
ou similar) mudaria a constituição — a chave teria que morar em algum lugar, o backup e a
exportação humana (ADR-0050) parariam de ser legíveis "daqui a 30 anos sem o app", e o
custo de abertura cresceria. Não é o que este PIN é.

**Decisão.** O PIN é **privacidade de tela**: impede que alguém que pega o computador
desbloqueado abra o NEXUS e leia a sua vida. Ele NÃO cifra o banco — quem tem acesso ao
arquivo continua conseguindo lê-lo. A UI diz isso com todas as letras nas Configurações; o
produto não finge uma proteção que não tem.

1. **O PIN nunca vive em claro.** Guardamos `hash = SHA-256^120000(salt ‖ pin)` com um
   **salt aleatório por instalação** (UUID v4). Não é Argon2 — e não precisa ser: o espaço
   é de 10^6 PINs e o adversário que tem o arquivo `security.json` tem o `nexus.db` em claro
   ao lado. O key-stretch existe para o hash não ser instantâneo, não para resistir a quem
   já venceu (tem o disco). Fingir Argon2 aqui seria teatro de segurança.

2. **A config mora FORA do banco** (`security.json` na raiz de dados), como a do backup
   (ADR-0050). Duas consequências desejadas: o PIN é lido no boot **sem depender do banco**,
   e **sobrevive a um restauro** — restaurar um snapshot antigo não reabre a sua tela, e o
   PIN não viaja dentro da exportação humana (ele não é "dado seu", é uma trava de sessão).

3. **Backup e restauração independem do PIN.** A trava é um overlay de UI acima do router;
   o boot (auto-backup, congelar Score, sync de conquistas) roda por baixo dela. Perder o
   PIN nunca é perder os dados — o banco e os backups seguem intactos e legíveis.

4. **PIN de fábrica `242807`, semeado no primeiro boot** (idempotente). Está no MANUAL: não
   é segredo, é o ponto de partida. O usuário troca ou desliga nas Configurações — e trocar
   ou desligar **exige o PIN atual** (a fechadura que qualquer um reconfigura não tranca
   nada). `Ctrl+L` bloqueia à mão. Seis dígitos, seis círculos; do 3º erro em diante, um
   atraso de 1s por tentativa esfria o brute force manual.

**Consequência.** O NEXUS ganha a trava de tela que faltava para um app que concentra a
vida inteira, sem mentir sobre o que ela protege nem quebrar a longevidade do dado. Cifra
de disco de verdade, se um dia for pedida, é outra decisão — e teria que resolver a chave,
o backup e a exportação de propósito, não de brinde.

## ADR-0055 — O accent é o índigo da marca, não o azul elétrico (REFINO PRIME+)

**Contexto.** Dirigindo o app ao vivo, o usuário achou o azul primário "neon/vibrante
estranho" — fora da identidade. O `--accent` vinha do M2.5 como `#4d8dff` (azul elétrico,
alta saturação, matiz ~217°), enquanto a marca — o astrolábio — é um **índigo** (`#7C8CF8`
e vizinhos, matiz ~231°). O primário e a marca não conversavam.

**Decisão.** O `--accent` passa a ser o índigo da marca, calibrado para cada tema com a
rampa indigo (bem afinada para escuro e claro):

| Token | Escuro | Claro |
|---|---|---|
| `--accent` | `#6366f1` | `#4f46e5` |
| `--accent-hover` | `#818cf8` | `#4338ca` |
| `--accent-bright` | `#818cf8` | `#4338ca` |
| `--accent-deep` | `#4338ca` | `#3730a3` |
| `--accent-muted` | `#6366f11f` | `#4f46e514` |

O `--glow-accent` segue o novo RGB. O botão **primário** troca o halo de cor estridente
(sombra a 35% da cor) por uma sombra de **profundidade** (`0 1px 2px` preto + `0 4px 14px`
da cor a 20%) e um brilho de hover contido (`1.06`, não `1.10`). Os quatro variantes ficam
com o mesmo raio e padding, hierarquia clara: primário (gradiente índigo cheio), secundário
(superfície + borda), ghost (texto), destrutivo (vermelho).

O que NÃO muda: a cor de cada **Esfera** (`--sphere-*`) — são identidades próprias do
usuário, semeadas no banco (migration 0005). Finanças continua no seu azul; o accent é o
chrome, não a Esfera. Nenhum componente carrega hex de accent cru — todos leem o token, e o
tema ECharts resolve o token em runtime, então gráficos seguem sozinhos.

**Consequência.** O primário deixa de brigar com a marca e o app inteiro assenta num índigo
sério nos dois temas. Como é um swap de token, a mudança é global e reversível numa linha.

## ADR-0056 — Excluir um aporte apaga o ESTADO e apenda uma correção; o ledger nunca reescreve

**Contexto.** Dinheiro errado tem que poder sair. Um aporte lançado por engano (valor, banco
ou classe trocados) estava preso — a lista de aportes não oferecia exclusão. Para dado
financeiro, isso é inaceitável: o saldo, a alocação e a Saúde Financeira ficam mentindo até o
usuário poder corrigir. Mas o ledger do NEXUS é **append-only por gatilho** (`RAISE(ABORT)`
em UPDATE/DELETE) — nem o próprio app reescreve a história.

**Decisão.** Excluir um aporte segue a regra da constituição — "correção apaga estado, nunca
ledger":

1. **Apaga só a LINHA de estado** (`DELETE FROM contributions`). Saldos, médias dos últimos
   meses, meses-seguidos e a Saúde Financeira **recalculam sozinhos** — são todos derivados
   dos aportes, nunca colunas gravadas (o mesmo princípio do ADR-0028). Não há o que
   "atualizar" além de remover a fonte.

2. **O evento original PERMANECE no ledger** e um evento de **correção** (`EventType::Deleted`,
   `entity_kind = Contribution`) é **apendado**, na mesma transação do DELETE. A história não é
   reescrita: ela registra que o aporte existiu e depois foi removido — dois fatos, ambos
   verdadeiros no seu instante. A Timeline mostra a remoção no dia em que ela aconteceu.

3. **A UI arma a exclusão** (um clique pergunta, o segundo confirma — o padrão do RestoreRow e
   das Metas Anuais), porque apagar dado financeiro não pode ser um toque acidental.

**Consequência.** O extrato ganha a correção que faltava sem furar a imutabilidade do ledger.
O padrão vale para qualquer LOG-fato futuro (a sessão de foco já apagava estado mantendo a
história; agora o aporte também apenda a correção, um degrau mais honesto para dado que a
Timeline desenha).

## ADR-0057 — "Objetivos" é uma superfície de agregação, não um novo node; constância = meta anual + ritmo

**Contexto.** Dirigindo o app, o usuário formulou o conceito: *"um objetivo pode ser uma
promoção, pode ser correr 250x no ano; os objetivos financeiros podem entrar na aba de
Finanças."* Na cabeça dele, a caixinha (dinheiro guardado), a meta de carreira e a meta de
constância ("correr 100 dias") são a MESMA coisa — algo que se persegue no tempo. Mas no
modelo eles são entidades diferentes: `fin_goal`, `annual_goal`, marcos de carreira. Unificá-los
num node novo exigiria migração destrutiva e reescreveria história — o oposto da constituição.

**Decisão.** "Objetivos" não é uma entidade nova: é uma **superfície de agregação** (read-only)
sobre os nodes que já existem.

1. **O hub `/objectives`** lê `list_fin_goals` (todas as caixinhas) + `annual_goal_year` (as
   metas do ano) e as apresenta num grid único, filtrável por **tipo** e por **Esfera**. Cada
   card leva à sua tela de ORIGEM (a caixinha à sua Esfera, a meta a Metas Anuais) — a
   superfície agrega, não possui. Nada é migrado; some o hub, os dados seguem intactos.

2. **Finanças ganha a aba "Objetivos"** (as caixinhas), porque dado financeiro mora junto do
   dinheiro. É a mesma `CaixinhasTab`, agora também acessível de dentro da Esfera de Finanças —
   uma segunda porta para os mesmos nodes, não uma cópia.

3. **Constância = meta anual quantitativa + INDICADOR DE RITMO.** "Correr 100 dias em 2026" é
   uma `annual_goal` quantitativa (alvo 100, unidade "dias"). O que faltava era a leitura viva:
   `annualPace` (puro, testado) projeta o fim de ano por extrapolação linear do quanto do ano já
   passou — `projeção = atual / fração_decorrida` — e diz quanto por mês falta para bater. A
   frase aparece no card da meta e no hub. Determinístico, exibível, sem IA — a régua de sempre.

**Consequência.** O usuário ganha o "lugar dos objetivos" que pediu, com a constância viva
(ritmo, não só placar), sem um node novo nem migração. O que fica para o ARSENAL adiante (v1.1,
honestamente): o tracker plugável de dias (heatmap anexável a qualquer contexto via `links`) e a
contagem AUTOMÁTICA a partir de um hábito ligado — hoje a meta quantitativa é incrementada à mão.
A superfície e o ritmo já estão de pé para recebê-los.

## ADR-0058 — ARSENAL (M5.6): a batelada de tipos que NÃO houve, e o tracker que reusa `contributes_to`

**Contexto — a regra de batch.** Um `kind` ou um `link_type` novo custa uma recriação de `nodes`
ou de `links` pelo 12-step (§5.6 do DATA_MODEL, ADR-0029/0036/0045/0046). A regra da constituição
é olhar o roadmap inteiro ANTES de recriar, para pagar uma recriação só. Abrindo o ARSENAL (as 8
features do M5.6) a pergunta obrigatória foi: **quais delas pedem tipo novo?**

**O levantamento, feature a feature:**

| Feature | Precisa de `kind`/`link_type` novo? | Como é servida |
|---|---|---|
| 1. Tracker plugável + contagem automática | **Não** | Reusa `contributes_to` (hábito → contexto) — já no CHECK de `links` desde a 0014. |
| 2. Semana perfeita | Não | `EventType`/`LedgerEntityKind` novos (enum Rust) + entradas no catálogo de conquistas. |
| 3. Recordes pessoais | Não | Idem — evento no ledger; o ledger não tem CHECK em `event_type`/`entity_kind`. |
| 4. Ano em pixels | Não | Leitura de `timeline_rollups` + eventos `nexus_score`. |
| 5. Comparativo de períodos | Não | Leitura de `timeline_rollups`. |
| 6. Horizonte | Não | Leitura de eventos/metas + `links` (`related`), já existentes. |
| 7. Retrospectiva anual | Não | Leitura + arquivos gerados (retenção, como backups). |
| 8. NEXUS na bandeja | Não | Integração de SO (tray, atalho global) + um flag de configuração. |

**Decisão.** O ARSENAL inteiro é entregue **sem nenhuma recriação de `nodes` nem de `links`**. O
que parecia pedir tipo novo (o vocabulário do ledger para semana perfeita e recordes) é enum de
domínio, não schema: `ledger.event_type` e `ledger.entity_kind` são `TEXT` sem CHECK **de
propósito** (§3 do DATA_MODEL) — o vocabulário fechado vive no Rust (`EventType`,
`LedgerEntityKind`), onde um valor novo é uma linha, não uma migração destrutiva. A promessa da
§2 ("um tipo novo é rotina") aqui se cumpre **sem cobrar o preço** — porque nenhuma feature do
ARSENAL introduz uma entidade nova; todas agregam, derivam ou integram sobre o que já existe.

**A feature 1 em detalhe — reusar `contributes_to`, derivar como o contador de sub-desafio:**

1. **O vínculo é `contributes_to`, hábito → contexto.** "Correr 100 dias" é uma `annual_goal`
   quantitativa (ADR-0057); ligar o hábito "Correr" a ela é dizer *o hábito contribui seus dias
   para a meta* — exatamente a semântica de `contributes_to` (ADR-0046), agora com um consumidor
   novo (antes só metas de carreira → metas anuais). Direcional: `source` = o hábito, `target` = o
   contexto (a meta, a matéria). Nenhum `link_type` novo; nenhuma recriação.

2. **A contagem é DERIVADA, no molde do contador de sub-desafio (§5.6).** Quando uma `annual_goal`
   tem um hábito ligado por `contributes_to`, o `current_value` efetivo é **computado na leitura** —
   `COUNT(DISTINCT dia)` dos ticks `done` dos hábitos ligados, na janela do ANO da meta
   (`{ano}-01-01`..`{ano}-12-31`) — nunca gravado. É a mesma filosofia do XP, da Saúde Financeira e
   do próprio contador de milestone (`milestone_details`): o número é dos ticks, não de um campo. A
   coluna `current_value` continua servindo às metas **sem** hábito ligado (o incremento à mão de
   sempre). `DISTINCT dia` cobre com honestidade o caso de mais de um hábito ligado ("dias em que
   cumpri algum dos hábitos"), sem regra especial na `LinkService` — que segue genérica.

3. **Rastreado NÃO auto-conclui.** Como o contador de sub-desafio (que `set_milestone_done`
   recusa: os ticks são donos do número, e a doneness é derivada da razão, não um status gravado),
   uma meta rastreada mostra o progresso vivo mas **não vira `done` sozinha** — concluir segue um
   ato do usuário ("Concluir"), preservando o significado do evento de conclusão (e da conquista de
   meta anual). O ritmo (ADR-0057) e a barra já leem o valor efetivo; a diferença é só de onde vem
   o número.

4. **O heatmap é o de sempre, agora por ANO.** O tracker mostra o heatmap SVG do hábito
   (`features/habits/Heatmap.tsx`, do M2) numa janela alinhada ao ano da meta — um comando novo
   `habit_year_heatmap(habit_id, year)`, irmão de `habit_heatmap`, sem tabela nova. O componente
   `HabitTracker` (anexar/desanexar hábito + heatmap) é **plugável em qualquer node**: entra na
   Meta (com a contagem automática) e na Matéria (só exibição — "os dias que alimentam esta
   matéria"). A **Esfera** é uma `area`, não um node, então `links` não a alcança; o tracker de uma
   Esfera seria a união dos dos seus membros — deixado para v1.1 (nota honesta, sem node novo).

**Consequência.** O ARSENAL abre pagando **zero** recriações — o levantamento de batch encontrou
que nenhuma feature pede tipo novo, e isso É o resultado, registrado para não se recriar tabela
por reflexo. A feature 1 fecha a metade profunda do REFINO (ADR-0057): a constância conta sozinha,
o heatmap pluga em qualquer contexto, e o mecanismo é o `contributes_to` que já existia — a régua
determinística de sempre, sem uma linha de migração.

## ADR-0059 — Semana perfeita: DERIVADA (não congelada), semana de segunda, sem abono

**Contexto (ARSENAL, feature 2).** "Semana perfeita" = a semana em que 100% do que estava agendado
foi cumprido. Ela precisa de um calendário anual, sequência atual e recorde, e três conquistas
(4/12/26). Duas perguntas de projeto não têm resposta óbvia: **onde mora o fato** (congelado no
ledger, como a Revisão Semanal e o Score, ou derivado dos ticks?) e **o que exatamente conta**.

**Decisão.**

1. **DERIVADA, nunca congelada.** Ao contrário da Revisão Semanal (um RITUAL que o usuário fecha) e
   do Nexus Score (comportamental, o que você viu na época), a semana perfeita é uma **propriedade
   dos ticks** — e ticks se corrigem (desmarcar um `done`). Um evento `perfect_week` congelado no
   ledger viraria mentira no instante em que o usuário desfizesse um tick daquela semana. Então ela
   é computada na leitura (`domain::perfect_week`, puro e testado), como o streak, o XP e a Saúde
   Financeira. O total alimenta as conquistas pelo mesmo caminho derivado de sempre
   (`AchievementStats`), e o desbloqueio — esse sim — é o evento idempotente no ledger (ADR-0038).

2. **A semana é de SEGUNDA a domingo** (`week_start`, a mesma da Revisão Semanal e do streak
   semanal), não de domingo como as colunas do heatmap. A pergunta "a semana foi perfeita?" é a
   mesma que a Revisão faz; usar a outra borda partiria o conceito em dois.

3. **Sem abono, e cada agenda no seu idioma.** Só `done` conta: `skipped` NÃO abona (pular é não
   cumprir), `failed` e um dia agendado sem tick quebram. Um hábito **por-dia** (Daily/Weekdays)
   exige todo dia agendado cumprido; um **por-semana** (`TimesPerWeek n`) exige `n` `done` na semana
   — a mesma unidade do streak semanal, não "todo dia" (senão um "3x/semana" nunca faria uma semana
   perfeita). Antes do primeiro tick o hábito **não existe** para a semana (como o dia não agendado
   do streak), e uma semana sem hábito aplicável é **neutra** (nem perfeita, nem quebrada) — não
   zera a sequência.

4. **Só semanas ENCERRADAS entram.** A semana corrente fica de fora até terminar (`complete_weeks`)
   — uma semana só pode ser julgada perfeita quando o domingo passa. Isso evita o "quebrou na
   terça" que o streak resolve com carência; aqui a carência é simplesmente não julgar a semana viva.

**Consequência.** O calendário anual, a sequência e o recorde saem de uma função pura (11 testes de
domínio), sem tabela nem migração — coerente com o ARSENAL pagar zero recriações (ADR-0058).
Arquivar um hábito recomputa o passado (as séries são só as ativas, como o streak): limite honesto,
o mesmo dos outros derivados, aceito para a v1.

## ADR-0060 — Recordes: VALOR derivado, MOMENTO congelado; e o primeiro é marco silencioso

**Contexto (ARSENAL, feature 3).** Recordes pessoais (maior sequência, melhor semana de estudo,
melhor mês de aportes, melhor score semanal, mais dias de foco num mês). O mandato pede: "quebrar
recorde = evento no ledger + Timeline + reconhecimento na UI mostrando o recorde anterior." Ao
contrário da semana perfeita (ADR-0059), aqui o mandato **exige** um fato no ledger. Duas questões:
o valor do recorde é derivado ou gravado? E como não poluir a Timeline no primeiro cálculo sobre um
histórico inteiro?

**Decisão.**

1. **VALOR derivado, MOMENTO congelado.** O valor do recorde é sempre o MÁXIMO histórico computado
   do estado (SQL de agregação + `domain::streak` + os scores do ledger) — nunca uma coluna. Mas o
   INSTANTE em que a régua sobe é um fato da vida, e esse é congelado: `record_broken`
   (`entity_kind='personal_record'`, `entity_id`=a chave do recorde), com o valor novo e o anterior
   no payload. A última linha de cada chave é o recorde vigente. Isso reconcilia as duas naturezas:
   o placar é sempre verdade viva (recomputa se um tick some), e a Timeline guarda a quebra no dia
   em que aconteceu. É o mesmo casamento do XP (derivado) com a conquista (evento) do ADR-0037/0038.

2. **`sync_and_list` é leitura-e-escrita, idempotente.** Como `sync_achievements` e o `freeze` do
   score: computa os máximos, compara com o último gravado por chave, apenda só o que superou.
   Rodar de novo sem novidade não grava nada — a comparação `atual > gravado` é a idempotência.

3. **O primeiro recorde de cada tipo é um MARCO SILENCIOSO.** Ao rodar pela primeira vez sobre um
   histórico já cheio, cada recorde "cai" hoje — mas ele não foi batido hoje, só reconhecido. Então
   o primeiro de cada chave é gravado (o baseline, para a comparação futura ter contra o que medir)
   **sem** `isNew` — a UI não comemora, e o evento leva o `day` do PERÍODO recordista (a semana/mês
   que o alcançou), não "hoje", para a Timeline o desenhar no tempo certo. Só uma superação de um
   recorde que JÁ existia comemora (`isNew=true`, com o valor anterior à mostra). Testado.

4. **A Timeline mostra o período, não o número cru.** O payload carrega valor e anterior, mas sem o
   FORMATO (dinheiro? horas?), que é da tela. Então a linha da Timeline diz o rótulo + o período
   ("Melhor semana de estudo — semana de 06/07"); o número formatado vive na tela de Recordes.

**Consequência.** Cinco recordes reais, auto-detectados, com o reconhecimento honesto do mandato,
sem tabela nova (o ledger já admite fatos sem node desde o ADR-0027; `event_type`/`entity_kind` são
`TEXT` sem CHECK, então as variantes novas são enum Rust — ADR-0058). O limite: recordes cujo valor
depende de hábitos ativos recomputam se um hábito é arquivado — o mesmo limite derivado de sempre.

## ADR-0061 — Ano em pixels: o congelado manda; onde falta, computa a mesma fórmula (não grava)

**Contexto (ARSENAL, feature 4).** 365 células coloridas pelo Nexus Score do dia. O score diário é
congelado no ledger (ADR-0039), mas o `freeze` só olha 60 dias para trás por passada
(`BACKFILL_DAYS`) — então um ano inteiro raramente está todo congelado, ainda mais num primeiro
boot ou num seed. Colorir só os dias congelados deixaria o "visual mais denso do app" cheio de
buracos.

**Decisão.** `year_pixels(year)` é uma **visão derivada, sem escrita**:

1. **O congelado manda.** Onde há um `nexus_score` gravado para o dia, a célula usa esse valor — é
   o que o usuário viu na época, canônico (ADR-0039). Marcado `frozen=true`.
2. **Onde falta, computa na hora.** Para os dias sem congelado, aplica a MESMA fórmula
   (`score::behavioural`) sobre os ticks e tarefas daquele dia — entradas imutáveis. É a aproximação
   "agenda atual no passado" que o próprio `freeze` já assume e documenta; aqui ela só não é gravada.
   Marcado `frozen=false`. Isso **não é recomputar o passado** no sentido proibido pelo ADR-0039 —
   aquele veto é sobre RE-congelar um dia já congelado com uma fórmula nova; um dia nunca congelado
   não tem "o que você viu" a preservar, e a célula é explícita sobre ser computada.
3. **Nada é gravado.** Ao contrário do `freeze` (que a abertura do app dispara), o ano em pixels só
   lê e computa — abrir a tela de um ano velho não enche o ledger de 365 linhas. `None` num dia sem
   nada agendado (célula sem cor).

**Alternativas recusadas.** (a) *Congelar o ano ao abrir a tela* — encheria o ledger e arriscaria
duplicatas quando o conjunto de congelados lido não cobrisse anos distantes. (b) *Só congelados* —
buracos demais, o visual perde a graça. A escolha preserva o congelado como fonte da verdade e usa
o cômputo apenas para PINTAR, com honestidade (`frozen` por célula).

**Consequência.** O ano em pixels abre denso e correto, em SVG puro (~365 rects, ADR-0018), sem
tabela, sem escrita, sem migração — coerente com o ARSENAL de zero recriações (ADR-0058).

## ADR-0062 — Comparativo: ATÉ-A-DATA, e por soma de intervalo direto (não rollup)

**Contexto (ARSENAL, feature 5).** Comparar este mês/ano com o anterior em cinco métricas (estudo,
foco, aportes, tarefas, score médio). O mandato sugere "ler rollups (anos fechados custam zero)".
Duas decisões: o RECORTE (mês cheio vs mês pela metade?) e a FONTE (rollups ou query direta?).

**Decisão.**

1. **Comparação ATÉ-A-DATA.** Este mês *até hoje* contra o MESMO trecho do mês passado (1º ao mesmo
   dia-do-mês, com clamp quando o mês anterior é mais curto — 31/03 vs 28/02); e ano-até-a-data
   contra o mesmo trecho do ano anterior (29/02 cai para 28/02). Um mês cheio contra um pela metade
   inflaria a seta e mentiria o ritmo. O recorte é puro e testado (5 testes de fronteira).

2. **Soma de intervalo DIRETA, não rollup.** O comparativo cruza sempre DOIS períodos ADJACENTES —
   no máximo dois anos de linhas, um universo LIMITADO, diferente do feed da Timeline (ilimitado, e
   por isso rollado, ADR-0034). As quatro somas (estudo, foco, aportes, tarefas) saem de UMA query
   com quatro subselects, todos por intervalo de `day`/`happened_on` — colunas indexadas, custo
   proporcional ao período pedido, não à história. O score médio lê os `nexus_score` do intervalo e
   parseia o payload (o padrão do `ScoreHistoryService`/`RecordsService`). **Desvio consciente do
   "ler rollups":** estender `timeline_rollups` com métricas novas (via o `metric` de texto livre,
   sem migração) foi considerado, mas o ganho num recorte de dois períodos é marginal e o `freeze`
   ganharia responsabilidade e risco; a query direta indexada já é barata e obviamente correta. O
   caminho de rollup fica disponível (o `metric` é texto livre) se algum dia o perfil pedir.

**Consequência.** Cinco métricas lado a lado com a variação vs. o mesmo ponto do período anterior,
por queries indexadas simples, sem tocar o schema — dentro do orçamento de "zero recriações" do
ARSENAL (ADR-0058) e da honestidade de performance da constituição (§5): a query é barata *de fato*,
não por reflexo de rollup.

## ADR-0063 — Horizonte: uma agregação de marcos DATADOS, com as pendências vindas dos `links`

**Contexto (ARSENAL, feature 6).** Uma faixa no Hub com os "próximos marcos — D-dias + pendências
ligadas via `links`" ("Viagem · 12 dias · 2 tarefas abertas"). O que É um marco, e de onde vêm as
pendências?

**Decisão.** O Horizonte é uma **superfície de agregação read-only** (o espírito do ADR-0057), não
uma entidade nova:

1. **Marco = coisa DATADA que já existe.** Dois tipos entram na janela (90 dias): a ocorrência mais
   próxima de cada EVENTO do calendário (uma linha por evento, não por ocorrência — um recorrente
   não vira dez marcos) e as TEMPORADAS ainda ativas que TERMINAM na janela. Ambos são nodes com
   data; nenhum tipo novo, nenhuma tabela. Caberia estender a fontes futuras (caixinha com prazo,
   meta com data) sem mudar o formato.

2. **As pendências vêm dos `links`, dos dois lados.** "2 tarefas abertas" = `COUNT` de nodes
   `kind='task' AND status='active'` ligados ao marco por `links` (origem OU destino) — uma query
   só (`HorizonRepository::open_linked_task_count`). É o consumidor de `links` que faltava para o
   Hub: o marco não "possui" as tarefas, elas só apontam para ele (`related`), e a faixa conta o que
   ainda falta fechar antes da data.

3. **D-dias no espaço de DIA local**, não de milissegundo: `(dia_do_marco − hoje)` em dias, com o
   `dia` já local ('YYYY-MM-DD') tanto da ocorrência quanto do `ends_on` da temporada — sem
   `localtime`, coerente com o resto do app.

4. **Só aparece quando há horizonte.** A faixa some do Hub quando não há marco à frente — como o
   "Neste dia" some sem passado. O Hub não mostra uma seção vazia.

**Consequência.** O Hub ganha o "o que vem" entre o "hoje" e o "neste dia", com as pendências reais
puxadas dos `links` — tudo agregando o que já existe, dentro do ARSENAL de zero recriações
(ADR-0058).

## ADR-0064 — Retrospectiva: um quadro DERIVADO + um arquivo regenerável podado a 2 anos

**Contexto (ARSENAL, feature 7).** Uma retrospectiva anual: "página visual séria + export. Arquivos
gerados: retenção de 2 anos, podados como backups; o dado-fonte é eterno." Duas partes — a TELA e o
ARQUIVO — e a pergunta de retenção.

**Decisão.**

1. **A tela é 100% DERIVADA.** Nada de retrospectiva é gravado: os totais do ano vêm da mesma soma
   de intervalo do comparativo (`PeriodStatsRepository`, ADR-0062, aplicada a Jan1..Dez31 ou até
   hoje no ano corrente), o score do ledger `nexus_score`, as semanas perfeitas do
   `domain::perfect_week`, e as contagens/destaques (conquistas, recordes, livros, temporadas, metas)
   de um punhado de `COUNT`s sobre o ledger por `day` (indexado). Um ano fechado é um retrato
   imutável do que já aconteceu; recomputá-lo dá sempre a mesma coisa.

2. **O arquivo é uma CONVENIÊNCIA regenerável, não a fonte.** `export` gera um Markdown legível
   (`retrospectiva-YYYY.md`) num diretório novo `retrospectives/` — para guardar, imprimir, mandar a
   si mesmo. Ele NÃO é o dado: some amanhã e `export` o regenera idêntico do estado. Por isso pode
   ser podado sem dó, como um backup.

3. **Retenção de 2 anos, o dado-fonte eterno.** `prune` mantém o ano corrente e os dois anteriores
   (`year >= hoje.ano − 2`) e apaga os mais velhos — a mesma filosofia dos backups (ADR-0051): o
   arquivo derivado tem prazo, o ledger não. Markdown (e não JSON) porque a retrospectiva é para o
   HUMANO ler daqui a 20 anos, não para uma máquina reimportar — o formato eterno da constituição.

**Consequência.** Um "ano em review" sério na tela e um arquivo para a estante, sem tabela nova, sem
migração — dentro do ARSENAL de zero recriações (ADR-0058). O único artefato de disco novo é o
diretório `retrospectives/`, irmão de `backups/` e `exports/`, com a mesma promessa: regenerável,
podável, e nunca a fonte da verdade.

## ADR-0065 — A bandeja: o mini-painel É o Hub (uma webview só), e o atalho global mora no Rust

**Contexto (ARSENAL, feature 8).** NEXUS na bandeja: tray do Windows, `Ctrl+Shift+N` global (Captura
Rápida com o app em segundo plano), clique no ícone abrindo um "mini-painel com hábitos de hoje +
score", e fechar-a-janela minimizando para a bandeja (desativável). Três decisões de peso.

**Decisão.**

1. **O mini-painel É o Hub — uma webview só.** A tentação era uma SEGUNDA janela flutuante pequena.
   Recusada: uma segunda `WebviewWindow` sobe um SEGUNDO WebView2, e a constituição orça RSS < 300 MB
   (§5) — dobrar o runtime web por um painel de dois dados é caro. E o Hub JÁ é esse painel: a faixa
   "Hoje" tem os hábitos marcáveis, o topo tem o gauge do score. Então o clique-esquerdo na bandeja
   **traz o Hub à frente** (mostra + desminimiza + foca + navega para `/`), e o menu do botão direito
   dá "Abrir", "Captura rápida" e "Sair". Fiel ao pedido, sem um segundo processo web. Um painel
   flutuante dedicado fica para a v1.1 se o custo de RAM deixar de importar.

2. **O atalho global mora no RUST, não na webview.** `Ctrl+Shift+N` (o M0 já tinha o mesmo atalho,
   mas SÓ com o app focado, via `useKeyboard`) agora é GLOBAL: o `tauri-plugin-global-shortcut` é
   registrado e tratado no `setup`/handler do Rust. A webview **não** ganha permissão do plugin — a
   `capability` segue `core:default` e nada mais (ADR mantém a allowlist mínima). O Rust, ao disparar,
   `emit`e um evento (`nexus://quick-capture`) que o `Shell` escuta e abre a Captura. O mesmo canal
   leva o clique da bandeja ao Hub (`nexus://go-hub`). A regra da constituição ("zero rede, allowlist
   mínima") não é ferida: o plugin fala com o SO, não com a internet, e a webview não o alcança.

3. **Fechar-para-a-bandeja é uma preferência FORA do banco.** O handler `CloseRequested` roda no loop
   de eventos do Tauri e precisa da preferência sem tocar o banco — então ela vive num `settings.json`
   na raiz de dados (`SettingsStore`, o molde do `security.json`/config de backup, ADR-0050/0054),
   com um cache em memória (`RwLock`) para o handler não ler disco a cada fechamento. Ligado de
   fábrica; um toggle em Configurações desliga. Quando ligado, fechar `hide()`a a janela e
   `prevent_close()`; a bandeja mantém o processo vivo, e "Sair" no menu é a saída real.

**Consequência.** A bandeja, o atalho global e o fechar-para-a-bandeja entram sem um segundo
WebView2, sem alargar a allowlist da webview, e sem tabela nova — só um `settings.json` fora do
banco. O `Ctrl+Shift+N` do M0 ganha alcance global reusando o mesmo gesto. Verificação: o binário
COMPILA e empacota; o comportamento de bandeja em si (clicar, minimizar) é validado na máquina do
usuário no M6, como toda a UI (a automação de SO do ADR-0012 não observa a bandeja).

---

## ADR-0066 — O quadrado preto atrás das modais era o `backdrop-filter` faminto de backdrop; a cura é um portal

**Data:** 2026-07-19 · **Status:** aceito · **v1.1 (JOGO DA VIDA)** · **causa-raiz, não spot-fix**

**Contexto.** Um QUADRADO PRETO aparecia atrás de "Nova meta", "Nova caixinha" e das telas de
Estudos, nos DOIS temas. O ADR-0055/R4 já tinha caçado um preto (o `color-scheme` do input de data),
mas esse era outro — e o usuário desconfiou, com razão, de que os consertos pontuais não alcançavam
a causa: "há um componente compartilhado quebrado".

**A causa-raiz.** Toda modal era, cada uma, um `fixed inset-0` embrulhando um `GlassPanel`, e
renderizava INLINE, dentro do `.nx-page` da tela. O `.nx-page` cria um contexto de empilhamento
ISOLADO (`isolation: isolate`, para prender a geometria do astrolábio em `z-index:-1`). O
`backdrop-filter: blur(16px)` do `.nx-glass`, preso a esse "backdrop root" isolado, não tinha o
conteúdo da página para amostrar — e o blur de um backdrop vazio, no WebView2, é PRETO. Era imune a
spot-fix porque a causa estava na ÁRVORE (onde a modal renderiza), não no CSS de cada modal. Prova
por contraste: as modais que NÃO usavam `GlassPanel` (bg chapado) nunca tiveram o quadrado.

**Decisão.** Um `<Modal>` compartilhado (`design-system/Modal.tsx`) que sai da árvore da página por
um `createPortal` para o `document.body`. Fora do `.nx-page`, o `backdrop-filter` volta a amostrar a
aplicação real e o blur volta a ser blur. Um componente, e o app inteiro para de ter o bug — a modal
que usa este overlay não pode reintroduzi-lo. As 15 modais de formulário migraram para ele; o Esc, o
clique-no-backdrop e o scroll-lock passam a morar no `Modal`, não em cada tela.

**Consequência.** Verificado ao vivo (dirigida ADR-0012), nos DOIS temas: painel limpo, sem quadrado
preto. `--sphere` não atravessa o portal (o body está fora do `.nx-page`), então a modal aberta de
dentro de uma Esfera recebe `sphereColor` para seguir tingida — sem ele, cai no índigo da marca.

---

## ADR-0067 — O passe de design system da v1.1: botão com profundidade, casca de diálogo, stat-card vivo e fundo com presença

**Data:** 2026-07-19 · **Status:** aceito · **v1.1 (JOGO DA VIDA)** · **supersede parte do ADR-0055**

**Contexto.** O veredito do usuário sobre a v1.0.0 instalada: "ótimas ideias e um péssimo design". As
peças compartilhadas eram a alavanca — "cada hora em componente compartilhado vale por dez em tela
isolada" —, então a elevação foi NELAS, não tela a tela.

**Decisão.**

1. **O botão primário (B1).** O pill chapado do ADR-0055 morreu. A profundidade de app maduro vem de
   quatro coisas ESTÁTICAS empilhadas: gradiente vertical de 3 paradas (o topo clareia com um toque
   de branco por `color-mix` — não `--accent-hover`, que no claro é mais ESCURO e inverteria a luz),
   um fio de luz no topo (`inset 0 1px` branco), uma sombra curta para baixo (preto + halo da cor), e
   os gestos: hover ELEVA 1px e adensa a sombra, active AFUNDA. Secundária/ghost/destrutiva na mesma
   família. A sombra entra na transição — é gesto, não loop (a §6 proíbe loop).

2. **A casca de diálogo (B2).** O `.nx-modal-panel` ganha um fio de luz no topo (`inset` branco), uma
   borda mais definida e a sombra flutuante do tema; raio `xl`. Um `<ModalHeader>` opt-in traz o chip
   do ícone da ação + hierarquia. Herdado por TODA modal do ADR-0066.

3. **O `StatTile` — o "stat-card vivo" (B3).** Número mono grande + rótulo + um elemento VIVO
   obrigatório (anel `ring`, senão sparkline `spark`), porque três caixas com um número cada numa
   página vazia foi o que o usuário chamou de esparso. O vivo some quando não há dado (o Sparkline já
   degrada para um traço tracejado).

4. **O fundo com presença (B4).** `--astro-alpha`/`--aurora-alpha` sobem um degrau, e o `.nx-page`
   ganha um SEGUNDO PLANO de profundidade: dois anéis GRANDES e desfocados (bandas soltas num radial),
   um subindo do canto inferior esquerdo, outro do topo. Continua estático, custo de um gradiente
   parado. O tema claro replica as 5 camadas para o `background-size` seguir alinhado.

5. **Higiene de segundo plano (A6).** Não há polls (React Query sem `refetchInterval`); o custo ocioso
   era animação em loop com a janela VISÍVEL e sem foco (o navegador só pausa com `document.hidden`).
   Um listener em `App` marca `data-window-idle`, e o CSS congela só as animações `.nx-loop` — nunca
   as transições de gesto nem as entradas one-shot.

**Consequência.** Botão, diálogo, stat-card, fundo e higiene mudam em UM lugar cada e propagam para o
app inteiro. Verificado ao vivo: botão com profundidade real, modais limpas nos dois temas, fundo com
os anéis de profundidade visíveis a 100%.

---

## ADR-0068 — "Começar do zero": o zeramento é STAGED-NO-BOOT, no molde do restauro, e só solta o marcador quando o banco de fato saiu

**Data:** 2026-07-19 · **Status:** aceito · **v1.1 (D1)** · **no molde do ADR-0050 (restauro)**

**Contexto.** O usuário quer começar a vida real do zero num app que já tem dados de teste. Precisa de
um "Começar do zero" que apague TUDO — mas sem risco: um backup completo antes, e o PIN e as
preferências preservados.

**Decisão.** Reusar o mecanismo do restauro (ADR-0050), não inventar outro. O `nexus.db` está ABERTO e
travado enquanto o app roda, então nada pode apagá-lo ao vivo — como no restauro, o trabalho é
STAGED e aplicado no BOOT, antes de o banco abrir:

1. `reset_to_zero` (comando): faz um backup COMPLETO agora (`create_configured`, na pasta `backups/`)
   e escreve o marcador `.pending-reset`. Devolve o backup criado — o seguro do arrependimento, com o
   nome mostrado na UI. Depois a UI chama `restart_app` (`AppHandle::restart`), que relança o processo.
2. No boot, `apply_pending_reset` (antes do `Db::open`, ao lado do `apply_pending_restore`) apaga o
   `nexus.db` e os sidecars do WAL; o `Db::open` seguinte recria VAZIO (migrations do zero, as 5
   Esferas semeadas). PIN (`security.json`) e preferências (`backup-config.json`) vivem FORA do banco
   e não são tocados — zerar os dados não é esquecer quem é o dono.

**A robustez que o teste ao vivo exigiu.** Numa corrida de reinicialização no Windows, o processo
anterior pode largar o handle do arquivo um instante DEPOIS de sair, e o `remove` do banco falha em
silêncio. Se o marcador fosse consumido ali, um zeramento seria "aplicado" sem ter apagado nada.
Então `apply_pending_reset` só solta o marcador quando o banco DE FATO saiu (`!paths.db.exists()`);
senão, mantém o marcador e o próximo boot — sem ninguém segurando o arquivo — refaz e conclui. O
backup já está feito desde que o marcador nasceu, então repetir é seguro. Coberto por teste
(`a_staged_reset_recreates_an_empty_db_on_the_next_boot`): stage → apply → banco vazio com as 5
Esferas do sistema, marcador consumido, segundo boot não repete.

**Consequência.** "Começar do zero" (Configurações → Backup & Dados) com confirmação forte (digitar
"ZERAR") faz o backup, reinicia e recria o app vazio, sem perder nada de verdade nem esquecer o PIN.
Verificado ao vivo o backup e a UI; o zeramento em si é provado pelo teste de boot.

## ADR-0069 — A promessa do backup pré-migration não era verdade; agora é código, e só dispara quando há o que perder

**Data:** 2026-07-20 · **Status:** aceito · **v1.2 (BÚSSOLA)** · **corrige a §6 do DATA_MODEL**

**Contexto.** A §6 do DATA_MODEL dizia, desde o M5: *"Toda migration roda em transação, precedida de
backup automático do arquivo (M5)."* Abrindo a v1.2 — a primeira versão a migrar um `%APPDATA%` com
dados REAIS do usuário, e uma versão que traz migration nova (a 0016) — a linha foi conferida antes
de escrever qualquer SQL. **Ela era falsa.** O `Db::open` fazia exatamente isto:

```rust
Self::quick_check(&writer)?;
migrations::run(&mut writer)?;   // <- nada entre os dois
```

Nenhum backup, em lugar nenhum do caminho de abertura. O `BackupEngine` existia e era bom (ADR-0050),
mas ninguém o chamava antes de migrar — e ele nem poderia ser chamado ali: ele precisa de um
`Arc<Db>` que, neste ponto do boot, ainda não existe. A promessa vivia só na documentação.

O risco não é teórico. A migration 0016 RECONSTRÓI `goal_details` (copiar, dropar, renomear), e as
migrations de `nodes` do histórico do projeto fazem o mesmo com a tabela mais referenciada do schema,
com as FKs desligadas. É precisamente o momento em que anos de história passam por SQL destrutivo.

**Decisão.** `snapshot_before_migrating`, chamada entre o `quick_check` e o `run`:

1. **Só dispara quando o banco vai de fato ser alterado** — `user_version` entre 1 e a versão
   corrente. Um banco novo em folha (versão 0) sobe do zero e não tem nada a perder; um banco em dia
   não vai ser tocado. Sem esse filtro, cada teste com `tempdir` e cada primeiro boot escreveriam um
   snapshot inútil. O gate É a decisão: o snapshot existe para o upgrade, não para a abertura.

2. **`VACUUM INTO`, não cópia de arquivo.** Sob WAL o `nexus.db` sozinho não é o banco — as escritas
   recentes moram no `-wal`. Copiar o arquivo copiaria um estado velho, que é a pior espécie de
   backup: o que parece existir e mente. É o mesmo motor do `BackupEngine::create`.

3. **`.db` cru em `backups/pre-migration-AAAAMMDD-HHMMSS.db`, fora do padrão `nexus-*.zip`.** Não é um
   backup do usuário: é uma apólice de suporte. Ficando fora do padrão de nome, a **retenção nunca o
   poda** (`parse_stamp` o ignora) e ele não polui a lista da UI. Migrations são raras — 16 na vida
   inteira do projeto —, então isso não acumula de forma relevante, e guardar um a mais custa muito
   menos que não ter.

4. **Falhar não impede o boot.** Pasta cheia ou somente-leitura vira um `warn` no log, e o app abre.
   O NEXUS não pode se recusar a iniciar por causa da própria apólice.

**Consequência.** Dois testes prendem o comportamento: `a_brand_new_database_is_not_snapshotted` (o
gate, nas duas direções — banco novo e banco em dia) e
`a_database_behind_the_schema_is_snapshotted_before_migrating`, que não se contenta em ver o arquivo
aparecer: ele abre o snapshot, roda `quick_check` e lê o dado de dentro. Um backup que não restaura é
teatro, e a regra de ouro do M5 vale aqui igual.

A lição que fica registrada: **uma linha de documentação não é uma garantia.** Esta promessa
sobreviveu do M5 até a v1.2 sem código por baixo, e só caiu porque a v1.2 foi obrigada a olhar para
ela. Toda afirmação de segurança na doc deveria ter um teste com o nome dela.

## ADR-0070 — A marca vira uma BÚSSOLA: a mesma metáfora, numa silhueta que se lê a 32px

**Data:** 2026-07-20 · **Status:** aceito · **v1.2 (BÚSSOLA), fase A** · **substitui o ADR-0043**

**Contexto.** O ADR-0043 escolheu o ASTROLÁBIO e defendeu bem: anéis concêntricos como as esferas da
vida, o limbo graduado como instrumento de medida, a alidade cruzando o centro, o núcleo como o nexo.
A metáfora estava certa — *o instrumento com que se navega a própria vida*.

O uso real reprovou a EXECUÇÃO, não a metáfora. Palavras do dono do app, depois de uma semana
olhando para ela todo dia: *"abstrata, não faz o menor sentido"*. E ele tem razão pela geometria:
quatro anéis, sessenta tiques de limbo e uma alidade a −34° são detalhe que **recompensa o zoom** —
e a marca não vive no zoom. Ela vive a 28px na rail, a 32px na bandeja, a 16px no favicon. Nesses
tamanhos o astrolábio é um borrão cinza redondo.

**Decisão.** A BÚSSOLA — uma rosa dos ventos de 4 pontas com a agulha do norte destacada.

1. **A metáfora é a MESMA, e fica até melhor.** Bússola é o instrumento que orienta; o NEXUS é o
   instrumento com que o dono orienta a vida. Não se perdeu conceito na troca — perdeu-se ruído.

2. **A silhueta é o ativo, não o detalhe.** Uma estrela de 4 pontas com um braço mais claro que os
   outros é reconhecível em qualquer tamanho, porque a informação está na FORMA e num único contraste,
   não em micro-traços. A graduação sobrou apenas como 8 marcas cardeais — ela existe para dizer
   "instrumento de medida" e para de existir antes de virar granulado.

3. **Inverte-se a relação com a cor da marca.** O astrolábio era desenhado NA rampa índigo. A bússola
   é branca sobre um squircle índigo. O índigo continua sendo a marca — ele virou o FUNDO. Branco
   contra índigo escuro é o contraste que sobrevive ao downscale; índigo-médio contra índigo-escuro
   não é. O ADR-0043 §3 segue valendo no que importa: um logo tem UMA identidade, não se tinge com o
   tema nem com a Esfera, e por isso é o único lugar do app onde hex cru não é bug.

4. **A grade continua sendo o desenho.** Centro 120 num quadro 240, anel em 96, pontas da rosa em 76,
   cintura em 26, pivô em 9. Os mesmos números em três lugares: `design-system/NexusMark.tsx` (a marca
   in-app), `docs/logo-concepts-v2/compass/appicon.svg` (a variante BOLD que alimenta o `tauri icon`)
   e o splash cru do `index.html`. Três desenhos, uma geometria.

5. **A variante do bundle é engrossada, não é a mesma arte.** Anel a 5, marcas cardeais a 7, pivô a
   11 — o nível "ícone simplificado" da receita do ADR-0043 §4, que aqui deixa de ser uma nota de
   rodapé e vira a arte que de fato vai para o `.ico`.

**Consequência.** A família geométrica dos fundos, o emblema dos empty states, o splash, a tela de
bloqueio e os ícones do bundle migram todos do astrolábio para a bússola. Os conceitos do ADR-0043
seguem arquivados em `docs/logo-concepts-v2/` — a marca foi revista a partir de um ponto de partida
rico, não de um recomeço.

## ADR-0071 — Metas ganham TIPO; os degraus são os `milestone` que já existiam

**Data:** 2026-07-20 · **Status:** aceito · **v1.2 (BÚSSOLA), fase C** · **migration 0016**

**Contexto.** O formulário "Nova meta" era um só para o app inteiro, e era quantitativo: métrica,
valor de hoje, alvo, unidade. Em uso real isso recusou a vida do dono. *"Conseguir um emprego"* não
tem métrica. *"Sair do básico ao avançado em inglês"* não é um número. E o placeholder "Perder 10 kg"
aparecia até dentro de Finanças.

A recusa não era da UI: era do BANCO. `goal_details` nasceu na 0001 com `metric_name`, `start_value`,
`target_value`, `unit` e `direction` **todos NOT NULL**. O formulário não podia sequer oferecer outro
tipo, porque a linha seria rejeitada. Vale notar que a 0012 já sabia disso: `annual_goal_details`
nasceu com `goal_kind` e com as colunas de métrica nullable, e o comentário dela diz explicitamente
que reusa *o padrão* de goal, não a tabela.

**Decisão.** Três tipos, e **nenhuma tabela nova para os degraus**.

1. **`goal_kind` em `goal_details`**: `'quantitative'` (o formato de sempre), `'binary'` (a conquista:
   só título e prazo) e `'staged'` (a escada de níveis nomeados: Básico → Fluente).

2. **As cinco colunas de métrica viram nullable, e o NOT NULL é substituído por um CHECK POR TIPO.**
   Nullable não pode virar opcional: uma quantitativa sem alvo é uma barra que ninguém alimenta, e uma
   conquista com `target_value` é uma meta que finge ter número. O CHECK de tabela exige os cinco
   campos quando o tipo é quantitativo e proíbe os cinco quando não é. Um segundo CHECK garante que
   uma meta sem métrica meça por degraus (`progress_source='milestones'`) — pedir uma divisão por um
   alvo inexistente seria o caminho silencioso para um NaN na tela.

3. **Os DEGRAUS são os `milestone` da 0007.** Um sub-desafio já é um node ordenado com `parent_id` = a
   meta e `nodes.status='done'` como o checkbox. Uma escada "Básico → Intermediário → Avançado →
   Fluente" é exatamente isso: quatro deles em ordem, e o degrau atual é a contagem dos concluídos.
   Nada de tabela de estágios, nada de kind novo. O que o C2 pede — degraus dentro de qualquer meta,
   uns simples e outros alimentados por um hábito — **já existia inteiro no schema desde o M3** e só
   nunca tinha sido exposto na UI: `milestone_details.kind='counter'` com `habit_id` e `counts_from`
   está implementado, testado e inalcançável pelo frontend, que só sabia criar `simple`.

4. **A reconstrução de `goal_details` é barata, e é por isso que ela pôde acontecer.** Recriar `nodes`
   custa as três armadilhas do 12-step (CASCADE, rowid do FTS, rename dos gatilhos). `goal_details` não
   tem nenhuma delas: nenhum gatilho de FTS a menciona, nada indexa o rowid dela, e quem a referencia
   (`goal_checkpoints`) aponta para a PK, que volta idêntica. Provado por teste, incluindo um
   `foreign_key_check` explícito depois da migração de um banco semeado na 0015.

**Consequência.** O formulário passa a perguntar o tipo primeiro, e cada Esfera pode sugerir o seu
(fase C3) sem uma linha de código por Esfera — é catálogo, não `if`. A individualidade que o dono
pediu sai de configuração; o schema só precisou parar de assumir que toda meta é um número.

## ADR-0072 — Idiomas/Faculdade/Cursos são MATÉRIAS numa trilha; o bug não era vazamento, era ausência

**Data:** 2026-07-20 · **Status:** aceito · **v1.2 (BÚSSOLA), fase D** · **migration 0016 §2**

**Contexto.** O relato foi: *"o Inglês criado em Idiomas aparece dentro de Faculdade"*, descrito como
vazamento de filtro entre seções. **Não era.** As três abas eram o MESMO componente
(`StudyProjectsTab`), com um `label` que o próprio código documentava como *"muda só a cópia"*,
rodando a MESMA query — `kind='project'` + `area_id` + `status='active'` — sob a MESMA chave de
React Query (`["nodes","project",areaId]`, idêntica nas três).

Não havia filtro a vazar: **não havia filtro**. E não havia onde guardar um: `nodes` não tem
subtipo, `project` não tem satélite, e `createNode(kind, title, areaId)` não recebe discriminante
nenhum. A informação "isto é um idioma" nunca foi escrita em lugar algum.

**Decisão.** As três seções deixam de ser `project` e passam a ser **`subject`** — o kind que a 0013
criou exatamente para *"algo que se estuda e cujo progresso se computa"*.

1. **Nenhum kind novo.** `subject` já traz de graça tudo o que o D1/D2/D3 pediria em matéria de
   tempo e constância: sessões de estudo ligadas (`study_sessions.subject_id`), progresso COMPUTADO
   (`subject_progress`), meta em minutos e o `HabitTracker` plugável (ADR-0058). Recriar `nodes` para
   inventar `language`/`course` teria sido pagar o 12-step por três sinônimos de matéria.

2. **`track` é coluna NOVA, e não o `category` que já existia.** A tentação era reusar `category` —
   o comentário da 0013 até cita "Faculdade" como exemplo de valor. Mas `category` é texto livre e é
   do **usuário** (ele agrupa como quiser: "Semestre 1", "Optativas"). Sobrecarregá-la como
   discriminante de seção faria a UI competir com o usuário pelo mesmo campo, e um renome inocente
   ("Faculdade" → "UFRJ") faria a matéria sumir da tela. `track` é fechado por CHECK, é do SISTEMA, e
   os dois convivem sem se pisar.

3. **`course_stage` não é `nodes.status`.** "Quero fazer / fazendo / concluído" não cabe em
   `active`/`done`: *"quero fazer"* é um curso **ativo que ainda não começou**. Forçá-lo em `status`
   colapsaria dois eixos diferentes num só.

4. **O nível de um idioma é a meta 'staged' do ADR-0071**, não uma coluna. `level_goal_id` guarda
   apenas QUAL é essa meta, para a tela do idioma achá-la sem varrer `links`. A escada "Básico →
   Fluente" é a mesma escada de qualquer meta por etapas — um mecanismo, dois lugares.

5. **O dado que já existe não pode sumir, e não pode ser adivinhado.** O dono já criou itens como
   `project` nessas abas. Migrar automaticamente é impossível *por definição*: a seção de origem
   nunca foi gravada — é esse o bug. Então a migração é do USUÁRIO: o Painel de Estudos lista os
   itens de antes da v1.2 e pede a trilha, item a item, dizendo com todas as letras por que o app não
   sabe responder sozinho. Escolher cria a matéria e **arquiva** o projeto (não apaga: ele pode
   carregar tarefas). Quando não sobra nenhum, a seção some sozinha.

**Consequência.** Cada seção filtra por `track` e tem chave de cache própria — a chave compartilhada
era metade do bug original. A aba "Matérias", que chama `list_subjects` sem trilha, continua vendo
tudo. **D2 (Faculdade) saiu reduzido de propósito**: provas, entregas e checklists por matéria ficam
para a v1.2.1, como o próprio dono definiu no corte.

## ADR-0073 — O nível de uma habilidade é CALCULADO a partir de check-ins mensais

**Data:** 2026-07-20 · **Status:** aceito · **v1.2 (BÚSSOLA), fase E** · **migration 0016 §3**

**Contexto.** A ideia era boa e a execução, rasa: uma competência tinha um `level` que subia +1 num
clique armado. O número não significava nada — era quantas vezes o usuário havia clicado. Não
respondia "estou melhorando?", que é a única pergunta que uma trilha de habilidade existe para
responder.

**Decisão.** O nível vai de **1 a 10 e é DERIVADO** de um histórico de check-ins mensais — a mesma
filosofia do XP, da Saúde Financeira e do contador de sub-desafio (ADR-0037/0028). O usuário informa
o FATO; o sistema calcula o número.

1. **O check-in é o fato, e mora numa tabela de log** (`skill_checkins`), como `contributions` e
   `study_sessions` — não é node. Três perguntas por mês: estudou (0/1), quantas vezes aplicou na
   prática (contagem), auto-avaliação da evolução (1–5). PK `(skill_id, month)` com `WITHOUT ROWID`:
   a leitura que a fórmula faz é "todos os check-ins desta competência em ordem", que assim é um
   range scan sequencial (a decisão de `habit_ticks`).

2. **Reinformar o mês CORRIGE, não empilha** (`INSERT OR REPLACE`), como `portfolio_snapshots`: um
   mês tem um retrato só. A HISTÓRIA de ter respondido vai para o ledger, que é append-only —
   corrigir o estado nunca reescreve o que aconteceu.

3. **A fórmula é pura, documentada e exibível** (`domain::skill_level`, 20 testes):

   ```
   s(mês) = 0,35·estudou + 0,35·min(aplicou/4, 1) + 0,30·(estrelas−1)/4
   peso(k meses atrás) = 0,85^k          janela = 12 meses
   nível = 1 + arredonda(9 · Σ(peso·s) / Σ(peso))        limitado a 1..10
   ```

   O teto em `aplicou/4` impede que um mês prolífico domine o ano. O decaimento é o ponto: meses SEM
   check-in, **depois do primeiro**, contam como `s = 0` — abandonar uma habilidade faz o nível cair
   sozinho, que é o comportamento honesto. Meses ANTERIORES ao primeiro check-in são excluídos: não
   se pune uma competência por não ter existido ainda.

4. **Sem check-in nenhum, o nível é `None` — não 1.** Inventar um número para quem nunca respondeu
   seria o app fabricando dado, o que a constituição proíbe. Um teste prende isso, e outro prende a
   consequência que só apareceu escrevendo os testes: uma habilidade com check-in **antigo** (fora da
   janela) dá nível **1**, não `None` — porque os 12 meses considerados existem e todos valem zero.
   `None` é reservado a "nunca houve check-in algum".

5. **A coluna `level` e o `level_up_skill` sobrevivem.** Competências criadas antes da v1.2 têm um
   nível construído clique a clique e ZERO check-ins; apagar a coluna zeraria esse número no
   upgrade. A regra da UI, documentada nos dois lados: **prefira `computed_level`; caia para `level`
   só quando ele for `null`.** Assim que a competência tem check-ins, o calculado é a verdade e o +1
   manual sai da tela — dois números discordando na mesma linha seria pior que qualquer um dos dois.

**Consequência.** O card mostra o nível 1–10, o "ⓘ como calculamos" com a fórmula e os números reais,
e a régua de evolução ao longo dos meses (SVG, ADR-0018 — nada de engine de gráfico para isso). O
convite ao check-in aparece no card quando o mês vira, sem modal bloqueante: o app pede, não cobra.

## ADR-0074 — COCKPIT: a linguagem visual troca de raiz (grafite + fósforo + mono), e a marca vira o SINAL-N

**Data:** 2026-07-20 · **Status:** aceito · **v1.3 (COCKPIT), fase 1**

**Contexto.** A primeira semana de uso real da v1.2 deu um veredito claro: as IDEIAS estão certas, a
EXECUÇÃO visual não. O navy + índigo do Midnight lia como "mais um dashboard"; faltava a densidade de
INSTRUMENTO que o app promete ser — um cockpit da própria vida. A v1.3 troca a linguagem inteira por
um sistema chamado COCKPIT, e a Fase 1 constrói a alavanca antes de tocar em qualquer tela: cada hora
no componente compartilhado vale por dez na tela isolada.

**Decisão.**

1. **Grafite, não navy.** O fundo é quase-preto (`#060809`), a superfície de um painel de
   instrumentos. A aurora navy do `.nx-page` saiu; entrou um DOT-GRID de fósforo a 1px e `--dot-alpha`
   0.05 — a textura de mostrador que a v1.2 removera, mas agora fósforo, esparsa e no limiar da
   percepção (não a grade navy-clara e densa de antes). Os aros fora de centro tingidos pela Esfera
   ficam. Uma camada, custo de pintar um gradiente parado.

2. **Fósforo é o accent.** `--accent` vira o verde-fósforo `#33E1A0`, a luz de um mostrador. Âmbar
   (`--amb`), vermelho (`--red`), ciano (`--cy`) e violeta (`--vi`) são os acentos de estado/Esfera —
   os dois últimos ganharam nome pela primeira vez (`--cyan`/`--violet`). O `--success` deliberadamente
   NÃO é o fósforo puro: se tudo verde fosse "ok", o accent perderia o significado de estado.

3. **O vocabulário do plano são ALIASES, não uma reescrita.** O app inteiro já fala
   `--bg-base`/`--accent`; os nomes do Cockpit (`--bg`, `--panel`, `--tx1`, `--phos`, …) são aliases
   canônicos — uma cor, uma verdade, dois nomes. Componentes novos escrevem na gramática do plano; os
   ~40 telas antigas herdam o novo look pela troca de VALOR do token, sem uma linha tocada. É a mesma
   economia do ADR-0067: um componente, o app inteiro muda junto.

4. **A marca vira o SINAL-N.** A bússola (ADR-0070) resolveu a legibilidade a 32px, mas era a marca do
   Midnight — a metáfora da navegação. O Cockpit pede um emblema de instrumento: o N desenhado como um
   TRAÇO DE SINAL/CIRCUITO em fósforo, com dois NÓS acesos na diagonal, sobre um squircle grafite.
   Inverte a bússola (traço branco sobre índigo → traço fósforo sobre grafite). Uma geometria só em
   três desenhos: `NexusMark.tsx`, o splash cru do `index.html` e `src-tauri/icons/icon.svg` (o
   vetor-fonte, de onde `tauri icon` regerou todo o bundle .ico/.png/.icns + Square*Logo).

5. **A biblioteca de instrumentos** (`design-system/instruments.tsx`): SegBar (o medidor segmentado
   que substitui TODO velocímetro de ponteiro — reprovado pelo dono), Ring, BarSpark, StatusList (LED
   por linha), Heatmap, Terminal (o painel de operação, base do aporte), Chip, SegToggle, BankTile
   (monograma na cor da marca até o dono colar as logos), SphereHeader, MonoLabel, Led. O `StatTile`
   ganhou a SegBar como vivo. Nenhum estilo solto por tela — a régua é uma só.

6. **Raio apertado.** `--radius-lg` desce de 16 para 12 (e as células/tags para 2–4px): o instrumento
   tem cantos curtos. Muda o app inteiro de uma vez, reforçando a leitura de mostrador.

**Consequência.** A Fase 1 entrega uma vitrine `/design-system` (`G+d`) que prova o sistema como um
todo antes de qualquer tela de produto. O gate segue verde: `tsc` limpo, 82 testes de frontend
passando (o guarda anti-emoji incluso). As Fases 2–7 (nav/home, motor de metas, esferas, telas de
sistema, tela de bloqueio, entrega) herdam esta fundação. O tema claro foi derivado, não abandonado —
o fósforo AFUNDA para `#0E9F6E` sobre branco, onde `#33E1A0` seria ilegível.

## ADR-0075 — O nome de exibição mora no `settings.json`, não no banco nem atrás do PIN

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 2**

**Contexto.** A saudação do Hub dizia `{greeting()}, Allan` com o nome CRAVADO no JSX. O app vai ser
compartilhado localmente com outras pessoas (namorada, pessoas próximas), e um nome em código
significa que a segunda pessoa a abrir o NEXUS é saudada pelo nome da primeira. Precisa ser
configurável — e a pergunta interessante é ONDE ele mora.

**Decisão.** No **`settings.json`** (`AppSettings.display_name`, `displayName` no JSON), ao lado do
`closeToTray`. Não no banco, não no ledger, não atrás do PIN. Quatro razões, e a terceira é a que
decide:

1. **É preferência de CHROME, não dado da vida.** Como o tema e a bandeja: não é um fato que
   aconteceu, é como o app se apresenta. O ledger guarda o que o usuário FEZ; trocar o próprio nome
   de exibição não é um acontecimento da vida dele.
2. **Não deve entrar no backup de dados nem no export.** O `settings.json` já está fora dos dois por
   construção (ver `backup.rs` §380) — o nome segue a mesma regra sem código novo.
3. **A tela de bloqueio precisa dele ANTES do PIN.** A fase 6 põe "Boa noite, {nome}" na tela de
   bloqueio, que roda antes de qualquer abertura de banco. Um nome no SQLite seria ilegível
   exatamente onde ele é mais necessário — e pôr o banco para abrir antes do PIN inverteria a ordem
   que o ADR-0054 fixou.
4. **Um lugar, duas telas.** `lib/greeting.ts` centraliza a faixa de hora (pura, testada, com a hora
   INJETADA) e o `useDisplayName()`, que compartilha a chave `["app-settings"]` com Configurações —
   salvar o nome lá reflete no Hub sem recarregar nada.

**A armadilha que quase passou.** `SettingsStore::load` faz
`serde_json::from_str::<AppSettings>(&s).ok().unwrap_or_default()`. Sem `#[serde(default)]` no campo
NOVO, todo `settings.json` gravado antes da v1.3 (que não tem `displayName`) falharia a
desserialização inteira, o `.ok()` engoliria o erro em silêncio e o usuário perderia o `closeToTray`
que havia escolhido. Os dois campos ganharam default por função, e um teste
(`a_pre_v13_settings_file_keeps_its_tray_choice`) prende a garantia com o nome dela — a lição do
ADR-0069: *uma linha de documentação não é uma garantia; toda afirmação de segurança deveria ter um
teste com o nome dela.*

**Detalhes de comportamento.** O nome é APARADO e limitado a 40 caracteres no BACKEND (não só na UI):
vazio volta ao padrão `"Allan"`, porque `"Boa noite, "` com o vazio pendurado é pior que qualquer
nome, e um nome de 200 caracteres quebraria o cabeçalho do Hub. O editor vive em **Configurações ›
Perfil** e salva sozinho 500 ms depois da última tecla — um botão "Salvar" para um campo só é
cerimônia, e gravar a cada tecla escreveria no disco uma dúzia de vezes para digitar um nome.

**Consequência.** A saudação do Hub consome o nome nesta fase; a da tela de bloqueio consome o MESMO
hook na fase 6. A quatro faixas do dia (madrugada/manhã/tarde/noite) que o Hub já tinha desde o M2.5
foi preservada na centralização — centralizar não podia ser a desculpa para a nuance se perder.

## ADR-0076 — A rail volta como TELEMETRIA, e o Hub vira Command Deck (o velocímetro morre)

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 2**

**Contexto.** O M4.6 matou a sidebar de 240px e mudou tudo para o NEXO (o overlay do hambúrguer). A
decisão estava certa para o MAPA global, e errada para o dia a dia: o NEXO é um gesto — ele some
quando você solta. Não havia superfície PARADA dizendo como cada Esfera está agora. Em paralelo, o
Hub foi reprovado em três pontos: o VELOCÍMETRO (ponteiro, leitura por estimativa de ângulo), os
ESPAÇOS VAZIOS (cards soltos numa página larga) e a LINHA DO DIA no rodapé.

**Decisão.**

1. **A rail volta, mas não como lista de links — como INSTRUMENTO.** Cada Esfera é um LED + nome +
   contagem de hoje + SegBar de progresso. Olhar a rail responde "o que está no vermelho?" antes de
   qualquer clique. O LED distingue os três estados que importam: cumprido (cor da Esfera), parcial
   (âmbar), nada feito HAVENDO o que fazer (vermelho) — e **apagado quando não havia nada agendado**,
   porque zero-de-zero não é falha (a regra do Score, ADR-0014). Recolhida, a coluna de LEDs
   sobrevive: a telemetria é o que menos pode sumir no colapso.
2. **O NEXO continua**, e agora com um papel limpo: mapa global + busca. A rail cobre o trajeto
   repetido; o NEXO cobre o salto. Os dois deixam de competir.
3. **O Score perde o ponteiro.** Número mono grande + SegBar de 40 segmentos + o delta contra ontem.
   Um medidor segmentado se lê com precisão; um ponteiro pede que você estime o ângulo. O delta só
   aparece com DOIS dias fechados — "▲0" no primeiro dia afirmaria uma estabilidade não medida.
4. **Duas colunas.** Centro: você (saudação + nível em SegBar), seu dia (Score), seus números (grade
   densa de StatTiles), suas Esferas. Direita: a agenda de hoje e os próximos marcos com D-dias.
5. **A faixa "Hoje" vira COLUNA (`DayAgenda`) e a régua do Horizonte vira LISTA (`NextMilestones`).**
   A régua horizontal foi reprovada com razão: dois eventos a 3 e 5 dias ficavam colados e ilegíveis,
   e o eixo ocupava mais pixel que os marcos. **O que NÃO mudou: marcar na agenda é o tick de sempre**
   — o Hub é a tela mais aberta, e obrigar um desvio para marcar um hábito o transformaria num
   pôster. E o item concluído continua FICANDO no lugar, riscado (some-ao-marcar faz a linha seguinte
   pular para debaixo do cursor, e o risco no texto É a recompensa).
6. **`useSphereColorResolver`** nasce ao lado de `useSphereColor`: um hook não pode ser chamado dentro
   de um `map`, e sem ele toda tela que lista itens de Esferas diferentes remontaria o próprio `find`
   — a divergência que aquele arquivo existe para impedir.

**Uma lição de método, registrada para não se repetir.** A coluna direita PARECIA cortada em todo
screenshot da dirigida, e três "correções" de layout foram feitas atrás disso. Não havia bug: o script
de captura media a janela em pixels ESCALADOS (Windows a 125%) e copiava a tela em pixels FÍSICOS, e a
imagem saía cortada à direita — o campo de busca da topbar aparecia cortado em todas elas, que era a
pista. `SetProcessDPIAware()` resolveu. **Uma ferramenta de observação com bug fabrica bugs no
observado**; antes de corrigir o que a imagem mostra, vale conferir se a imagem está inteira.

## ADR-0077 — O levantamento em BATCH das fases 3–6: nenhum `kind` novo, logo nenhuma recriação de `nodes`

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 3** · **migration 0017**

**Contexto.** A regra dos ADR-0029/0036/0045/0058/0074 diz que o roadmap inteiro se olha ANTES de
tocar no schema, porque adicionar um `kind` custa recriar `nodes` — a tabela mais referenciada do
banco — e a recriação tem três armadilhas que falham em silêncio (CASCADE, rowid do FTS, rename dos
gatilhos). Esta é a primeira migration da v1.3, e ela precisa cobrir o que as fases 3, 4, 5 e 6 vão
pedir. O levantamento foi feito contra o inventário do schema vigente (`user_version` = 16).

**O levantamento, item a item.**

| Fase | O que a tela pede | O que o schema já tem | Precisa de schema? |
|---|---|---|---|
| 3 | Meta **métrica / conquista / etapas** | `goal_details.goal_kind` (0016) | não |
| 3 | Meta de **CONSTÂNCIA (diária)** | — | **sim** (4º valor no CHECK) |
| 3 | Sub-desafio **degrau único** | `milestone_details.kind='simple'` (0007) | não |
| 3 | Sub-desafio **hábito diário ligado** | `kind='counter'` + `habit_id` + `counts_from` (0007/0009) | não |
| 3 | Templates por Esfera | `goalTemplates.ts` (código) | não |
| 3 | Delete universal | código + IPC | não |
| 4 | Saúde: exames | `event_details.category` | não |
| 4 | Finanças: BankTile na cor da marca | **`accounts.color`** (0005) | não |
| 4 | Carreira: habilidade 1–10 + check-in mensal | **`skill_checkins`** (0016) | não |
| 4 | Carreira: marcos com tipo | ledger-only, tipo no payload (ADR-0032) | não |
| 4 | Estudos: temas de matéria como subtarefas | `task` com `parent_id` = a matéria | não |
| 4 | Estudos: idioma por etapas | meta `staged` + `subject_details.level_goal_id` (0016) | não |
| 4 | Estudos: **faculdade — provas e entregas** | `event_details.category` é **TEXT LIVRE, sem CHECK** | não |
| 4 | Estudos: **observações por entrega** | — | sim (ADD COLUMN barato) |
| 4 | Estudos: curso — status quero/fazendo/concluído | `subject_details.course_stage` (0016) | não |
| 4 | Estudos: **curso — "o que ele ensina"** | — | sim (ADD COLUMN barato) |
| 4 | Estudos: checklist de conteúdos do curso | `task`/`milestone` sob a matéria | não |
| 5 | Todas as telas de sistema | apresentação | não |
| 6 | Tela de bloqueio + saudação | `settings.json` (ADR-0075) | não |

**O resultado, que É a decisão: NENHUM `kind` novo e NENHUM `link_type` novo.** Os 16 kinds e os 5
`link_type` cobrem tudo que as quatro fases pedem. **Logo `nodes` não é recriada, e as três armadilhas
do 12-step não se aplicam a nada aqui.** Isto está registrado para não se recriar `nodes` por reflexo
— foi exatamente o resultado (e a lição) do ADR-0058 e do 0074.

Dois achados que evitaram migration à toa, e que valem mais que a migration em si:

1. **`event_details.category` não tem CHECK** — é TEXT livre desde a 0007. As provas e entregas da
   Faculdade entram como categorias novas sem tocar no banco. Se ela fosse um CHECK fechado (como
   `contributions.asset_class`), a fase 4 teria custado uma reconstrução.
2. **`accounts.color` já existe** desde a 0005, semeada com as cores dos seis bancos. O BankTile do
   terminal de aporte lê a cor do BANCO, não de um mapa hardcoded no frontend — e o registro de
   marcas no `instruments.tsx` fica sendo só o fallback para conta que o usuário criar.

**O que a 0017 faz, então:**

1. **Reconstrói `goal_details`** para o CHECK de `goal_kind` admitir `'constancia'`, e ganha duas
   colunas: `habit_id` (o hábito que alimenta a constância) e `daily_target` (o alvo POR DIA — o
   "R$ 10" de "guardar R$ 10 por dia"). É a reconstrução BARATA, a mesma da 0016: `goal_details` não
   tem gatilho de FTS, nada indexa o rowid dela, e quem a referencia (`goal_checkpoints`) aponta para
   a PK, que volta idêntica.
2. **`subject_details.summary`** (TEXT) — o texto curto do que o curso ensina.
3. **`event_details.notes`** (TEXT) — as observações de uma entrega/prova.

Os dois ADD COLUMN são baratos por construção e **poderiam ter esperado**: `ALTER TABLE ADD COLUMN`
nunca recria tabela. Entram aqui porque já sabemos que serão necessários, e uma migration a menos é
uma migration a menos — mas registra-se a distinção: **a regra do batch existe para os CHECKs e os
`kind`s, que custam recriação; um ADD COLUMN pode chegar quando a tela chegar.**

**A meta de CONSTÂNCIA é um hábito por baixo, e isso é a decisão de desenho da fase.** "Guardar R$ 10
por dia" e "30 dias sem fritura" precisam de: uma marca por dia, um valor opcional no dia, sequência,
heatmap e presença nos Checkpoints de hoje da Esfera. `habit_ticks` já é exatamente isso — PK
`(habit_id, day)` `WITHOUT ROWID`, `status` e `value REAL` — e `domain::streak`, o heatmap anual e a
query `habits_today` já sabem lê-la. Criar uma tabela `goal_daily_marks` seria duplicar a série mais
consultada do BI e reimplementar streak, heatmap e XP por fora. Então a meta de constância **cria (ou
liga) um hábito real**, guarda o id em `goal_details.habit_id`, e o progresso é a soma dos
`habit_ticks.value` (ou a contagem de dias `done`) contra `target_value`. É a mesma filosofia do
contador de sub-desafio do ADR-0071: *o mecanismo já existia; faltava a UI alcançá-lo.*

**Considerado e RECUSADO nesta migration: unificar `annual_goal_details` ao motor de metas.** As Metas
Anuais têm `goal_kind` próprio (`binary`/`quantitative`, ADR-0036) e a fase 5 pede que a tela use "o
motor da fase 3" — que se lê como o motor de RENDERIZAÇÃO (o card, o detalhe, os degraus), não o
modelo de dados. Reunificar as duas tabelas é refatoração de domínio, não de tela, e não é o que a
fase pede. Fica registrado que, se um dia for preciso, `annual_goal_details` é uma reconstrução
BARATA (sem FTS, sem rowid, sem dependente de rowid) — adiar custa quase nada, e é por isso que adiar
aqui não viola a regra do batch.

---

## ADR-0078 — Um hábito ligado a QUALQUER coisa era indelével desde a 0007; `ON DELETE SET NULL` nas três

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 3b** · **migration 0018**

**Contexto.** Escrevendo o motor de metas da fase 3b, o teste que provava a promessa central do
ADR-0077 — *"apagar o hábito não pode apagar a META; a tela trata `habit_id` órfão como 'constância
sem hábito ligado' e oferece religar"* — falhou com:

```
Err(Storage("FOREIGN KEY constraint failed"))
```

O órfão que a 0017 desenhou **nunca podia acontecer**. `habit_id TEXT REFERENCES nodes(id)` sem
cláusula `ON DELETE` não é "sem CASCADE": é **NO ACTION**, que RECUSA o DELETE do pai. A 0017 quis
dizer *"não leve a meta junto"*; o que o schema diz é *"não deixe apagar o hábito"*.

Uma sonda (escrita, rodada e descartada — **verificado, não suposto**) mostrou o que importa: **isto
não nasceu na 0017**. A mesma forma de FK está em `milestone_details.habit_id` desde a **0007** e em
`challenge_details.habit_id` desde a **0012**. Ou seja: **desde a 0007, apagar o hábito "Academia"
com um sub-desafio "30 dias de academia" pendurado nele falhava** — e falhava exibindo
`FOREIGN KEY constraint failed`, uma mensagem de storage que não diz sequer QUAL item está segurando
o hábito.

Isso contradiz de frente a fase B da BÚSSOLA (ADR-0056): **excluir é um direito**. Um direito que a
tela oferece e o banco recusa é pior que um direito ausente — o botão existe, o usuário clica, e
recebe um erro de banco de dados na cara.

**Decisão.** `ON DELETE SET NULL` nas **três** colunas, na migration 0018. É a cláusula que diz
exatamente o que as três queriam dizer: *o filho sobrevive ao pai, com o vínculo desfeito*.

**Considerado e RECUSADO: limpar as referências no código antes de cada DELETE de hábito.** Isso
espalharia por `NodeService::delete` o conhecimento de três satélites, e a quarta tabela a ligar um
hábito (um dia haverá) esqueceria de se registrar — a erosão silenciosa de sempre. `ON DELETE SET
NULL` é declarativo: quem cria a coluna declara o destino dela, e o banco cobra.

**Considerado e RECUSADO: CASCADE.** Apagaria a meta, o sub-desafio e a temporada do usuário porque
ele apagou um hábito. É a leitura oposta da que o ADR-0077 quis, e o teste
`the_three_links_go_to_null_and_the_habit_finally_goes` prova as DUAS metades justamente para que um
CASCADE escrito por engano não passe: o pai SAI **e** os três filhos FICAM.

**Consequência — e uma simplificação que caiu de graça.** As três leituras já tratavam o NULL
(`SELECT_MILESTONE` tem `CASE WHEN m.habit_id IS NULL`, o placar de temporada conta zero, a
`constancia_view` cai no ramo "sem hábito"), então nenhuma delas mudou. E o campo `habit_missing`,
que a `ConstanciaView` tinha ganhado para distinguir "nunca ligou" de "o hábito foi excluído",
**deixou de existir**: com SET NULL os dois viram o MESMO estado, e a saída do usuário é a mesma nos
dois — ligar um hábito. Um campo sempre-falso na fronteira IPC é uma mentira esperando acontecer.

O que se PERDE, conscientemente: depois de apagado o hábito, o vínculo não volta sozinho — o
`habit_id` foi a NULL, não a um túmulo. Guardar o id de um node morto para poder dizer *"era o
Academia"* exigiria uma coluna de nome congelado; **o ledger já guarda essa história**, e é lá que
ela pertence.

**Sobre a regra do batch (ADR-0029/0077).** Esta migration chega uma fase depois da 0017 e não a
viola: ela não acrescenta `kind` nem vocabulário novo — **corrige** uma cláusula errada em colunas
que já existiam. As três reconstruções passam pelo mesmo teste do 12-step da 0016/0017 (sem gatilho
de FTS, sem dependente de rowid, quem referencia aponta para a PK `node_id`, `nodes` intocada). É a
terceira reconstrução de `goal_details` e a mais barata das três: nada muda além da cláusula
`ON DELETE`, e os três CHECKs voltam palavra por palavra — reescrevê-los "melhorados" aqui mudaria o
contrato sem ADR que o diga.

---

## ADR-0079 — A meta de CONSTÂNCIA na aplicação: o piso é `nodes.created_at`, e a régua é o acumulado

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 3b**

**Contexto.** A 0017 abriu o schema do quarto tipo de meta; a fase 3b tinha de fazê-lo funcionar. Três
perguntas não estavam respondidas pelo schema, e cada uma tinha uma resposta errada plausível.

**1. De QUANDO uma constância conta?** O hábito ligado pode ter meses de histórico. Sem piso, uma
constância "30 dias seguidos" criada hoje sobre um hábito com 120 dias nasceria **completa** — é
literalmente o bug que a 0009 consertou nos sub-desafios contados, exibindo *51/30* na tela.

**Decisão: o piso é `nodes.created_at` da própria meta.** Sem coluna nova: a 0009 precisou de
`counts_from` porque um contador podia legitimamente querer contar *desde o início do mês*; uma
constância, não — ela começa quando o usuário decide começar. `created_at` já é esse instante.

**2. Quanto vale um dia marcado?** Três casos, e a ordem importa: dia não feito vale **0** (só o
'done' acumula; pulado e falhado aparecem no heatmap porque são fatos, mas não são progresso); com
alvo diário vale **o valor digitado, ou o alvo diário quando o usuário só marcou** — marcar sem
digitar é o gesto de UM clique e ele tem que significar o combinado ("guardei os R$ 10 de sempre"),
não zero; sem alvo diário vale **1**, porque a unidade É o dia ("30 dias sem fritura").

**3. A direção é uma escolha?** Não. Uma constância **acumula**: 12 dias marcados nunca viram 11. A
`direction` é forçada a `increase`, do mesmo jeito que a quantitativa a deduz dos números — o campo é
derivado, não perguntado. Uma meta de *reduzir* algo até um número é uma quantitativa, não uma
constância.

**Consequências de desenho.** `GoalService` ganhou o port `HabitRepository`: a série de uma
constância É `habit_ticks`, e sem ele o motor de metas reimplementaria a tabela mais consultada do
BI. A projeção da constância é a reta sobre o **acumulado** (um ponto por dia FEITO), e mora em
`constancia.projection` — não no `projection` do topo, que segue sendo só da quantitativa: duas
séries diferentes no mesmo campo é a ambiguidade que a tela resolve errado em silêncio.

`add_checkpoint` **recusa** uma constância. Ela tem unidade e alvo, então passaria pela guarda antiga
e escreveria uma série paralela que barra nenhuma lê — dois números dizendo a mesma coisa, que é
exatamente o que o ADR-0077 evitou ao não criar `goal_daily_marks`. Ela se registra marcando o dia, e
só.

`GoalKind` ganhou `can_measure_by_metric()`, distinta de `is_quantitative()`: **quem tem ALVO** não é
o mesmo conjunto que **quem tem MÉTRICA**. É o segundo CHECK da 0017 (`goal_kind IN
('quantitative','constancia') OR progress_source = 'milestones'`) dito onde o erro sai em português.

---

## ADR-0080 — O INSTRUMENTO da dirigida estava quebrado, não o app; e a janela nascia mais alta que a tela

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 3b**

**Contexto.** A dirigida da fase 3b não conseguia abrir o formulário "Nova meta": **o botão não
existia na tela**. Toda tela aparecia cortada à direita, e redimensionar a janela não refluía nada.
Parecia violação direta da régua "container central, nada colando na borda".

**Não era.** O app estava certo o tempo todo. **A ferramenta de captura é que estava mentindo.**

O script de screenshot rodava num processo PowerShell **DPI-unaware**. Num monitor a 125%, o Windows
*virtualiza* as coordenadas para esses processos: `GetWindowRect` devolvia `1294x870` para uma janela
que tinha **1618x1087 pixels físicos**. O script então capturava um retângulo de 1294x870 pixels
FÍSICOS a partir do canto da janela — ou seja, **os 80% superior-esquerdos da janela**. O "corte à
direita" era a borda da minha própria captura.

**Três hipóteses erradas antes de achar isso**, registradas porque cada uma parece óbvia e todas
custaram tempo:

1. *"Os aros (`.nx-page::before`, em `right: -240px`) criam área rolável horizontal e o `mx-auto`
   centraliza contra ela."* A primeira metade é **verdade** e foi medida (`scrollWidth` 1282 contra
   1052 de largura); a segunda é falsa — `overflow-x: clip` não moveu um pixel do layout. A correção
   ficou no código porque a área rolável fantasma é real, com o comentário dizendo que ela **não**
   cura o corte.
2. *"O zoom do WebView ficou desregulado por um `Ctrl+-` da sessão anterior."* Falso: layout idêntico
   antes e depois.
3. *"A viewport do WebView é mais larga que a janela."* Foi a leitura que fiz da sonda —
   `devicePixelRatio=1.25` com `innerWidth=1280` (= 1600 físicos) contra uma janela de "1294". **Erro
   meu na aritmética da própria medição**: os 1294 vinham do processo virtualizado, e a janela real
   tinha 1618 físicos ≈ 1294 lógicos ≈ os 1280 CSS que a página reportou. Viewport e janela sempre
   concordaram. Este ADR chegou a ser escrito com essa causa errada e foi corrigido depois que o log
   do próprio conserto (`from="1618x1087" ... screen="1920x1080"`) desmentiu o número.

**A prova.** Marcado o processo de captura como `PER_MONITOR_AWARE_V2`, a mesma tela apareceu
inteira: o botão "Nova meta", o Ring de progresso, os sub-desafios, tudo. Nenhuma linha de CSS mudou
entre uma captura e outra.

**O defeito REAL que a caçada encontrou de passagem.** O log do conserto mostrou a janela nascendo
com **1618x1087 físicos numa tela de 1920x1080** — mais alta que a tela inteira, antes mesmo da barra
de tarefas. `tauri.conf.json` pede `height: 832` em px **lógicos**, o que a 125% vira 1040 físicos, e
com a moldura passa de 1080. O rodapé da janela nascia fora da tela.

**Decisão.** `fit_window_to_screen` no `setup`: compara o tamanho FÍSICO da janela com o do monitor e
a encolhe se não couber, recentrando depois. Físico dos dois lados — é a única unidade em que janela
e monitor falam a mesma língua, e foi justamente misturar lógico com físico que produziu as três
hipóteses erradas acima. A margem de 80px cobre barra de tarefas e moldura.

**Considerado e RECUSADO: só baixar o número no `tauri.conf.json`.** Puniria telas grandes e
continuaria errando em qualquer escala diferente da testada. A pergunta não é *"quanto cabe?"* — é
*"cabe?"*, e só o monitor responde, no boot.

**Falhar aqui nunca impede o app de abrir:** cada passo só registra e desiste. Uma janela do tamanho
errado é um incômodo; um app que não abre é um app quebrado.

**As duas lições, que valem mais que o conserto.**

1. **Quando a tela discorda do código, meça de dentro da tela.** A sonda de cinco linhas plantada na
   página deveria ter vindo antes das três hipóteses, não depois.
2. **Desconfie do instrumento antes de reprojetar o prédio.** Eu quase reescrevi o CSS de todas as
   telas do app — e depois quase gravei uma causa errada neste arquivo, que é o registro que a
   próxima sessão vai acreditar sem reverificar. Uma dirigida só vale o que vale a fidelidade da
   captura: o script de screenshot agora força `PER_MONITOR_AWARE_V2`, e **toda dirigida futura
   depende disso**.

---

## ADR-0081 — O defeito da 0018 era de CLASSE: a varredura do schema vira teste, e a árvore sai com um evento por filho

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 3c** · **migration 0019**

**Contexto.** O ADR-0078 consertou três colunas `habit_id` e parou aí. Mas o que ele descreveu não é
um defeito de três colunas — é um defeito de **forma**:

```sql
coluna TEXT REFERENCES nodes(id)          -- sem cláusula ON DELETE
```

que o SQLite lê como NO ACTION (*"recuse apagar o pai"*) e que quem escreve lê como *"não leve o
filho junto"*. As duas leituras só divergem no dia em que alguém aperta "excluir". Enquanto essa
forma existir em **qualquer** coluna viva, existe um caminho pelo qual o app devolve
`FOREIGN KEY constraint failed` na cara do usuário.

A varredura por essa forma (`PRAGMA foreign_key_list` em todas as tabelas) achou as três que
sobravam, e todas as três reproduzem com um clique:

| coluna | desde | o que o usuário faz |
|---|---|---|
| `nodes.parent_id` | **0001** | apagar um PROJETO com tarefas; uma MATÉRIA com temas (ADR-0077); um OBJETIVO com sub-desafios |
| `habit_details.routine_id` | **0001** | apagar uma ROTINA que tem hábitos dentro |
| `subject_details.level_goal_id` | **0016** | apagar, pela tela de Metas, a meta que é a escada de um IDIOMA |

A do meio e a de baixo são a fase 3b outra vez, em outro lugar. A de cima é maior: **sub-desafios
existem desde a fase 3b** e são `milestone` filhas por `parent_id` — ou seja, a fase que acabou de
sair já entregava metas com sub-desafios que ninguém conseguia apagar.

**Decisão 1 — a varredura vira teste, não um conserto.** `no_foreign_key_to_a_node_refuses_the_delete`
(em `tests/deletion.rs`) percorre `sqlite_master` e roda `PRAGMA foreign_key_list` em cada tabela;
qualquer FK para `nodes` com `on_delete = NO ACTION` reprova o gate, com o nome da coluna na
mensagem. A quarta coluna dessa forma não chega a nascer. É a diferença entre consertar um bug e
fechar a porta por onde ele entra — e é a resposta à pergunta que o ADR-0078 deixou sem fazer:
*"onde mais?"*.

`areas` e `accounts` ficam **de fora de propósito**: nenhuma das duas tem caminho de exclusão hoje (a
área se arquiva; as contas são semeadas pela migration). A guarda diz isso por escrito, para que o dia
em que alguma ganhar um delete seja o dia em que ela cresce junto.

**Decisão 2 — `ON DELETE SET NULL` nas três, inclusive em `parent_id`, e por que NÃO CASCADE.**
Para `routine_id` e `level_goal_id` é a mesma cláusula pelo mesmo motivo da 0018: vínculo frouxo, o
filho sobrevive.

`nodes.parent_id` é o caso interessante, porque ali a resposta certa para o usuário é a **contrária**:
apagar o projeto DEVE levar as tarefas. E mesmo assim a FK vai a SET NULL, porque

> um CASCADE apagaria os filhos **sem um evento no ledger**.

As tarefas sumiriam junto com a história de terem existido — a metade da regra do ADR-0056 que o
CASCADE não sabe cumprir, porque roda dentro do banco, abaixo da camada que sabe apendar.

**Decisão 3 — quem leva os filhos é o repositório, descendo a árvore com um evento por node.**
`SqliteNodeRepository::delete_with_event` passa a coletar os descendentes por CTE recursiva, apendar
um `deleted` para cada um (com o instante do pai e `"with_parent": <id>` no payload, para a Timeline
não sugerir que o usuário apagou dez coisas) e apagar do mais fundo para o mais raso — tudo numa
transação. Fica no **repositório**, e não em `NodeService`, porque os cinco serviços que apagam nodes
(nodes, metas, temporadas, eventos, caixinhas) já funilam por esse único método: pôr a descida na
camada de cima obrigaria os cinco a lembrar, e o sexto esqueceria.

Então para que mexer na FK, se o serviço já resolve? **Porque a FK é o piso e o código é o
comportamento.** Se um caminho futuro apagar um node sem descer a árvore, com SET NULL ele deixa um
órfão VISÍVEL na lista de tarefas — feio, corrigível, ledger intacto. Com NO ACTION devolve erro de
storage; com CASCADE apaga em silêncio e leva a história junto. Das três formas de errar, SET NULL é
a única que o usuário enxerga e desfaz.

**O que a migration quase perdeu, e a guarda que nasceu disso.** `subject_details` ganhou quatro
colunas por ALTER na 0016 e a `summary` na 0017; a primeira versão da reconstrução **esqueceu a
`summary`**. Um `INSERT ... SELECT` que omite uma coluna não dá erro — ele só apaga o dado, e o
repositório (que faz `SELECT` por nome) só descobre no dia em que alguém lê o campo. Foi um teste da
0017 que a cobrou de volta, e o teste `the_rebuilt_tables_keep_every_column` agora compara
`pragma_table_info` antes (v18) e depois (v19) das três tabelas: numa reconstrução, **só a cláusula
`ON DELETE` pode ter mudado**.

**O achado de tabela: três testes de migration não estavam testando o upgrade real.** Os testes da
0018 subiam com `migrations().to_latest()` cru, e o seed deles liga as FKs. O runner de verdade
(`run`) **desliga** as FKs durante a subida — porque um `DROP TABLE nodes` com FK ligada dispara o
`ON DELETE CASCADE` dos oito satélites e **apaga os dados do usuário**. Enquanto nenhuma migration
nova tocasse `nodes`, o atalho passava despercebido; a 0019 toca, e os três caíram com os satélites
vazios. Eles agora sobem pelo `run()`. A lição vale além daqui: **um teste de migration que não passa
pelo caminho do app não está testando o upgrade que o usuário recebe** — ele está testando um upgrade
que ninguém executa.

**Consequência para o `%APPDATA%` real.** Ele ainda está em v16 e agora sobe de uma vez a v19, com o
snapshot automático do ADR-0069 por cima do backup manual. `nodes` é recriada pela QUINTA vez (0007,
0011, 0012, 0013, 0019): `rowid` preservado no INSERT e os três gatilhos de FTS recriados palavra por
palavra — as duas armadilhas que falham em SILÊNCIO, cobertas por
`the_search_index_still_points_at_the_right_row`.

---

## ADR-0082 — A medição e o depósito ganham saída; a conquista que um depósito errado gerou NÃO volta atrás

**Data:** 2026-07-21 · **Status:** aceito · **v1.3 (COCKPIT), fase 3c**

**Contexto.** A varredura da fase 3c tinha duas metades. A primeira eram os PAIS indeléveis
(ADR-0081). A segunda: coisas que o usuário cria e para as quais **não existe command de exclusão
nenhum** — nem botão morto, nem erro: simplesmente não há caminho. Passando os olhos por tudo que se
cria, sobraram duas, e as duas são justamente onde um dedo gordo dói mais:

| O que | O que acontecia |
|---|---|
| **Medição de meta** (`goal_checkpoints`) | Digitar 8,5 onde eram 85 kg movia a meta **para sempre**. E não fica quieto: a medição entra na barra, na sparkline e nos **mínimos quadrados da projeção**, que passa a anunciar uma data de chegada calculada sobre um número que nunca aconteceu. |
| **Depósito de caixinha** (`fin_goal_deposits`) | Um R$ 5.000 onde eram R$ 500 seguia inflando o guardado e a projeção de quando a caixinha fecha. |

O depósito é o caso mais difícil de defender: o **aporte** já podia ser excluído desde o ADR-0056, e
é o mesmo dinheiro digitado no mesmo teclado. Pior, os depósitos não tinham **tela nenhuma** — o
command `fin_goal_deposits` existia e nenhuma parte do front o chamava. Dava para lançar e nunca para
ver.

**Decisão 1 — as duas saídas, e nenhum recálculo.** `delete_goal_checkpoint` e
`delete_fin_goal_deposit`, ambos no molde do `delete_contribution`: apaga o ESTADO, apenda a correção,
o evento original fica. E nenhum dos dois recalcula nada, porque **não há nada a recalcular**:
`savedCents` é a SOMA dos depósitos feita na leitura (0011), e barra/série/projeção saem dos
checkpoints a cada `goal_with_progress`. Tirar a linha já corrige todos. É a mesma propriedade que
faz o aporte excluído não mexer em saldo — derivação em vez de estado duplicado (ADR-0037) pagando
juros anos depois.

**Decisão 2 — o número que mostra o total é o que revela as parcelas.** A sparkline da meta abre a
série de medições; o "R$ guardado" da caixinha abre o extrato. Nenhuma tela nova, nenhum modal: o
lugar de listar as parcelas é embaixo do total que elas formam. A query do extrato mora no
componente da lista, e não no card, para ser **preguiçosa** — doze caixinhas não podem disparar doze
`fin_goal_deposits` no carregamento por causa de uma lista que ninguém abriu.

**Decisão 3, a não-óbvia — apagar o depósito NÃO desfaz a conquista que ele gerou.** Se o R$ 5.000
errado cruzou o alvo, o `Completed` continua no ledger e a conquista continua contada; o
`nodes.status` também não volta a `'active'` sozinho. Isso parece inconsistente e não é: **o ledger é
append-only** (ADR-0056), e a conquista ACONTECEU no instante em que o número cruzou o alvo. Desfazê-la
seria reescrever o passado — exatamente o que o app inteiro se recusa a fazer. Reabrir uma caixinha é
uma decisão do usuário, não um efeito colateral de apagar uma linha. O teste
`a_mistyped_deposit_can_be_taken_back_but_the_achievement_stays` prende as duas metades para que uma
"correção" futura não ache que está consertando um esquecimento.

**Dois defeitos que só a dirigida achou, e que nenhum teste teria achado.**

1. **`group-hover` anônimo casa com QUALQUER ancestral.** O card da caixinha já era um `group`; passar
   o mouse nele armava a lixeira de **todas** as linhas do extrato ao mesmo tempo. Corrigido com
   grupo NOMEADO (`group/linha`) nos dois lugares — o escopo passa a ser dito, não presumido.
2. **A exclusão armada não cabia no card.** `ArmedDelete` é `shrink-0` e a pergunta por extenso
   ("Excluir este lançamento?" + dois botões) ficava mais larga que uma caixinha numa grade de três
   colunas: a linha empurrava o título e o valor **para fora da borda**. Corrigido com `flex-wrap` na
   linha e pergunta curta. A regra do COCKPIT — *container central obrigatório, nada colando na
   borda* — vale também para o que só aparece depois de um clique.

Os dois são a razão de a régua ser *"nenhum 'pronto' sem screenshot"*: o gate estava verde nos dois
casos.
