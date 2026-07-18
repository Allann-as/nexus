/**
 * O RITMO de uma meta quantitativa ao longo do ano (REFINO R7 / ARSENAL feat. 1).
 *
 * Uma meta de constância — "correr 100 dias em 2026" — não se lê pelo placar
 * `47/100` sozinho: o que importa é se, no ritmo atual, ela fecha. Este cálculo é
 * puro e determinístico: projeta o valor de fim de ano por extrapolação linear do
 * quanto do ano já passou, e diz quanto por mês falta para bater o alvo.
 *
 * Sem IA, sem mágica: `projeção = atual / fração_do_ano_decorrida`. É a mesma
 * régua honesta do resto do NEXUS — a conta aparece, e o usuário confere.
 */

export interface Pace {
  /** Valor projetado no fim do ano, no ritmo atual. */
  projected: number;
  /** A projeção bate (ou passa) o alvo? */
  onTrack: boolean;
  /** Quanto por mês falta somar para fechar no alvo. 0 se já bateu. */
  perMonthNeeded: number;
  /** Meses restantes no ano (fração). */
  monthsLeft: number;
  /** Uma frase pronta para o card, em tom adulto. */
  message: string;
}

/**
 * `yearElapsedRatio` é 0..1 (quanto do ano já passou — vem do `YearOverview`).
 * Devolve `null` quando não há alvo (`target <= 0`) ou é cedo demais para
 * projetar (menos de ~1 semana de ano), porque uma projeção sobre 3 dias mentiria.
 */
export function annualPace(
  current: number,
  target: number,
  yearElapsedRatio: number,
): Pace | null {
  if (target <= 0) return null;
  const e = Math.min(1, Math.max(0, yearElapsedRatio));
  if (e < 0.02) return null; // < ~1 semana: cedo demais para um ritmo honesto

  const projected = current / e;
  const onTrack = projected >= target;
  const monthsLeft = (1 - e) * 12;
  const remaining = Math.max(0, target - current);
  const perMonthNeeded = monthsLeft > 0.1 ? remaining / monthsLeft : remaining;

  const proj = Math.round(projected);
  let message: string;
  if (current >= target) {
    message = `Alvo de ${target} batido.`;
  } else if (e >= 1) {
    message = `O ano fechou em ${current} — abaixo dos ${target}.`;
  } else if (onTrack) {
    message = `No ritmo, você fecha em ~${proj} — na meta de ${target}.`;
  } else {
    const perMonth = Math.ceil(perMonthNeeded * 10) / 10;
    message = `No ritmo atual fecha em ~${proj}. Faltam ~${trimNum(perMonth)}/mês para os ${target}.`;
  }

  return { projected, onTrack, perMonthNeeded, monthsLeft, message };
}

/** "2.0" → "2", "2.5" → "2,5" (pt-BR curto). */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}
