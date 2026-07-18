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
    { keys: ["Ctrl", "Shift", "N"], label: "Captura rápida para o Inbox", group: "Global" },
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

  const edit: Shortcut[] = [
    { keys: ["Enter"], label: "Salvar (modais e campos rápidos)", group: "Edição" },
    { keys: ["Esc"], label: "Fechar modal ou paleta", group: "Edição" },
  ];

  return [...global, ...nav, ...sphere, ...edit];
}
