/**
 * O menu de navegação global — um painel overlay, aberto pelo hambúrguer.
 *
 * Substitui a rail fixa de 56px (M4.6 §3.3): o menu lateral SEMPRE presente
 * "não fazia sentido" para o usuário. Agora o global mora atrás de um gesto
 * discreto, e a tela inteira é do conteúdo. A fonte continua sendo
 * `app/navigation.ts` — a rail morreu, o array não. O `Ctrl+K` segue sendo o
 * caminho rápido e os `G+<tecla>` seguem alcançando tudo; o hambúrguer é o
 * caminho VISUAL, para quem não decorou os atalhos.
 *
 * Sempre montado, animado por `transform`/`opacity` (a §6 do design system): o
 * painel entra e sai deslizando, e `prefers-reduced-motion` corta a animação.
 */

import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Settings, X, type LucideIcon } from "lucide-react";

import { NAV_ITEMS } from "./navigation";
import { countNodes } from "../lib/ipc";
import { cx } from "../design-system/primitives";

export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: inboxCount = 0 } = useQuery({
    queryKey: ["nodes", "count", { kind: "inbox_item", status: "active" }],
    queryFn: () => countNodes({ kind: "inbox_item", status: "active" }),
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={cx("fixed inset-0 z-40", open ? "" : "pointer-events-none")}
      aria-hidden={!open}
    >
      {/* A cortina: escurece o conteúdo e fecha ao clique fora. */}
      <div
        onClick={onClose}
        className={cx(
          "absolute inset-0 bg-black/45 transition-opacity duration-[var(--dur-base)] ease-[var(--ease)] motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
      />

      {/* O painel. */}
      <nav
        aria-label="Navegação global"
        className={cx(
          "absolute top-0 bottom-0 left-0 flex w-[268px] flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_0_60px_rgba(0,0,0,0.35)]",
          "transition-transform duration-[var(--dur-base)] ease-[var(--ease)] motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <NexusMark />
            <span className="text-[15px] font-semibold tracking-[0.06em] text-[var(--text-primary)]">
              NEXUS
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="grid size-7 place-items-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          <DrawerLink
            item={{ path: "/", label: "Hub", icon: NAV_ITEMS[0].icon, jumpKey: "h" }}
            onClose={onClose}
          />
          {NAV_ITEMS.slice(1).map((item) => (
            <DrawerLink
              key={item.path}
              item={item}
              badge={item.path === "/inbox" ? inboxCount : 0}
              onClose={onClose}
            />
          ))}
        </div>

        <div className="border-t border-[var(--border-subtle)] px-3 py-2">
          <DrawerLink
            item={{ path: "/settings", label: "Configurações", icon: Settings }}
            onClose={onClose}
          />
        </div>
      </nav>
    </div>
  );
}

interface DrawerItem {
  path: string;
  label: string;
  icon: LucideIcon;
  jumpKey?: string;
}

function DrawerLink({
  item,
  badge = 0,
  onClose,
}: {
  item: DrawerItem;
  badge?: number;
  onClose: () => void;
}) {
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      onClick={onClose}
      className={({ isActive }) =>
        cx(
          "group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-[13px]",
          "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease)]",
          isActive
            ? "bg-[var(--accent-muted)] text-[var(--accent)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
        )
      }
    >
      <item.icon size={17} strokeWidth={1.9} className="shrink-0" />
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="tabular grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-semibold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {item.jumpKey && badge === 0 && (
        <span className="font-mono text-[10px] text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100">
          G {item.jumpKey.toUpperCase()}
        </span>
      )}
    </NavLink>
  );
}

/** O "N" em traço contínuo dentro de um squircle com o gradiente do NEXUS. */
function NexusMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="nexus-drawer-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent-bright)" />
          <stop offset="100%" stopColor="var(--accent-deep)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#nexus-drawer-mark)" />
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
