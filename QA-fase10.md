# QA — Fase 10 (correções finais de design)

Branch `fase10-correcoes-finais`. Rodado com o app vivo (`vite` em :1420) e capturas
headless (Edge/Playwright + stub do backend) em `docs/verify-fase10/` (untracked, como
na fase 9). `npx tsc --noEmit` limpo; `vitest run` 129/129; grep de rede zerado nos
arquivos tocados.

## Checklist do §11

1. **Bloqueio** — `01/02/03-lock-*.png`
   - HUD digita a telemetria local (data por extenso · ping <1ms · backup · v1.3.0 · data). ✅
   - Logo = **núcleo orbital** (duas órbitas cruzadas + núcleo + corpos), **sem "N"**. ✅
   - **Sem anéis atrás do PIN** (o `BezelRings` foi removido, não desabilitado). ✅
   - Saudação sem nome antes do PIN ("Boa noite."/"Boa madrugada."). ✅
   - PIN certo → 6 pontos ficam **verdes com glow** + "operador identificado ✓" + "Seja
     bem-vindo de volta, {nome}." abaixo → destrava. ✅
   - PIN errado → tremor/vermelho + "senha incorreta", **sem vazar o nome**. ✅
   - Teclas em **squircle** (`border-radius: 44% / 44%`). ✅
2. **Borda infinita / barra da seção** — `06a/06b`, `11-menu`
   - Fundo de estrelas de ponta a ponta, **sem faixa de cor destoante**. ✅
   - Topbar = **luz ambiente** (véu da cor que desce e dissolve, mascarado), **sem bloco
     nem borda saturada**. A troca de seção interpola (`background-color` + `--tint`). ✅
3. **Menu cápsulas + peek** — `11-menu-collapsed.png` (+ verificação de DOM do fio)
   - Esferas em **cápsulas** (pílula, ativa preenche na cor + barra de 3px). ✅
   - `Ctrl/⌘+B` recolhe: painel some, resta o **fio de 5px pulsando na cor da seção
     ativa** (medido: 5×900px, `#4d8dff` na Finanças, glow 16px). Hover na borda revela;
     sair esconde. ✅
4. **Botões barra-de-acento** — `11-menu` ("Registrar aporte"), onboarding
   - Primário = grafite neutro + **faixa de 3px à esquerda na cor da seção** (`--sphere`)
     + ícone na cor. Adeus verde-limão fixo. ✅
   - Onboarding: input com placeholder **"Insira seu nome"** + caret na cor; "Entrar no
     NEXUS" segue a barra-de-acento. ✅
5. **Uma cor por seção** — `06a`
   - Saúde: **nada de âmbar** — "Maior streak" (chama), "Próximo exame" e a linha/borda
     do exame ("Exame de sangue") agora seguem o **verde** da Esfera. A urgência do exame
     fica no texto do countdown (hoje/amanhã/Nd), não numa cor que destoa. ✅
   - Idem no `SphereDashboard` (streak, tarefas abertas e a frase-resumo) e no
     `HealthExams` (tile/linha/badge). Cor de **estado** real (vermelho de resgate/erro,
     LED âmbar de dia parcial, score do Hub) permanece — não é acento decorativo.
6. **Hub — saudação digitada** — `10-hub.png`
   - "Boa madrugada, Allan" datilografa com cursor; o cursor pisca ~6s e some (só na
     entrada do Hub). ✅
7. **reduced-motion** — `07-reduced-motion.png`
   - Bloqueio estático e legível (starfield 1 quadro, sem datilografia, sem cadente); o
     fio do menu fica aceso e parado; a saudação do Hub aparece pronta sem cursor. ✅
8. **Regressão** — `tsc` + `vitest` limpos; Hub, Saúde e Finanças renderizam sem erro no
   console (só um 404 de asset/fonte no headless, inócuo).

## Pendências / notas honestas

- **Discrepância de paleta (§7) — mantive o PROJETO e aviso, como pedido.** O mockup nomeia
  Finanças = ciano `#38C6E0` e Estudos = azul `#5B8DEF`; o projeto tem **Finanças = azul
  `#4d8dff`** e **Estudos = ciano `#38bdf8`** (efetivamente trocados de matiz), além de
  Saúde `#34d399` (mockup `#3FD98B`), Objetivos `#fbbf24` (`#F5B94A`), Carreira `#ec4899`
  (`#EC6A8C`). A verdade é `areas.color` no banco (migration 0005); não mexi. **Decidir se
  quer alinhar Finanças/Estudos ao mockup.**
- **Ícone do bundle (.ico/.png/.icns)** não foi regenerado — é ativo binário de build, e o
  §11 proíbe build/release. A logo VIVA do app (`NexusMark` + splash do `index.html`) já é o
  núcleo orbital; o ícone do executável ainda mostra o "N" até um `node generate.mjs` + build.
- **Poeira estelar da logo**: implementada como canvas animado só nas instâncias `plate`
  (bloqueio/onboarding/Sobre/design-system) — respeita reduced-motion (1 quadro) e pausa com
  a janela sem foco. As instâncias pequenas (rail 24px, favicon) não a ligam, pela higiene de
  "um logo pequeno não paga um rAF".
- **Carreira/Estudos** não foram capturados no headless: os painéis leem queries que o STUB
  não modela (ex.: `StudiesDashboard.tsx:215`), caindo num ErrorBoundary **de mock, não de
  código** (não toquei nesses arquivos). No app real com dado semeado, renderizam.
- **A11y do peek**: o painel recolhido fica fora da tela (`translateX(-100%)`) mas no DOM;
  teclado revela por `Ctrl/⌘+B` (fixa e foca). Off-canvas tabbable é padrão conhecido.

## Grep de rede (arquivos tocados)

`fetch(` · `reqwest` · `http(s)://` · `XMLHttpRequest` · `WebSocket` · `axios` · `ws://` →
**nenhum**. Tudo local: relógio `new Date()`, ping = latência local, nome do `settings.json`.
