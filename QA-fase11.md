# QA-fase11 — bugs achados dirigindo o app

> **Ambiente, sem suavizar:** a janela nativa do Tauri não renderiza aqui. Prova de
> LÓGICA (validações, CRUD, coalescência) = **teste automatizado Rust** (SQLite real).
> Prova VISUAL (estados de UI) = **render do estado específico** no Edge headless
> (Vite:1420 + stub). Abri o app (o frontend) como primeira ação e diagnostiquei antes
> de editar. Cada item abaixo tem a prova que rodei.

Regressão executada: `cargo test` → **todos passam** (incl. 3 testes novos); `tsc` → 0;
`vitest` → 129/129; grep de rede nos arquivos tocados → **nenhum**.

## Tabela bug-a-bug

| # | Bug | Status | Prova (o que rodei / o que vi) |
|---|---|---|---|
| 1 | Sacar mais que o saldo na caixinha (−247072%) | **PASS** | 4 testes Rust `tests/fin_goals.rs`: saque > saldo **rejeitado**, saque = saldo zera sem negativar, depósito 0 rejeitado, aporte+saque válido soma certo. + clamp da % no front (visto em `15`: "R$ 1.200 de R$ 4.500", sem % absurda) |
| 2 | Não dá pra excluir/editar hábito nos Checkpoints | **PASS** | UI: `14-checkpoints.png` mostra por linha **renomear · desativar · excluir**. Teste Rust `habits_tasks.rs::a_checkpoint_habit_can_be_renamed_archived_and_deleted` (ciclo create→rename→archive→delete) |
| 3 | Confirmação de "Excluir caixinha" sobrepondo o card | **PASS** | `15-caixinha-excluir.png`: confirmação em **camada sólida legível** (véu + blur, botões centralizados), sem sobreposição |
| 4 | Bolinhas do PIN brancas | **PASS** | `13-pin-verde.png`: 4/6 pontos em **verde fósforo com glow** ao digitar |
| 5 | Flash da Home antes do login | **PASS** | `16-boot-splash.png`: cortina neutra (marca) durante o boot. Check de DOM `BOOT_HUB_VAZOU=false` (nenhum "Nexus Score"/"Suas Esferas"/saudação vaza antes do lock) |
| 6 | Recolhimento do menu "seco" | **PASS** | DOM: painel `display:flex` (montado, nunca `display:none`), `transition: transform 0.38s cubic-bezier(.4,0,.2,1)`, e o parent `width 0.38s` com o MESMO easing (antes: 200ms vs 400ms dessincronizados) |
| 7 | Timeline com nota duplicada | **PASS** | Teste Rust `note_repo::autosave_coalesces_note_edited_to_one_per_day`: 3 autosaves no mesmo dia = **1** evento `note_edited`; dia novo = o 2º; corpo salvo sempre |

## Causa raiz e correção, por bug

**BUG 1** — `FinGoalService::deposit` só validava `amount_cents == 0`. O saldo é a SOMA
dos lançamentos (sem coluna), então um saque negativo puxava a soma abaixo de zero e a UI
fazia `saved/target*100` → −247072%. **Correção:** trava no serviço (fonte da verdade) —
`amount_cents < 0 && amount_cents.abs() > goal.saved_cents` → `NexusError::Validation("não
dá para sacar mais do que a caixinha tem")`. No front, `CaixinhaCard` clampa a % em
`0..100%` (barra e texto), defesa em profundidade para dado legado.

**BUG 2** — o backend e o IPC já tinham tudo (um hábito é um `node`: `renameNode`,
`setNodeStatus("archived")`, `deleteNode`). Faltava só UI: `CheckpointRow` só marcava.
**Correção:** ações na linha — renomear (inline), **desativar** (arquiva sem apagar
histórico/streak — some dos checkpoints ativos) e **excluir** (`ArmedDelete`; o `Deleted`
no ledger preserva a Timeline).

**BUG 3** — o `ArmedDelete` armado renderizava inline (`flex shrink-0`); num card estreito
a pergunta por extenso não cabia e quebrava sobre a barra/valor. **Correção:** prop
`overlay` no `ArmedDelete` — a confirmação vira uma camada sólida sobre o card `relative`,
centralizada. Padroniza Finanças e Objetivos (ambos usam `CaixinhaCard`).

**BUG 4** — o ponto preenchido do PIN usava `--text-primary` (branco). **Correção:**
`on || success` → fósforo `var(--accent)` com `box-shadow` de glow (já ao digitar).

**BUG 5** — "flash of authenticated content": o `LockGate` retornava `null` enquanto
`lock_status` (assíncrono) não respondia, deixando o Hub (router, montado atrás) aparecer.
**Correção:** enquanto `onboarding === null` (boot), o `LockGate` mostra um `BootSplash`
neutro (marca + estrelas) que cobre tudo; a resolução "há PIN" seta lock no mesmo tick, então
a cortina dá lugar ao BLOQUEIO direto — nunca ao Hub. O router segue montado atrás (preserva
o estado ao bloquear com Ctrl+L no meio do uso).

**BUG 6** — o painel animava `transform` em 400ms e a coluna `width` em 200ms, com easings
diferentes: o descompasso lia como "seco". **Correção:** os dois em `0.38s
cubic-bezier(.4,0,.2,1)`. O painel nunca é `display:none` (desliza montado). Em
reduced-motion do SO a transição some (estado final legível — nota abaixo).

**BUG 7** — NÃO era insert duplo. O backend grava 1 evento por `save_body`, mas o **autosave**
do editor chama `save_note_body` a cada pausa da digitação, e cada um emitia um `note_edited`
— duas pausas viravam duas "Nota" no mesmo minuto. **Correção:** coalescência no
`save_body_with_event` — só grava o `note_edited` se ainda não houve um HOJE para essa nota
(o corpo/links salvam sempre; só o EVENTO é coalescido). 1 entrada por nota por dia.

## Notas honestas
- **BUG 6 em reduced-motion:** a transição CSS é zerada pelo reduced-motion do SO/usuário, então
  o recolher vira corte (estado final legível), não fade. O slide suave vale no modo normal, que é
  o caso do relato. Deixei assim para não reintroduzir animação onde o usuário pediu para reduzir.
- **CRUD "dirigido de verdade":** provei a LÓGICA por teste Rust e o VISUAL por render; não cliquei
  os botões contra o backend real (o headless usa stub). O ciclo real (marcar hábito, excluir,
  sacar) roda no app nativo do Allan — mas a fonte da verdade (serviço/repo) está coberta por teste.

## Grep de rede
`fetch(`/`reqwest`/`http(s)://`/`XMLHttpRequest`/`WebSocket`/`axios`/`ws://`/`TcpStream` nos
`.ts/.tsx/.rs` do diff → **nenhum**. 100% offline mantido.
