-- =====================================================================
-- 0015 — Modo Foco: as sessões de foco (M5 — um LOG, não um node)
-- =====================================================================
--
-- Um pomodoro concluído vira uma linha aqui: "foquei 25 min na tarefa X". Como
-- `study_sessions` (0013) e `contributions` (0010), é um fato de alta frequência
-- que não merece ser node — sem tela própria, sem busca. Registrá-la grava estado
-- E o evento `focus_session_logged` no ledger, na mesma transação (ADR-0027/0047).
--
-- Só um bloco COMPLETO chega aqui: abandonar o timer no meio não loga nada nem
-- rende XP (o guard que impede o farm e casa com a semântica do pomodoro). Ver o
-- ADR do Modo Foco.
--
-- A ligação com a tarefa é opcional e `ON DELETE SET NULL`: o foco aconteceu;
-- apagar a tarefa não apaga os minutos focados, só desliga o vínculo. Uma sessão
-- sem tarefa guarda um rótulo livre ("Ler documentação", "Escrever").
CREATE TABLE focus_sessions (
    id      TEXT PRIMARY KEY,                                  -- UUIDv7
    task_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,      -- a tarefa focada (node 'task')
    label   TEXT,                                              -- rótulo livre quando não há tarefa
    minutes INTEGER NOT NULL CHECK (minutes > 0),              -- o bloco concluído (abandonado não loga)
    day     TEXT NOT NULL,                                     -- 'YYYY-MM-DD' local
    ts      INTEGER NOT NULL
);

-- "Quanto foquei esta semana" é um range scan por dia; o índice parcial por
-- tarefa serve ao filtro de Esfera (a tarefa carrega o area_id) sem pesar as
-- sessões de foco livre, que não têm tarefa.
CREATE INDEX idx_focus_session_day  ON focus_sessions(day);
CREATE INDEX idx_focus_session_task ON focus_sessions(task_id) WHERE task_id IS NOT NULL;
