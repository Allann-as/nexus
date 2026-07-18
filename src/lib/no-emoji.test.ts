/**
 * A rede de segurança contra emoji na UI (M4.6 §3.2).
 *
 * O redesign Aurora 2.0 baniu emoji da interface — eles quebram a consistência
 * tipográfica premium. Este teste varre `src/` e falha se um emoji reaparecer em
 * qualquer string (ou comentário) de UI, para a dívida não voltar sem ninguém
 * ver. O mesmo espírito do teste do catálogo de conquistas no backend.
 *
 * Ícones vêm do Lucide (por componente ou por nome — ver `DynamicIcon`/`GoalIcon`);
 * as setas tipográficas (→ ← ↑ ↓) e o ⌘ NÃO são emoji e ficam de fora do crivo.
 *
 * Usa `import.meta.glob` (Vite) para ler as fontes como texto — sem depender de
 * `node:fs` nem de `@types/node`, que o projeto não carrega.
 */

import { describe, expect, it } from "vitest";

// Faixas de emoji/pictogramas, escritas como escapes (não como o caractere), então
// este próprio arquivo passa no teste que ele define.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/u;

const sources = import.meta.glob("/src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("Aurora 2.0 — sem emoji na UI", () => {
  it("nenhum arquivo de src/ contém emoji", () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      content.split("\n").forEach((line, i) => {
        if (EMOJI.test(line)) {
          offenders.push(`${path}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    expect(offenders, `emoji encontrado na UI:\n${offenders.join("\n")}`).toEqual([]);
  });
});
