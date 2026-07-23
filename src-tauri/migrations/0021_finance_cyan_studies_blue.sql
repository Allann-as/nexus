-- 0021_finance_cyan_studies_blue.sql — Finanças vira ciano, Estudos vira azul
--
-- IMMUTABLE ONCE COMMITTED.
--
-- A 0005 semeou Finanças = azul `#4D8DFF` e Estudos = ciano `#38BDF8`. O mockup
-- COCKPIT aprovado (fase 10) tem o contrário: Finanças = ciano `#38C6E0` e
-- Estudos = azul `#5B8DEF`. As duas estavam, na prática, TROCADAS de matiz. A
-- 0005 é imutável: cor errada semeada ontem não se conserta editando o passado,
-- conserta-se com a migration de hoje — o mesmo remédio da 0006 (Carreira).
--
-- ===== A guarda importa mais que o UPDATE =====
--
-- `AND color = '<cor de fábrica>'` existe para NÃO pisar em quem já trocou a cor
-- da própria Esfera. O banco é a verdade sobre `areas.color`; o token é só o
-- padrão de fábrica. Um UPDATE incondicional reverteria uma escolha deliberada
-- do usuário durante uma migration — silenciosamente. Só a linha que ainda está
-- exatamente como a 0005 a deixou é atualizada.
UPDATE areas
   SET color = '#38C6E0'
 WHERE id = 'sphere-finance'
   AND color = '#4D8DFF';

UPDATE areas
   SET color = '#5B8DEF'
 WHERE id = 'sphere-studies'
   AND color = '#38BDF8';
