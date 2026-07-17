-- 0004_task_order.sql — ordenação manual de tarefas
--
-- IMMUTABLE ONCE COMMITTED.
--
-- O 0001 não previu ordem manual: tarefas saíam por `created_at`. Mas a ordem
-- de uma lista de projeto é uma decisão do usuário ("faço esta primeiro"), não
-- um acidente de quando ele digitou. Daí o drag reorder — e daí esta coluna.
--
-- REAL e não INTEGER de propósito: arrastar entre duas linhas vira a MÉDIA dos
-- vizinhos (`(prev + next) / 2`), então mover uma tarefa é UM update de UMA
-- linha. Com inteiros seria preciso renumerar todas as linhas seguintes a cada
-- arrasto — O(n) escritas por gesto, e um ledger cheio de ruído.
--
-- A precisão do double aguenta ~50 inserções sucessivas entre o mesmo par antes
-- de saturar; `renumber_project_tasks` (no repositório) reespaça quando o
-- intervalo fica pequeno demais.

ALTER TABLE task_details ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;

-- Ordem inicial = ordem de criação, para as tarefas que já existem.
-- `rowid` de `nodes` é monotônico e reflete a ordem de inserção.
UPDATE task_details
   SET sort_order = COALESCE(
        (SELECT n.rowid FROM nodes n WHERE n.id = task_details.node_id),
        0);

-- A leitura mais comum do módulo Projetos: as tarefas em aberto de um projeto,
-- na ordem do usuário. Índice parcial: tarefas concluídas saem do índice para
-- sempre, então ele não cresce com o histórico.
CREATE INDEX idx_task_order ON task_details(sort_order)
    WHERE completed_at IS NULL;
