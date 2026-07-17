-- 0006_career_magenta.sql — a Carreira deixa de ser violeta
--
-- IMMUTABLE ONCE COMMITTED.
--
-- O violeta `#A78BFA` semeado na 0005 ficava a ΔE 2,5 do azul das Finanças sob
-- protanopia e a ΔE 11 em visão NORMAL — indistinguíveis por cor sozinha, mesmo
-- para quem enxerga todas. O magenta `#EC4899` abre distância de matiz das duas
-- vizinhas (Finanças azul e Estudos ciano) e faz a separação CVD passar: o pior
-- par da paleta sobe para ΔE 10,6. Ver ADR-0017 e ADR-0019.
--
-- A 0005 é imutável: cor errada semeada ontem não se conserta editando o
-- passado, conserta-se com a migration de hoje.
--
-- ===== A guarda importa mais que o UPDATE =====
--
-- `AND color = '#A78BFA'` existe para NÃO pisar em quem já trocou a cor da
-- própria Esfera Carreira. O banco é a verdade sobre `areas.color`; o token é
-- só o padrão de fábrica. Um UPDATE incondicional aqui reverteria uma escolha
-- deliberada do usuário durante uma migration — silenciosamente, e sem desfazer.
-- Só a linha que ainda está exatamente como a 0005 a deixou é atualizada.
UPDATE areas
   SET color = '#EC4899'
 WHERE id = 'sphere-career'
   AND color = '#A78BFA';
