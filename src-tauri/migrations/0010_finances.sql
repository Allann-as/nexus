-- 0010_finances.sql — aportes e o retrato mensal do patrimônio
--
-- IMMUTABLE ONCE COMMITTED.
--
-- A Esfera Finanças do NEXUS é sobre INVESTIR, não sobre gastar (o controle de
-- gastos vive em outro app — §3.2 do plano). Duas tabelas:
--
--   1. `contributions` — cada aporte que o usuário fez.
--   2. `portfolio_snapshots` — o total do patrimônio, informado à mão 1x/mês.
--
-- Os 6 bancos (`accounts`) já existem desde a 0005: esta migration cria só o
-- que aponta para eles.

-- =====================================================================
-- 1. Aportes
-- =====================================================================
--
-- Um aporte é um FATO da vida do usuário ("botei R$ 500 no BTG em renda fixa"),
-- e por isso ele também vira um evento no ledger (no serviço, não aqui) — ao
-- contrário da conta, que é uma gaveta (ver a nota da 0005).
--
-- `amount_cents INTEGER`: dinheiro é SEMPRE centavo inteiro, nunca float. Um
-- `0.1 + 0.2` num extrato é um centavo que some, e um centavo que some num app
-- de patrimônio é um bug que o usuário conta de volta com a calculadora.
--
-- Resgate é aporte NEGATIVO. Não uma tabela separada nem uma coluna de sinal:
-- "tirei R$ 200" é a mesma operação de "botei R$ 500", com o sinal trocado, e a
-- soma acumulada já faz a conta certa. Uma segunda tabela duplicaria toda query
-- de total para carregar um sinal de menos.
CREATE TABLE contributions (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES accounts(id),
    -- A classe do ativo, não o produto. O donut de alocação (§3.2) agrupa por
    -- aqui. Fechado num CHECK porque é o eixo de um gráfico: uma classe digitada
    -- livre viraria uma fatia de um só, e o gráfico deixaria de somar 100%.
    asset_class TEXT NOT NULL CHECK (asset_class IN
                 ('renda_fixa','acoes','fiis','etf_exterior','cripto','reserva','outros')),
    amount_cents INTEGER NOT NULL,
    -- 'YYYY-MM-DD' local, igual a `habit_ticks.day` e `event_occurrences.day`: a
    -- pergunta "quanto aportei em março" é sobre o calendário do usuário, e
    -- comparar texto de dia é exato e usa índice. Derivar o mês de um epoch em
    -- SQL exigiria `strftime(..., 'localtime')`, que não usa índice.
    happened_on TEXT NOT NULL,
    note        TEXT,
    created_at  INTEGER NOT NULL
);

-- "Quanto aportei neste período" e "os meses com aporte" são range scans por
-- data — é o que a regularidade e a série acumulada perguntam.
CREATE INDEX idx_contrib_date ON contributions(happened_on);

-- =====================================================================
-- 2. O retrato do patrimônio
-- =====================================================================
--
-- O NEXUS registra o que o usuário APORTOU, mas o patrimônio também rende (ou
-- cai) sozinho, e isso o app não tem como saber — não há cotação, não há rede
-- (constituição §1). Uma vez por mês o usuário informa o total, e é esse número
-- que o HeroCard mostra como patrimônio real.
--
-- PK = `month` ('YYYY-MM'): um retrato por mês. Informar de novo o mesmo mês
-- corrige o anterior (o `INSERT OR REPLACE` do serviço), em vez de empilhar dois
-- totais para o mesmo mês que o gráfico não saberia desempatar.
--
-- Opcional de propósito: quem só quer registrar aportes nunca precisa abrir
-- isto. O dashboard cai para "total aportado" quando não há retrato.
CREATE TABLE portfolio_snapshots (
    month       TEXT PRIMARY KEY,
    total_cents INTEGER NOT NULL,
    noted_at    INTEGER NOT NULL
);
