-- 0007_time.sql — o Tempo: recorrências, categorias de evento e sub-desafios
--
-- IMMUTABLE ONCE COMMITTED.
--
-- Três coisas, nesta ordem porque a primeira é a arriscada:
--
--   1. `nodes.kind` ganha 'milestone' (exige recriar a tabela — ver abaixo).
--   2. `event_details` ganha `category`.
--   3. `event_occurrences` — as recorrências materializadas.

-- =====================================================================
-- 1. O vocabulário de `nodes.kind` ganha 'milestone'
-- =====================================================================
--
-- O DATA_MODEL §2 promete que criar um tipo é rotina: "1 valor no CHECK de
-- `kind` + 1 satélite + 1 migration". Esta é a primeira vez que a promessa é
-- cobrada, e ela custa mais caro do que a frase sugere: o SQLite **não sabe
-- alterar um CHECK**. A única via é o *12-step procedure* oficial — criar,
-- copiar, dropar, renomear.
--
-- Por que 'milestone' merece o custo: um sub-desafio ("30 dias sem açúcar") não
-- é nenhum dos nove kinds existentes. Enfiá-lo em 'task' o faria vazar para as
-- listas de tarefa e para o Nexus Score; enfiá-lo em 'goal' pediria métrica,
-- unidade e direção que ele não tem. Um kind errado é para sempre — a linha
-- fica gravada no banco do usuário.
--
-- ===== As três armadilhas deste bloco =====
--
-- (a) **CASCADE.** `DROP TABLE nodes` com FK ligada roda um DELETE implícito, e
--     os oito satélites com `ON DELETE CASCADE` seriam apagados junto. Quem
--     desliga a FK é o runner (`migrations.rs`), porque o pragma é no-op dentro
--     da transação em que este arquivo roda.
--
-- (b) **O rowid.** O `search_index` é FTS5 contentless: ele NÃO guarda node_id,
--     o vínculo com o conteúdo é `search_index.rowid = nodes.rowid` (ver 0002).
--     Uma cópia sem `rowid` explícito renumeraria tudo e a busca inteira passaria
--     a apontar para as linhas erradas — em silêncio, sem erro, sem quebrar
--     teste nenhum que não procure por isso. O INSERT abaixo copia o rowid.
--
-- (c) **O rename.** Desde o 3.25 o `ALTER TABLE RENAME` reescreve referências
--     dentro de triggers e views, e reparsa o schema inteiro para isso. Como
--     `nodes` foi dropada um passo antes, os gatilhos de FTS que moram em
--     `note_details`/`node_tags` e falam de `nodes` fariam o rename explodir.
--     `legacy_alter_table=ON` devolve o comportamento antigo (renomeia a tabela
--     e não toca em referência nenhuma), que é exatamente o que o 12-step quer.
PRAGMA legacy_alter_table = ON;

CREATE TABLE nodes_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN
                 ('note','task','project','goal','habit','routine',
                  'event','file','inbox_item','milestone')),
    title       TEXT NOT NULL,
    area_id     TEXT REFERENCES areas(id),
    parent_id   TEXT REFERENCES nodes(id),
    status      TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','done','archived','dropped')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
);

INSERT INTO nodes_new (rowid, id, kind, title, area_id, parent_id, status,
                       created_at, updated_at, archived_at)
     SELECT rowid, id, kind, title, area_id, parent_id, status,
            created_at, updated_at, archived_at
       FROM nodes;

DROP TABLE nodes;
ALTER TABLE nodes_new RENAME TO nodes;

PRAGMA legacy_alter_table = OFF;

-- O DROP levou junto os índices e os gatilhos que moravam em `nodes`. Os
-- gatilhos que moram em `note_details`/`node_tags` sobreviveram — eles só
-- *falam* de nodes, não pertencem a ela.
CREATE INDEX idx_nodes_kind_status ON nodes(kind, status);
CREATE INDEX idx_nodes_area   ON nodes(area_id)   WHERE area_id   IS NOT NULL;
CREATE INDEX idx_nodes_parent ON nodes(parent_id) WHERE parent_id IS NOT NULL;

-- Recriados EXATAMENTE como no 0002. Divergir aqui seria um índice de busca que
-- se comporta diferente conforme a idade do banco do usuário.
CREATE TRIGGER nodes_fts_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO search_index(rowid, title, body, tags)
    VALUES (new.rowid, new.title, '', '');
END;

CREATE TRIGGER nodes_fts_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM search_index WHERE rowid = old.rowid;
END;

CREATE TRIGGER nodes_fts_au AFTER UPDATE OF title ON nodes BEGIN
    DELETE FROM search_index WHERE rowid = old.rowid;
    INSERT INTO search_index(rowid, title, body, tags)
    SELECT new.rowid,
           new.title,
           COALESCE((SELECT body_md FROM note_details WHERE node_id = new.id), ''),
           COALESCE((SELECT group_concat(t.name, ' ')
                       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.node_id = new.id), '');
END;

-- =====================================================================
-- 2. Eventos: categoria e a âncora da recorrência
-- =====================================================================

-- Exames e consultas (§3.1) são eventos de calendário com categoria. Não uma
-- tabela `exams`: um exame É um compromisso com hora e lugar, e a única coisa
-- que o distingue de um almoço é o rótulo. Uma tabela separada duplicaria o
-- calendário inteiro para carregar uma palavra.
ALTER TABLE event_details ADD COLUMN category TEXT;

CREATE INDEX idx_event_category ON event_details(category)
    WHERE category IS NOT NULL;

-- =====================================================================
-- 3. As recorrências, materializadas
-- =====================================================================
--
-- "Toda terça às 19h" pode ser guardado de dois jeitos: uma RRULE e expandir na
-- leitura, ou expandir uma vez e guardar as ocorrências. O NEXUS materializa.
--
-- O motivo é o mês do calendário: com RRULE, desenhar novembro/2027 exige
-- expandir TODA regra do banco desde o começo dos tempos até novembro/2027, a
-- cada troca de mês. Com ocorrências materializadas, é um range scan por
-- `starts_at` — o custo depende do mês pedido, não de quantas regras existem
-- nem de há quanto tempo elas existem.
--
-- O preço é a janela: materializamos 18 meses à frente da âncora (§7 do plano).
-- Além disso a série simplesmente não existe — navegar para o mês 19 mostra um
-- mês vazio, não uma projeção.
--
-- Estender a janela conforme o usuário navega para perto da borda é o passo que
-- fecha isso, e ele NÃO existe ainda. Ele não pode morar na leitura do
-- calendário (seria uma escrita durante um read, no pool que é `query_only`);
-- o lugar é um comando explícito que a UI chama ao navegar. Ver o backlog.
--
-- `WITHOUT ROWID`: a PK é (event_id, starts_at) e a tabela vira uma B-tree
-- clusterizada por ela. "As ocorrências deste evento" é um range scan
-- sequencial, e é assim que apagar/reescrever uma série inteira sai barato.
CREATE TABLE event_occurrences (
    -- O evento-mãe, dono da regra. Não tem FK para `nodes` de propósito: a
    -- coluna aponta para `event_details.node_id`, e é o CASCADE de lá que
    -- limpa daqui.
    event_id   TEXT NOT NULL REFERENCES event_details(node_id) ON DELETE CASCADE,
    starts_at  INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL,
    -- 'YYYY-MM-DD' local, redundante com `starts_at` de propósito: a pergunta
    -- do calendário é "o que cai no dia X", e comparar texto de dia local é
    -- exato. Derivar o dia de um epoch em SQL exigiria `datetime(...,
    -- 'localtime')`, que não usa índice e depende do fuso do processo.
    day        TEXT NOT NULL,
    -- Uma ocorrência solta da série: remarcada ou cancelada.
    -- NULL = segue a regra. É o que permite "toda terça, MENOS a de 25/11".
    status     TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled','cancelled','moved')),
    PRIMARY KEY (event_id, starts_at)
) WITHOUT ROWID;

-- A leitura do calendário: "tudo que cai entre A e B", sem olhar de quem é.
CREATE INDEX idx_occurrence_day   ON event_occurrences(day);
CREATE INDEX idx_occurrence_range ON event_occurrences(starts_at, ends_at);

-- =====================================================================
-- 4. Sub-desafios (§4 do plano)
-- =====================================================================
--
-- O node já carrega quase tudo que um sub-desafio precisa: título, `parent_id`
-- (a meta), e `status = 'done'` — que É o checkbox. O satélite só guarda o que
-- sobra.
CREATE TABLE milestone_details (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    -- 'simple'  = um checkbox e pronto.
    -- 'counter' = "21/30 dias", que se preenche sozinho a partir de um hábito.
    kind         TEXT NOT NULL DEFAULT 'simple'
                  CHECK (kind IN ('simple','counter')),
    -- O hábito que alimenta o contador. Sem ele, 'counter' seria um número que
    -- o usuário teria que atualizar à mão — exatamente o trabalho que os ticks
    -- já fazem.
    habit_id     TEXT REFERENCES nodes(id),
    target_count INTEGER,
    -- Peso na média da meta. REAL e não INTEGER porque o usuário pensa em
    -- "este vale o dobro", e dobro de 1 pode virar 0,5 do outro lado.
    weight       REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
    sort_order   REAL NOT NULL DEFAULT 0
);

CREATE INDEX idx_milestone_habit ON milestone_details(habit_id)
    WHERE habit_id IS NOT NULL;

-- =====================================================================
-- 5. A meta escolhe qual barra manda (§4)
-- =====================================================================
--
-- Uma meta quantitativa ("perder 10 kg") tem duas medidas possíveis de
-- progresso: a métrica (o peso de hoje) e os sub-desafios concluídos. Elas
-- discordam o tempo todo, e adivinhar qual mostrar seria o app decidindo por um
-- número que é do usuário.
ALTER TABLE goal_details ADD COLUMN progress_source TEXT NOT NULL DEFAULT 'metric'
    CHECK (progress_source IN ('metric','milestones'));
