-- 0020_subject_items.sql — v1.3 "COCKPIT", fase 4: as lacunas de Estudos
--
-- IMMUTABLE ONCE COMMITTED.
--
-- O ADR-0091 deixou TRÊS lacunas para pagar em batch. O levantamento antes de
-- escrever (regra dos ADR-0029/0036/0077) derrubou DUAS delas — nenhuma precisa
-- de SQL, e descobrir isso custou uma leitura em vez de uma migration:
--
--   * "o texto curto do que um curso ensina" — `subject_details.summary` JÁ
--     EXISTE, criada por ALTER na 0017 e preservada na reconstrução da 0019. A
--     coluna estava viva e MORTA ao mesmo tempo: nenhum SELECT a lia, nenhum
--     setter a escrevia. A lacuna era de código, não de schema.
--   * "entregas e provas da Faculdade com D-dias" — `event_details.category` é
--     TEXT LIVRE desde a 0007, e `upcoming_by_category`/`past_by_category` já
--     servem os Exames da Saúde. Entrega e prova são categorias novas de um
--     mecanismo pronto. Escrever tabela para isso seria duplicar o Calendário.
--
-- Sobra UMA lacuna real, e ela aparece DUAS vezes com a mesma forma:
--
--   * Matérias: "temas de dificuldade como subtarefas" (Matemática -> regra de 3,
--     divisão, Bháskara).
--   * Cursos: a checklist de conteúdos do curso.
--
-- Uma lista ordenada de itens nomeados sob uma matéria, cada um feito ou não. É a
-- MESMA forma, então é UMA tabela — modelar duas seria deixar duas telas
-- divergirem sobre o que é "um item de uma matéria".
--
-- POR QUE UMA TABELA, e não os genéricos que já existem. Os dois candidatos estão
-- fechados na camada de USE-CASE, não por convenção:
--   * `TaskService::create` recusa um `project_id` que não seja `Kind::Project`;
--   * `GoalService::add_milestone` exige `Kind::Goal`.
-- Abrir qualquer um dos dois para aceitar `subject` como pai significaria afrouxar
-- uma guarda que protege OUTRAS telas (o Kanban de projetos, a régua de uma meta)
-- para servir esta. Uma tabela própria não mexe em nada que já funciona.
--
-- POR QUE NÃO É UM NODE (e portanto `nodes` NÃO é recriada — nenhuma das três
-- armadilhas do 12-step se aplica aqui). Um tema não tem tela própria, não entra
-- na busca e não tem Esfera: ele só existe DENTRO da matéria, como
-- `goal_checkpoints` só existe dentro da meta. Node é o que o usuário abre; isto
-- é o que ele risca.

CREATE TABLE subject_items (
    id         TEXT PRIMARY KEY,                                  -- UUIDv7
    -- O dono. CASCADE aqui NÃO contradiz o ADR-0081 (que proíbe CASCADE entre
    -- nodes, porque apagaria filhos sem evento no ledger): um item não é node e
    -- nunca teve evento próprio para perder. Apagar a matéria leva os temas dela,
    -- e o que fica na história é o `deleted` da matéria, que é o fato real.
    subject_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    -- O risco na lista. `nodes.status` seria o checkbox se isto fosse node — como
    -- não é, a coluna é própria e binária. Um terceiro estado ("fazendo") foi
    -- recusado: a leitura da lista é "N de M feitos", e um meio-termo tornaria
    -- essa fração indefinida — 'fazendo' conta metade? O ADR-0092 registra.
    done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
    -- A ordem é do USUÁRIO (a ordem em que ele quer atacar os temas), não
    -- alfabética. REAL como `task_details.sort_order` (0004) e
    -- `milestone_details.sort_order` (0007): inserir no meio não renumera a lista.
    sort_order REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- A leitura é sempre "os itens desta matéria, na ordem" — as duas colunas na
-- ordem em que a query as usa, então o índice serve o WHERE e o ORDER BY juntos.
CREATE INDEX idx_subject_item_subject ON subject_items(subject_id, sort_order);
