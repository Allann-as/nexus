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

/**
 * O formato de CONSTÂNCIA de uma Esfera (v1.3, fase 3b).
 *
 * Uma constância tem duas leituras possíveis, e cada Esfera prefere uma:
 *
 *   * **acumular um valor** — "guardar R$ 10 por dia até R$ 3.650". Tem
 *     `dailyTarget`, e a unidade é a coisa acumulada (R$, páginas, minutos).
 *   * **contar dias** — "30 dias sem fritura". Não tem `dailyTarget`: o que se
 *     conta é ter marcado o dia, e a unidade É "dias".
 *
 * Oferecer "R$ por dia" em Saúde ou "kg por dia" em Finanças é o mesmo erro que
 * abriu a fase C da v1.2 — por isso isto é catálogo, e não um formulário só.
 */
export type ConstanciaTemplate = {
  /** O exemplo no título. */
  titlePlaceholder: string;
  /** O nome do hábito que vai alimentar a meta — o que aparece nos Checkpoints. */
  habitPlaceholder: string;
  /** A unidade do que se acumula. "dias" quando a Esfera conta dias. */
  unit: string;
  /** O exemplo do alvo POR DIA. Vazio = esta Esfera conta DIAS, não valores. */
  dailyPlaceholder: string;
  /** O exemplo do alvo total. */
  targetPlaceholder: string;
};

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
  /** O formato de constância desta Esfera. */
  constancia: ConstanciaTemplate;
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
  constancia: {
    titlePlaceholder: "30 dias seguidos",
    habitPlaceholder: "O que você vai fazer todo dia",
    unit: "dias",
    dailyPlaceholder: "",
    targetPlaceholder: "30",
  },
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
    /* Saúde conta DIAS: "30 dias sem fritura", "60 dias dormindo 8 h". Um alvo
       diário em kg não existe — ninguém perde 0,2 kg por dia por decisão. */
    constancia: {
      titlePlaceholder: "30 dias sem fritura",
      habitPlaceholder: "Comer sem fritura",
      unit: "dias",
      dailyPlaceholder: "",
      targetPlaceholder: "30",
    },
  },

  /* Finanças mede em dinheiro, sempre. A unidade é R$ e ponto — oferecer "kg"
     aqui foi exatamente o sintoma que abriu esta fase. */
  finance: {
    defaultKind: "quantitative",
    titlePlaceholder: "Juntar R$ 20.000 para a reserva",
    metricPlaceholder: "Valor investido",
    units: ["R$"],
    stages: [],
    /* Finanças ACUMULA valor: "guardar R$ 10 por dia". A unidade é R$ e ponto —
       oferecer "kg" aqui foi o sintoma que abriu a fase C da v1.2. */
    constancia: {
      titlePlaceholder: "Guardar R$ 10 por dia",
      habitPlaceholder: "Guardar o dinheiro do dia",
      unit: "R$",
      dailyPlaceholder: "10",
      targetPlaceholder: "3650",
    },
  },

  /* Os objetivos financeiros (as caixinhas) têm tela própria com depósito e
     projeção; uma META aqui é o alvo maior por trás delas. Mesmo vocabulário. */
  fin_goals: {
    defaultKind: "quantitative",
    titlePlaceholder: "Dar entrada no apartamento",
    metricPlaceholder: "Valor guardado",
    units: ["R$"],
    stages: [],
    constancia: {
      titlePlaceholder: "Guardar R$ 20 por dia para a entrada",
      habitPlaceholder: "Separar o valor do dia",
      unit: "R$",
      dailyPlaceholder: "20",
      targetPlaceholder: "7300",
    },
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
    /* Carreira acumula ESFORÇO diário rumo a uma conquista: candidaturas
       enviadas, horas de portfólio. Conta unidades, não dias. */
    constancia: {
      titlePlaceholder: "Uma candidatura por dia",
      habitPlaceholder: "Enviar uma candidatura",
      unit: "candidaturas",
      dailyPlaceholder: "1",
      targetPlaceholder: "90",
    },
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
    /* Estudos acumula PÁGINAS ou minutos por dia — a constância que faz um
       idioma sair do lugar é a de todo dia, não a da maratona de domingo. */
    constancia: {
      titlePlaceholder: "20 páginas por dia",
      habitPlaceholder: "Ler 20 páginas",
      unit: "páginas",
      dailyPlaceholder: "20",
      targetPlaceholder: "600",
    },
  },

  simple: GENERIC,
};

/** O template da Esfera, com o genérico como rede. */
export function goalTemplateFor(template: Template | undefined): GoalTemplate {
  return (template && GOAL_TEMPLATES[template]) || GENERIC;
}
