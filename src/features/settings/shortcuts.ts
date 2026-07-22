/**
 * O catálogo de atalhos — a fonte única da seção "Atalhos" das Configurações.
 *
 * A parte de navegação (`G+<tecla>`) sai de `JUMP_TARGETS` (a mesma lista que o
 * `useKeyboard` obedece), então a tela nunca mente sobre um atalho: se um destino
 * some da navegação, some daqui também. O resto é fixo e vive no shell.
 */

import { JUMP_TARGETS } from "../../app/navigation";

export interface Shortcut {
  keys: string[];
  label: string;
  group: string;
}

export function allShortcuts(): Shortcut[] {
  const global: Shortcut[] = [
    { keys: ["Ctrl", "K"], label: "Paleta de comandos (buscar e executar)", group: "Global" },
    {
      keys: ["Ctrl", "Shift", "N"],
      label: "Captura rápida para o Inbox (funciona com o app em segundo plano)",
      group: "Global",
    },
    // Existe desde o M5.5 (`App.tsx`) e faltava nesta lista — numa tela cuja
    // única função é ser o catálogo completo, um atalho ausente é a tela
    // afirmando que ele não existe.
    { keys: ["Ctrl", "L"], label: "Bloquear a tela agora", group: "Global" },
  ];

  // A navegação vem da fonte única — o mesmo array que o teclado do shell lê.
  const nav: Shortcut[] = JUMP_TARGETS.map((t) => ({
    keys: ["G", t.jumpKey.toUpperCase()],
    label: `Ir para ${t.label}`,
    group: "Navegação (G, depois a tecla)",
  }));

  const sphere: Shortcut[] = [
    { keys: ["1", "…", "9"], label: "Pular direto para uma seção da Esfera", group: "Dentro de uma Esfera" },
    { keys: ["←", "→"], label: "Mover entre as seções", group: "Dentro de uma Esfera" },
    { keys: ["Home", "End"], label: "Primeira / última seção", group: "Dentro de uma Esfera" },
  ];

  /* A triagem do Inbox é o ritual de teclado mais específico do app e não
     estava aqui: quem procurasse "descartar" nesta tela concluiria que não há
     tecla para isso. A régua do rodapé do Inbox mostra as mesmas teclas — mas
     ela só existe DENTRO do Inbox, e o catálogo existe para responder de fora. */
  const inbox: Shortcut[] = [
    { keys: ["T"], label: "Triar como tarefa", group: "No Inbox" },
    { keys: ["H"], label: "Triar como nota", group: "No Inbox" },
    { keys: ["P"], label: "Triar como projeto", group: "No Inbox" },
    { keys: ["⌫"], label: "Descartar o item", group: "No Inbox" },
    { keys: ["↑", "↓"], label: "Navegar pela fila", group: "No Inbox" },
    { keys: ["1", "…", "9"], label: "Escolher a Esfera de destino (opcional)", group: "No Inbox" },
    { keys: ["0"], label: "Desfazer a escolha de Esfera", group: "No Inbox" },
  ];

  const edit: Shortcut[] = [
    { keys: ["Enter"], label: "Salvar (modais e campos rápidos)", group: "Edição" },
    { keys: ["Esc"], label: "Fechar modal ou paleta", group: "Edição" },
  ];

  return [...global, ...nav, ...sphere, ...inbox, ...edit];
}
