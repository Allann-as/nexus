# As ferramentas da dirigida

Três scripts para **dirigir o app de verdade** — abrir, clicar, digitar e
fotografar — que é a régua de qualidade do projeto: *nenhum "pronto" sem
screenshot comparado ao Hub*.

Eles moram no repositório, e não no diretório temporário de uma sessão, por uma
razão específica: **uma dirigida só vale o que vale a fidelidade da captura**, e
a armadilha que quebra essa fidelidade não é óbvia. Ver o ADR-0080.

## A armadilha que custou uma sessão inteira

Num monitor com escala (125% é o padrão do Windows em notebook), o Windows
**virtualiza** as coordenadas para processos *DPI-unaware* — que é o que um
PowerShell comum é. Na prática:

- `GetWindowRect` devolve **1294x870** para uma janela que tem **1618x1087
  pixels físicos**;
- `CopyFromScreen` captura pixels **físicos**;
- a foto sai com os **80% superior-esquerdos** da janela, e o resto vira uma
  borda que parece corte de layout.

Foi exatamente assim que a dirigida da fase 3b "provou" que todas as telas do app
estavam cortadas à direita e que um botão não existia. Nenhuma das duas coisas
era verdade. Três hipóteses foram levantadas e testadas contra o CSS e a config
da janela antes de alguém desconfiar da câmera.

`shot.ps1` e `click.ps1` chamam `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)`
na primeira linha. **Não remova.** Sem isso, tudo o que vier depois é medido numa
régua torta.

## Uso

Suba o app **sempre** pelo `dev.ps1` da raiz — ele isola os dados em `.devdata`.
Nunca `tauri dev` à mão: isso abre o `%APPDATA%` real do usuário.

```powershell
.\dev.ps1 -NoSeed        # ou -Reseed para semear do zero

# fotografar a janela do app (acha pelo PROCESSO, nao pelo titulo:
# "Nexus ... - Visual Studio Code" casaria com qualquer filtro por nome)
.\tools\dirigida\shot.ps1 -Out .\.devdata\hub.png

# digitar (uma tecla por vez, com folga para o React montar cada estado)
.\tools\dirigida\keys.ps1 -Keys "242807"      # o PIN de fabrica
.\tools\dirigida\keys.ps1 -Keys "^k" -Raw     # -Raw para combinacoes/teclas especiais
.\tools\dirigida\keys.ps1 -Keys "{ESC}" -Raw

# clicar numa coordenada RELATIVA A JANELA, em pixels fisicos —
# exatamente os que se leem da imagem que o shot.ps1 gerou
.\tools\dirigida\click.ps1 -X 1387 -Y 333
```

## Duas coisas que não funcionam, para não se tentar de novo

- **Redimensionar a janela por `SetWindowPos`/`ShowWindow`.** O WebView não
  reflui junto, e numa das tentativas a janela foi parar na bandeja e não voltou
  — foi preciso reiniciar o app. Se a janela precisa nascer de outro tamanho, o
  lugar é o `fit_window_to_screen` no `setup` do Rust.
- **Zoom do WebView (`Ctrl+-`).** Está desabilitado; a tela não muda.
