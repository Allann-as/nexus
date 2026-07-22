/**
 * O nome em português de cada `kind` — num lugar só.
 *
 * O vocabulário do banco é inglês e estável (as strings estão gravadas no banco
 * do usuário para sempre); a tela fala português. A tradução estava escrita
 * DUAS vezes — no Inbox, só com os 16 kinds de node, e na Timeline, com esses
 * mais os 9 fatos que não são node. Duas tabelas do mesmo vocabulário divergem
 * no dia em que só uma ganha a entrada nova, e foi assim que a Timeline passou
 * três versões escrevendo `achievement_unlocked` na tela (ADR-0104).
 *
 * A lista é a UNIÃO: os `Kind` de node e os `LedgerEntityKind` soltos. Quem só
 * lida com nodes usa o mesmo mapa e ignora o resto — um mapa maior não atrapalha
 * quem pergunta menos.
 */

/** Rótulo humano de um `kind` (de node) ou `entity_kind` (do ledger). */
export const KIND_LABEL: Record<string, string> = {
  // Kind — os nodes.
  note: "Nota",
  task: "Tarefa",
  project: "Projeto",
  goal: "Meta",
  habit: "Hábito",
  routine: "Rotina",
  event: "Evento",
  file: "Arquivo",
  inbox_item: "Entrada",
  milestone: "Sub-desafio",
  fin_goal: "Caixinha",
  book: "Livro",
  subject: "Matéria",
  challenge: "Temporada",
  annual_goal: "Meta anual",
  skill: "Competência",
  // LedgerEntityKind — os fatos que não são node (ADR-0027).
  contribution: "Aporte",
  career_milestone: "Marco",
  achievement: "Conquista",
  daily_score: "Score",
  study_session: "Estudo",
  focus_session: "Foco",
  weekly_review: "Revisão",
  personal_record: "Recorde",
  skill_checkin: "Check-in",
};

/**
 * O rótulo, com a chave crua como último recurso.
 *
 * Devolver a chave é melhor que devolver vazio — mas é um sinal de que o mapa
 * ficou para trás, e é exatamente o que `ledgerMeta.test.ts` proíbe de acontecer
 * em silêncio no vocabulário do ledger.
 */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
