/**
 * A rail global — 56px de ícones, presente em toda tela.
 *
 * Substitui a sidebar de 240px com lista de módulos. A troca não é de largura, é
 * de modelo: a sidebar tentava listar TUDO (9 módulos + as áreas), e uma lista
 * que cresce com o produto acaba sendo um menu de sistema operacional, não uma
 * navegação. A rail lista só o que é global e não pertence a Esfera nenhuma; o
 * resto se alcança pelo Hub, que é uma TELA e pode ser bonito.
 *
 * Efeito colateral que era metade do objetivo: 184px a mais de largura para o
 * conteúdo, em cada tela do app.
 */

import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Settings, type LucideIcon } from "lucide-react";

import { NAV_ITEMS } from "./navigation";
import { countNodes } from "../lib/ipc";
import { cx } from "../design-system/primitives";

export function Rail() {
  // O badge do Inbox é a única contagem no chrome do app: é o número que convida
  // à triagem. Os outros itens não ganham badge de propósito — um app coberto de
  // números vira ansiedade, não informação.
  const { data: inboxCount = 0 } = useQuery({
    queryKey: ["nodes", "count", { kind: "inbox_item", status: "active" }],
    queryFn: () => countNodes({ kind: "inbox_item", status: "active" }),
  });

  return (
    <aside
      className="z-20 flex shrink-0 flex-col items-center gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-void)] py-3"
      style={{ width: "var(--rail-w)" }}
    >
      <NavLink to="/" title="Hub" className="mb-2 grid place-items-center">
        <NexusMark />
      </NavLink>

      {NAV_ITEMS.map((item) => (
        <RailLink
          key={item.path}
          item={item}
          badge={item.path === "/inbox" ? inboxCount : 0}
        />
      ))}

      <div className="flex-1" />

      <RailLink item={{ path: "/settings", label: "Configurações", icon: Settings }} />
    </aside>
  );
}

/** Só o que a rail desenha. `jumpKey` é assunto do teclado, não do ícone. */
interface RailItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

function RailLink({ item, badge = 0 }: { item: RailItem; badge?: number }) {
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      title={item.label}
      aria-label={item.label}
      className={({ isActive }) =>
        cx(
          "group relative grid size-10 place-items-center rounded-[var(--radius-md)]",
          "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease)]",
          isActive
            ? "bg-[var(--accent-muted)] text-[var(--accent)]"
            : "text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* O indicador de ativo: uma barrinha colada na borda esquerda. Um
              fundo sozinho é ambíguo com o hover; a barra não é. */}
          <span
            aria-hidden
            className={cx(
              "absolute top-1/2 -left-3 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--accent)]",
              "transition-[opacity,transform] duration-[var(--dur-fast)] ease-[var(--ease)]",
              isActive ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
            )}
          />
          <item.icon size={18} strokeWidth={1.9} />

          {badge > 0 && (
            <span className="tabular absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-semibold text-white">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

/** O "N" em traço contínuo dentro de um squircle com o gradiente do NEXUS. */
function NexusMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nexus-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-bright)" />
          <stop offset="100%" stopColor="var(--accent-deep)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#nexus-mark)" />
      <path
        d="M10.5 22V10L21.5 22V10"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
