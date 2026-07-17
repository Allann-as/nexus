-- 0005_spheres.sql — as Esferas da Vida
--
-- IMMUTABLE ONCE COMMITTED.
--
-- Uma Esfera é uma `areas`. Não uma tabela nova, não um conceito paralelo: a
-- mesma linha que já organizava nodes desde o 0001. O que muda é a UI (o Hub) e
-- duas colunas que ela precisava para existir:
--
--   * `template` — QUE tela a Esfera abre. Saúde mostra checkpoints do dia,
--     Finanças mostra aportes, 'simple' mostra agenda e checklists. Sem isto o
--     Hub teria de adivinhar pelo nome, e renomear "Saúde" para "Corpo"
--     apagaria a tela inteira.
--   * `is_system` — as 5 Esferas que o NEXUS instala. Não impede editar nem
--     arquivar (a vida do usuário é dele); só evita que o wizard "+ Nova
--     Esfera" ofereça criar uma segunda "Saúde" e que o seed rode duas vezes.
--
-- Por que o CHECK de `template` cabe num ADD COLUMN: o SQLite proíbe
-- PRIMARY KEY, UNIQUE e GENERATED em ALTER TABLE ADD COLUMN, mas CHECK é
-- permitido. Ele passa a valer para toda escrita futura — que é exatamente o
-- ponto.

ALTER TABLE areas ADD COLUMN template TEXT NOT NULL DEFAULT 'simple'
    CHECK (template IN ('health','finance','fin_goals','career','studies','simple'));

ALTER TABLE areas ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0
    CHECK (is_system IN (0,1));

-- ===== As 5 Esferas padrão =====
--
-- Ids fixos e legíveis, não UUIDv7. A convenção do 0001 vale para o que o
-- usuário cria em runtime (onde a ordenação temporal do UUIDv7 mantém os
-- inserts no fim da B-tree). Estas 5 linhas nascem com o schema, são seis no
-- total para sempre, e um id estável significa que este arquivo é o único
-- lugar onde elas são declaradas — o Rust não precisa de um segundo seed que
-- possa divergir dele. Ver docs/DECISIONS.md (ADR-0005).
--
-- `INSERT OR IGNORE` porque a migration é o seed: rodar num banco que já tem
-- estas linhas (impossível hoje, possível num restore parcial amanhã) não pode
-- explodir.
--
-- As cores espelham os tokens --sphere-* do design system Midnight. Elas vivem
-- em dois lugares de propósito: a UI precisa delas em CSS antes de qualquer
-- IPC, e o banco precisa delas para a Esfera continuar tingida se o usuário
-- trocar a cor. O banco é a verdade; o token é o padrão de fábrica.
INSERT OR IGNORE INTO areas (id, name, icon, color, sort_order, template, is_system) VALUES
    ('sphere-health',    'Saúde',                 'heart-pulse',    '#34D399', 0, 'health',    1),
    ('sphere-finance',   'Finanças',              'wallet',         '#4D8DFF', 1, 'finance',   1),
    ('sphere-fin-goals', 'Objetivos Financeiros', 'target',         '#FBBF24', 2, 'fin_goals', 1),
    ('sphere-career',    'Carreira',              'briefcase',      '#A78BFA', 3, 'career',    1),
    ('sphere-studies',   'Estudos',               'graduation-cap', '#38BDF8', 4, 'studies',   1);

-- ===== Um caminho de acesso novo: o Hub =====
--
-- A PK de `habit_ticks` é (habit_id, day), o que torna "todos os ticks do
-- hábito X no ano" um range scan sequencial — a pergunta que o heatmap faz.
--
-- O Hub faz a pergunta transposta: "os ticks de TODOS os hábitos nos últimos 30
-- dias", para desenhar o sparkline de cada Esfera. Nessa ordem a PK não serve
-- de nada, e sem índice o SQLite varreria a tabela inteira — que cresce para
-- sempre — na tela mais aberta do app. Este índice troca alguns KB por manter o
-- Hub ligado ao TAMANHO DA JANELA e não ao tamanho da história.
CREATE INDEX idx_ticks_day ON habit_ticks(day);

-- ===== Contas e bancos =====
--
-- Chega antes dos aportes (M3.5) porque a Esfera Finanças precisa listar os
-- bancos do usuário desde o primeiro boot, e porque `contributions` vai
-- referenciar esta tabela: criá-la agora é criar o alvo da FK antes da FK.
--
-- Sem `created_at`: uma conta não é um acontecimento, é uma gaveta. O ledger
-- conta o que você fez (o aporte), não onde você guardou.
CREATE TABLE accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    -- 'banking' = conta corrente de onde o dinheiro sai.
    -- 'investment' = corretora onde o patrimônio mora.
    -- A distinção importa porque o gráfico de alocação só soma 'investment':
    -- dinheiro parado no Nubank não é patrimônio investido.
    kind        TEXT NOT NULL CHECK (kind IN ('banking','investment')),
    color       TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER
);

INSERT OR IGNORE INTO accounts (id, name, kind, color, sort_order) VALUES
    ('acct-santander',  'Santander',        'banking',    '#EC0000', 0),
    ('acct-bradesco',   'Bradesco',         'banking',    '#CC092F', 1),
    ('acct-nubank',     'Nubank',           'banking',    '#820AD1', 2),
    ('acct-itau',       'Itaú',             'banking',    '#EC7000', 3),
    ('acct-btg',        'BTG Banking',      'banking',    '#0B1B3F', 4),
    ('acct-btg-invest', 'BTG Investimentos','investment', '#1E4FD8', 5);
