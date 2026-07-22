/**
 * A resolução da MARCA de uma conta: qual logo, qual cor, qual monograma.
 *
 * Mora fora de `assets/banks.tsx` de propósito. Aquele arquivo é GERADO (são ~14
 * KB de coordenadas escritas por script); este é escrito à mão e tem a política.
 * Se os dois morassem juntos, regerar as marcas apagaria as regras.
 *
 * A regra que importa está no ADR-0085: **a chave é o `accounts.id`, nunca o
 * `accounts.name`**. O nome pertence ao usuário — ele pode chamar a conta do
 * Nubank de "conta principal" — e a marca tem que continuar lá depois disso.
 */

import { BANK_GLYPHS, type BankGlyph } from "./assets/banks";

export interface BankBrand {
  color: string;
  /** O monograma de quando não há logo. */
  short: string;
  /**
   * O nome da INSTITUIÇÃO — não o nome que o usuário deu à conta.
   *
   * Existe pela mesma razão que o resto do mapa: quem só tem o `accountId` (a
   * Timeline lê o ledger, e o ledger guarda o id, nunca o nome) precisa de um
   * texto para mostrar, e o monograma "Nu" é um desenho, não uma palavra.
   * Presente só nas contas semeadas, cujo id é estável para sempre.
   */
  name?: string;
  /** Ausente = sem logo; quem desenha cai no monograma. */
  glyph?: BankGlyph;
}

/**
 * As seis contas semeadas pela migration 0005, pelo id.
 *
 * As cores são as MESMAS da 0005 (`accounts.color`): este mapa espelha o banco,
 * não inventa paleta. O BTG aparece duas vezes porque são duas contas distintas
 * (a corrente e a corretora) que compartilham a marca e se separam pela cor —
 * exatamente como a 0005 já as separava.
 */
export const BANK_BY_ID: Record<string, BankBrand> = {
  "acct-santander": {
    color: "#EC0000",
    short: "St",
    name: "Santander",
    glyph: BANK_GLYPHS.santander,
  },
  "acct-bradesco": {
    color: "#CC092F",
    short: "Bra",
    name: "Bradesco",
    glyph: BANK_GLYPHS.bradesco,
  },
  "acct-nubank": {
    color: "#820AD1",
    short: "Nu",
    name: "Nubank",
    glyph: BANK_GLYPHS.nubank,
  },
  "acct-itau": { color: "#EC7000", short: "Itaú", name: "Itaú", glyph: BANK_GLYPHS.itau },
  "acct-btg": { color: "#0B1B3F", short: "BTG", name: "BTG", glyph: BANK_GLYPHS.btg },
  "acct-btg-invest": {
    color: "#1E4FD8",
    short: "BTG",
    name: "BTG investimentos",
    glyph: BANK_GLYPHS.btg,
  },
};

/**
 * O nome da instituição de um `accounts.id` semeado, ou `null`.
 *
 * `null` para conta criada pelo usuário é a resposta CERTA, não uma falha: o
 * ledger guarda o id e mais nada, e inventar um nome a partir dele seria pior
 * que omiti-lo. Quem chama decide o que fazer com a ausência.
 */
export function bankName(accountId: string | null | undefined): string | null {
  return (accountId && BANK_BY_ID[accountId]?.name) || null;
}

/**
 * O degrau do meio: uma conta que o USUÁRIO criou e cujo nome cita um banco
 * conhecido. Não sobrevive a renomear — e não tem como sobreviver, porque o
 * nome é o único sinal que existe numa conta sem id semeado.
 */
export const BANK_BRANDS: Record<string, BankBrand> = {
  nubank: BANK_BY_ID["acct-nubank"],
  btg: BANK_BY_ID["acct-btg"],
  santander: BANK_BY_ID["acct-santander"],
  itau: BANK_BY_ID["acct-itau"],
  bradesco: BANK_BY_ID["acct-bradesco"],
  // Sem logo: cai no monograma, e é esse caminho que prova que nada quebra por
  // falta de desenho.
  inter: { color: "#FF7A00", short: "Int" },
};

/**
 * Resolve a marca em três degraus: id semeado → nome livre → monograma.
 *
 * O id vem primeiro, e é isso que faz renomear a conta não apagar a logo.
 * O último degrau nunca falha: pior caso, duas letras sobre o fósforo.
 */
export function bankBrand(name: string, id?: string): BankBrand {
  if (id && BANK_BY_ID[id]) return BANK_BY_ID[id];

  const key = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  for (const k of Object.keys(BANK_BRANDS)) {
    if (key.includes(k)) return BANK_BRANDS[k];
  }

  const short = name.trim().slice(0, 2).toUpperCase() || "•";
  return { color: "var(--accent)", short };
}
