/**
 * A COR DA SEÇÃO ATIVA — a tinta da "borda infinita" (fase 9 §4).
 *
 * Numa Esfera, é a cor dela; em qualquer outra tela (Hub, Timeline, Configurações),
 * é o fósforo do NEXUS. A poeira estelar e a barra do topo herdam esta cor, e a
 * troca de seção a INTERPOLA suave (o `Starfield` persegue o alvo; a barra
 * transiciona por CSS) — nada "pula" de verde para ciano.
 *
 * Custo: zero requisições novas. A chave `["areas"]` já é buscada pela rail, pelo
 * Hub e pelo Topbar; aqui é um `find` sobre um cache quente. O mesmo racional do
 * `useSphereColor`, mas resolvido a partir do PATHNAME (a rota diz a seção), não
 * de um `areaId` recebido.
 */

import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { listAreas } from "../lib/ipc";
import { useUi } from "../stores/ui";

/** O fósforo do tema atual, lido do token — muda no claro/escuro. */
function accentHex(): string {
  if (typeof window === "undefined") return "#33e1a0";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return v || "#33e1a0";
}

export function useSectionTint(): string {
  const { pathname } = useLocation();
  const theme = useUi((s) => s.theme);
  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
  });

  // Relê o fósforo quando o tema vira — o `--accent` do claro é outro hex.
  const accent = useMemo(() => accentHex(), [theme]);

  const sphereId = pathname.startsWith("/sphere/") ? pathname.slice(8) : null;
  const sphere = sphereId ? areas.find((a) => a.id === sphereId) : undefined;
  return sphere?.color ?? accent;
}
