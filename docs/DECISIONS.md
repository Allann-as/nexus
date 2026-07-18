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
