-- =====================================================================
-- 0017 — O MOTOR DE METAS (v1.3 COCKPIT, fase 3)
-- =====================================================================
--
-- Uma migration só para o que as fases 3, 4, 5 e 6 pedem de schema. O
-- levantamento em batch está no ADR-0077, e o RESULTADO dele é o que dita esta
-- migration:
--
--   *** NENHUM `kind` NOVO. NENHUM `link_type` NOVO. ***
--
-- Os 16 kinds e os 5 link_type vigentes cobrem tudo: a meta de constância é uma
-- `goal`, o sub-desafio é um `milestone`, o curso/idioma/faculdade é um
-- `subject` (trilha da 0016), o tema de matéria é uma `task` filha, a prova e a
-- entrega são `event`. Logo **`nodes` NÃO é recriada aqui**, e as três
-- armadilhas do 12-step (CASCADE, rowid do FTS, rename dos gatilhos) não se
-- aplicam a nada neste arquivo. Isto está escrito para o próximo leitor não
-- recriar `nodes` por reflexo.
--
-- Dois achados do levantamento evitaram trabalho e merecem registro:
--   * `event_details.category` é TEXT LIVRE (sem CHECK) desde a 0007 — provas e
--     entregas entram como categoria nova sem tocar no banco;
--   * `accounts.color` existe desde a 0005 com as cores dos seis bancos — o
--     BankTile lê a cor do BANCO, não de um mapa no frontend.


-- =====================================================================
-- 1. A meta ganha o quarto tipo: CONSTÂNCIA (fase 3)
-- =====================================================================
--
-- Os três tipos da 0016 (quantitative/binary/staged) não representam
-- "guardar R$ 10 por dia" nem "30 dias sem fritura": os dois são sobre marcar
-- TODO DIA, acumular e projetar — não sobre um valor que caminha de A para B,
-- nem sobre um acontecimento binário, nem sobre uma escada de degraus.
--
-- A DECISÃO DE DESENHO (ADR-0077): uma meta de constância **é um hábito por
-- baixo**. `habit_ticks` já é exatamente a série que ela precisa — PK
-- (habit_id, day) WITHOUT ROWID, `status` e `value REAL` —, e `domain::streak`,
-- o heatmap anual e a query `habits_today` já sabem lê-la. Criar uma
-- `goal_daily_marks` duplicaria a série mais consultada do BI e obrigaria a
-- reimplementar sequência, heatmap, XP e a presença nos Checkpoints do dia.
-- Então a meta guarda QUAL hábito a alimenta, e o progresso é derivado dos ticks.
--
-- A reconstrução é BARATA, exatamente como a da 0016:
--   * nenhum gatilho de FTS fala de `goal_details` (o rename não explode);
--   * nada indexa o rowid dela (o vínculo do FTS é com `nodes`);
--   * quem a referencia é `goal_checkpoints(goal_id) -> goal_details(node_id)`,
--     e as mesmas linhas voltam com as mesmas PKs. As FKs estão desligadas pelo
--     runner durante a migration, e o `foreign_key_check` roda depois sobre o
--     banco inteiro.

CREATE TABLE goal_details_new (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,

    -- O TIPO, agora com quatro valores. Default 'quantitative': é o que toda
    -- linha anterior a esta migration é.
    goal_kind    TEXT NOT NULL DEFAULT 'quantitative'
                 CHECK (goal_kind IN ('quantitative','binary','staged','constancia')),

    -- Os cinco campos da métrica. A constância usa TRÊS deles (alvo, unidade e
    -- direção), e não usa `start_value` — uma constância começa em zero por
    -- definição: ninguém "já vinha guardando R$ 10 por dia" antes de criar a
    -- meta. `metric_name` também não: o nome da métrica de uma constância É o
    -- título dela ("guardar R$ 10 por dia").
    metric_name  TEXT,
    start_value  REAL,
    target_value REAL,
    unit         TEXT,
    direction    TEXT CHECK (direction IS NULL OR direction IN ('increase','decrease')),

    deadline     INTEGER,

    progress_source TEXT NOT NULL DEFAULT 'metric'
                 CHECK (progress_source IN ('metric','milestones')),

    -- O hábito que alimenta a constância. NULL em todo outro tipo. Sem FK
    -- CASCADE de propósito: apagar o hábito não pode apagar a META (o histórico
    -- de progresso dela continua valendo) — a tela trata `habit_id` órfão como
    -- "constância sem hábito ligado" e oferece religar, do mesmo jeito que
    -- `milestone_details.habit_id` já fazia desde a 0007.
    habit_id     TEXT REFERENCES nodes(id),

    -- O alvo POR DIA: o "R$ 10" de "guardar R$ 10 por dia". NULL quando a
    -- constância é binária ("30 dias sem fritura" — o que conta é ter marcado o
    -- dia, não quanto). Positivo quando existe: um alvo diário de zero ou
    -- negativo é uma meta que nunca sai do lugar ou que anda para trás sozinha.
    daily_target REAL CHECK (daily_target IS NULL OR daily_target > 0),

    -- A invariante por tipo. Quantitativa PRECISA dos cinco campos; conquista e
    -- escada não podem fingir métrica; a CONSTÂNCIA fica no meio: exige alvo,
    -- unidade e direção, e proíbe os dois que não fazem sentido nela.
    CHECK (
        (goal_kind = 'quantitative'
             AND metric_name  IS NOT NULL
             AND start_value  IS NOT NULL
             AND target_value IS NOT NULL
             AND unit         IS NOT NULL
             AND direction    IS NOT NULL)
        OR
        (goal_kind IN ('binary','staged')
             AND metric_name  IS NULL
             AND start_value  IS NULL
             AND target_value IS NULL
             AND unit         IS NULL
             AND direction    IS NULL)
        OR
        (goal_kind = 'constancia'
             AND metric_name  IS NULL
             AND start_value  IS NULL
             AND target_value IS NOT NULL
             AND unit         IS NOT NULL
             AND direction    IS NOT NULL)
    ),

    -- Só quem tem métrica pode medir progresso PELA métrica. A constância tem
    -- alvo, então ela também pode — o que ela não pode é ser medida por degraus
    -- que ela não tem. Uma binária/escada segue obrigada a 'milestones'.
    CHECK (goal_kind IN ('quantitative','constancia') OR progress_source = 'milestones'),

    -- `habit_id` e `daily_target` são exclusivos da constância. Sem isto, uma
    -- meta quantitativa com `daily_target` seria um número que nenhuma tela lê.
    CHECK (goal_kind = 'constancia' OR (habit_id IS NULL AND daily_target IS NULL))
);

INSERT INTO goal_details_new
    (node_id, goal_kind, metric_name, start_value, target_value, unit,
     direction, deadline, progress_source)
SELECT
    node_id, goal_kind, metric_name, start_value, target_value, unit,
    direction, deadline, progress_source
FROM goal_details;

DROP TABLE goal_details;
ALTER TABLE goal_details_new RENAME TO goal_details;

-- A tela de uma constância pergunta "qual meta este hábito alimenta?" ao marcar
-- o tick. Índice parcial: só as constâncias têm `habit_id`, e as outras não
-- pagam por linhas que nunca casam.
CREATE INDEX idx_goal_habit ON goal_details(habit_id) WHERE habit_id IS NOT NULL;


-- =====================================================================
-- 2. Estudos: o curso diz o que ensina (fase 4)
-- =====================================================================
--
-- "nome + texto curto do que ensina + checklist de conteúdos". O checklist são
-- `task` filhas da matéria (nada a fazer no schema); o texto curto não tinha
-- onde morar. Não é `category` (livre e do usuário, ADR-0072) nem uma nota
-- linkada (uma frase de duas linhas não merece um node e um link).
--
-- Vale para qualquer trilha, não só curso: um idioma ou uma matéria de
-- faculdade também podem ter uma linha dizendo do que se trata.
ALTER TABLE subject_details ADD COLUMN summary TEXT;


-- =====================================================================
-- 3. Faculdade: a observação de uma entrega (fase 4)
-- =====================================================================
--
-- Provas e entregas são EVENTOS (`event_details.category`, que é texto livre —
-- ver o cabeçalho). O que faltava era onde escrever "trazer calculadora" ou
-- "entregar impresso, fonte 12". `location` existe mas é outra coisa, e
-- sobrecarregá-la faria o calendário mostrar a observação como se fosse o lugar.
ALTER TABLE event_details ADD COLUMN notes TEXT;
