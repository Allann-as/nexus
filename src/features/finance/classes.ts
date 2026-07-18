/**
 * As classes de ativo — rótulo e cor, num lugar só.
 *
 * A cor é uma paleta CATEGÓRICA fixa (não a cor da Esfera): o donut de alocação
 * PRECISA codificar por cor (é o que uma fatia é), e o chip de classe na lista de
 * aportes reusa a mesma cor para o olho ligar a fatia à linha. É a exceção
 * consciente do ADR-0017 — aqui a cor identifica, e vem sempre com o rótulo ao
 * lado, nunca sozinha.
 */

export const CLASS_LABEL: Record<string, string> = {
  renda_fixa: "Renda fixa",
  acoes: "Ações",
  fiis: "FIIs",
  etf_exterior: "ETF exterior",
  cripto: "Cripto",
  reserva: "Reserva",
  outros: "Outros",
};

export const CLASS_COLOURS: Record<string, string> = {
  renda_fixa: "#4D8DFF",
  acoes: "#34D399",
  fiis: "#FBBF24",
  etf_exterior: "#A78BFA",
  cripto: "#FB7185",
  reserva: "#22D3EE",
  outros: "#94A3B8",
};

export const classLabel = (key: string) => CLASS_LABEL[key] ?? key;
export const classColour = (key: string) => CLASS_COLOURS[key] ?? "#94A3B8";
