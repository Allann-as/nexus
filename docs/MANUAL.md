# NEXUS — Manual do Usuário (v1.0.0)

O NEXUS é o seu **Personal Operating System**: um único aplicativo de desktop que
reúne as suas Esferas da vida — Saúde, Finanças, Carreira, Estudos e o que você
criar —, com hábitos, tarefas, metas, agenda, notas e uma linha do tempo que nunca
se apaga. **100% offline, zero telemetria, zero IA.** Todo número que ele mostra
tem um "ⓘ como calculamos" ao lado — nada é mágica.

---

## 1. Primeiros passos

Ao abrir, o NEXUS pede um **PIN**. O PIN de fábrica é **242807**. Troque-o assim
que puder (Configurações › Segurança).

A tela inicial é o **Hub**: as suas Esferas com o sinal vital de cada uma, o
**Nexus Score** do dia, a faixa **Hoje** (os hábitos marcáveis), o **Horizonte**
(o que vem — viagens, provas, temporadas) e o **Neste dia** (o que aconteceu em
anos anteriores).

---

## 2. Atalhos de teclado

O NEXUS é teclado-primeiro. Os principais:

| Atalho | O que faz |
|---|---|
| `Ctrl+K` | Abre a **paleta de comandos** (busca tudo + ações) |
| `Ctrl+Shift+N` | **Captura Rápida** para o Inbox — funciona **mesmo com o app minimizado na bandeja** |
| `Ctrl+L` | **Bloqueia** a tela (pede o PIN) |
| `G` depois `<tecla>` | Salta para uma seção (os "chords") |

Os saltos `G+<tecla>`:

| Tecla | Destino | | Tecla | Destino |
|---|---|---|---|---|
| `h` | Hub | | `s` | Insights |
| `c` | Calendário | | `a` | Metas Anuais |
| `i` | Inbox | | `o` | Objetivos |
| `n` | Notas | | `q` | Conquistas |
| `t` | Timeline | | `b` | Hábitos |
| `f` | Foco | | `m` | Metas |
| `r` | Revisão Semanal | | `p` | Projetos |
| `w` | Semana Perfeita | | `k` | Recordes |
| `x` | Ano em Pixels | | `v` | Comparativo |
| `y` | Retrospectiva | | | |

As telas de análise (Semana Perfeita, Recordes, Ano em Pixels, Comparativo,
Retrospectiva) também estão no menu central **O NEXO** (o botão de menu no topo),
no grupo **Análise**.

---

## 3. O PIN — privacidade de tela (leia isto)

**O que o PIN é:** ele impede que alguém que pegue o seu computador **desbloqueado**
abra o NEXUS e leia a sua vida. É privacidade de **tela**.

**O que o PIN NÃO é:** ele **não cifra o banco de dados no disco**. Quem tem acesso
ao arquivo `nexus.db` (em `%APPDATA%\Nexus`) consegue lê-lo com outras ferramentas.
O NEXUS é honesto sobre isso — não finge uma proteção que não tem. Se você precisa
de sigilo contra quem tem o disco, use a cifra de disco do próprio Windows
(BitLocker).

- **Trocar o PIN:** Configurações › Segurança › informe o PIN atual e o novo.
- **Desativar o PIN:** Configurações › Segurança › informe o PIN atual. Sem PIN, o
  app abre direto.
- O PIN vive num `security.json` **fora do banco**, então **sobrevive a um restauro
  de backup** (restaurar um snapshot antigo não reabre a sua tela).

---

## 4. Backup, restauração e exportação

Tudo em **Configurações › Backup & Dados**.

- **Backup automático:** o NEXUS tira snapshots consistentes do banco (via
  `VACUUM INTO`) e os mantém com uma política de retenção. Você pode disparar um
  backup na hora e escolher uma **pasta de sincronização** (para o seu Drive/OneDrive
  copiar os snapshots).
- **Senha de backup (opcional):** protege os snapshots. A senha mora em claro fora do
  backup (senão você não conseguiria restaurar) — é conveniência, não cofre.
- **Restaurar:** escolha um snapshot; a troca é aplicada **no próximo boot**, o único
  momento em que nada segura o banco. Um `quick_check` roda antes — se o snapshot
  estiver corrompido, o banco atual é mantido.
- **Exportar:** gera uma pasta legível por humanos em `%APPDATA%\Nexus\exports\` —
  um JSON por tabela, CSVs e a mídia anexada. É o seu dado, sempre seu, em formato
  eterno.
- **Retrospectiva:** a tela **Retrospectiva** (`G+y`) exporta um resumo do ano em
  Markdown para `%APPDATA%\Nexus\retrospectives\` (mantido por 2 anos; o dado-fonte é
  eterno e regenera o arquivo quando quiser).

Os seus arquivos ficam todos sob **`%APPDATA%\Nexus\`** — nunca ao lado do
executável.

---

## 5. A bandeja do Windows

O NEXUS vive na **bandeja** (a área de ícones perto do relógio).

- **Clique no ícone:** traz o app à frente, no **Hub** — os seus hábitos de hoje e o
  score, à mão.
- **Menu (botão direito):** Abrir NEXUS · Captura rápida · Sair.
- **`Ctrl+Shift+N` de qualquer lugar:** abre a Captura Rápida mesmo com o app oculto —
  jogue uma ideia no Inbox sem parar o que está fazendo.
- **Fechar a janela minimiza para a bandeja** em vez de sair (o app segue vivo,
  pronto para o atalho global). Para sair de verdade, use **Sair** no menu da bandeja.
- Não gosta? **Configurações › Aparência › Fechar para a bandeja** desliga — aí
  fechar a janela encerra o app como qualquer outro.

---

## 6. Instalar o NEXUS em outra máquina

1. Vá ao repositório no GitHub, aba **Releases**, e baixe o **`NEXUS-Setup-v1.0.0.exe`**
   da release **v1.0.0** (ou o `.msi`, se preferir o instalador MSI).
2. Rode o instalador. Ele instala **para o usuário atual** (não pede administrador) e
   cria o atalho no menu Iniciar.
3. Abra o NEXUS. Ele começa vazio, com as 5 Esferas de fábrica. O PIN inicial é
   **242807**.
4. Para levar os seus dados junto: copie a pasta **`%APPDATA%\Nexus\`** da máquina
   antiga para a nova (com o app fechado), ou restaure um backup pela tela de
   Configurações.

O instalador **não depende de rede** para nada — o SQLite é embarcado, as fontes são
empacotadas, e o updater é desligado. O que você instala é o que roda, para sempre.

---

## 7. Onde as coisas ficam

```
%APPDATA%\Nexus\
  nexus.db            o seu banco (SQLite, WAL)
  media\              os anexos das notas
  backups\            os snapshots automáticos
  exports\            as exportações humanas (JSON + CSV)
  retrospectives\     os Markdown das retrospectivas anuais
  logs\               os logs (rotação diária)
  security.json       a config do PIN (nunca o PIN em claro)
  settings.json       as preferências (fechar para a bandeja)
```

Faça backup dessa pasta e você tem a sua vida inteira no NEXUS, portátil e eterna.
