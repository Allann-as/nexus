/**
 * O catálogo de metas por Esfera (v1.2, fase C3).
 *
 * O problema que ele resolve: o formulário "Nova meta" era um só para o app
 * inteiro, e era quantitativo. O placeholder "Perder 10 kg" aparecia dentro de
 * Finanças; "Conseguir um emprego" não cabia em lugar nenhum. O dono do app
 * gosta da interface de metas e a quer em todas as seções — *"cada uma com a sua
 * individualidade"*.
 *
 * A individualidade é CONFIGURAÇÃO, não código. Nada aqui é um `if` por Esfera
 * espalhado pelo formulário: cada `template` traz o tipo que faz sentido abrir,
 * os exemplos que se parecem com a vida ali, e as unidades que aquela Esfera
 * mede. O formulário lê este arquivo e nasce contextual. Uma Esfera nova (ou uma
 * mudança de ideia) é uma entrada aqui, não uma alteração de tela.
 *
 * É o mesmo padrão de `features/spheres/sections.ts` (as seções por template) e
 * de `app/navigation.ts` (os destinos globais): um catálogo único, e as telas
 * leem dele. Duas cópias divergem no dia em que só uma é corrigida.
 *
 * O que ele NÃO faz: restringir. O usuário pode escolher qualquer um dos três
 * tipos em qualquer Esfera — a sugestão abre a porta certa, ela não tranca as
 * outras. Uma meta de conquista dentro de Finanças ("quitar o financiamento") é
 * perfeitamente legítima, e o catálogo só decide o que aparece PRIMEIRO.
 */

import type { GoalKind, Template } from "../../lib/ipc";

export type GoalTemplate = {
  /** O tipo que o formulário abre marcado nesta Esfera. */
  defaultKind: GoalKind;
  /** O exemplo no campo de título. Tem de soar como a vida daquela Esfera. */
  titlePlaceholder: string;
  /** O exemplo do nome da métrica (só quantitativa). */
  metricPlaceholder: string;
  /** Unidades oferecidas em um clique. A primeira é a sugerida. */
  units: string[];
  /**
   * Os degraus sugeridos quando o tipo é 'staged'. Vazio = a Esfera não tem uma
   * escada óbvia, e o usuário nomeia os dele do zero.
   */
  stages: string[];
};

/**
 * O fallback. Também é o que a Esfera 'simple' (a criada pelo usuário) recebe:
 * ela não tem domínio conhecido, então não se finge que tem.
 */
const GENERIC: GoalTemplate = {
  defaultKind: "quantitative",
  titlePlaceholder: "O que você quer alcançar",
  metricPlaceholder: "O que você vai medir",
  units: ["unidades", "vezes", "dias", "horas"],
  stages: [],
};

export const GOAL_TEMPLATES: Record<Template, GoalTemplate> = {
  /* Saúde mede o corpo, e mede em número: peso, treinos, sono. É a Esfera onde a
     meta quantitativa é de fato o caso comum — e a única em que "Perder 10 kg"
     nunca foi um placeholder errado. */
  health: {
    defaultKind: "quantitative",
    titlePlaceholder: "Perder 10 kg",
    metricPlaceholder: "Peso",
    units: ["kg", "treinos", "km", "horas", "dias"],
    stages: [],
  },

  /* Finanças mede em dinheiro, sempre. A unidade é R$ e ponto — oferecer "kg"
     aqui foi exatamente o sintoma que abriu esta fase. */
  finance: {
    defaultKind: "quantitative",
    titlePlaceholder: "Juntar R$ 20.000 para a reserva",
    metricPlaceholder: "Valor investido",
    units: ["R$"],
    stages: [],
  },

  /* Os objetivos financeiros (as caixinhas) têm tela própria com depósito e
     projeção; uma META aqui é o alvo maior por trás delas. Mesmo vocabulário. */
  fin_goals: {
    defaultKind: "quantitative",
    titlePlaceholder: "Dar entrada no apartamento",
    metricPlaceholder: "Valor guardado",
    units: ["R$"],
    stages: [],
  },

  /* Carreira é a Esfera das CONQUISTAS: conseguir um emprego, ser promovido,
     fechar um cliente. Nenhuma delas é um número — são coisas que acontecem ou
     não, e o caminho até elas são os degraus. Foi o caso que a v1.1 não sabia
     representar, e por isso Carreira abre em 'binary'. */
  career: {
    defaultKind: "binary",
    titlePlaceholder: "Conseguir um emprego",
    metricPlaceholder: "O que você vai medir",
    units: ["entrevistas", "candidaturas", "projetos", "R$"],
    stages: ["Preparação", "Candidaturas", "Entrevistas", "Proposta aceita"],
  },

  /* Estudos evolui por NÍVEL: básico, intermediário, avançado, fluente. É a
     escada — a razão de o tipo 'staged' existir. Os degraus abaixo são os do
     caso mais comum (um idioma); qualquer trilha se renomeia por cima. */
  studies: {
    defaultKind: "staged",
    titlePlaceholder: "Chegar ao avançado em inglês",
    metricPlaceholder: "Horas estudadas",
    units: ["horas", "aulas", "páginas", "capítulos"],
    stages: ["Básico", "Intermediário", "Avançado", "Fluente"],
  },

  simple: GENERIC,
};

/** O template da Esfera, com o genérico como rede. */
export function goalTemplateFor(template: Template | undefined): GoalTemplate {
  return (template && GOAL_TEMPLATES[template]) || GENERIC;
}
