import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Settings, PanelLeftClose, PanelLeft, ShieldCheck, Plus } from "lucide-react";

import { NAV_ITEMS } from "./navigation";
import { listAreas, countNodes } from "../lib/ipc";
import { cx } from "../design-system/primitives";
import { useUi } from "../stores/ui";

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  // O badge do Inbox é a única contagem no chrome do app: é o número que
  // convida à triagem. Os outros módulos não ganham badge de propósito — um
  // app coberto de números vira ansiedade, não informação.
  const { data: inboxCount = 0 } = useQuery({
    queryKey: ["nodes", "count", { kind: "inbox_item", status: "active" }],
    queryFn: () => countNodes({ kind: "inbox_item", status: "active" }),
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
  });

  return (
    <aside
      className={cx(
        "flex shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]",
        "transition-[width] duration-[var(--dur-base)] ease-[var(--ease)]",
      )}
      style={{
        width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-3"
        style={{ height: "var(--topbar-h)" }}
      >
        <NexusMark />
        {!collapsed && (
          <span className="text-[13px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
            NEXUS
          </span>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 px-2 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cx(
                "group flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-[13px]",
                "transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-[var(--accent-muted)] font-medium text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              )
            }
            style={{ height: "var(--row-list)" }}
          >
            {({ isActive }) => (
              <>
                <item.icon
                  size={16}
                  strokeWidth={1.9}
                  className={cx(
                    "shrink-0 transition-colors",
                    isActive
                      ? "text-[var(--accent)]"
                      : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]",
                  )}
                />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {!collapsed && item.path === "/inbox" && inboxCount > 0 && (
                  <span className="tabular rounded-full bg-[var(--accent-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                    {inboxCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
              Áreas
            </span>
            <NavLink
              to="/areas"
              title="Gerenciar áreas"
              className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <Plus size={13} />
            </NavLink>
          </div>

          {areas.length === 0 ? (
            <NavLink
              to="/areas"
              className="block px-2 py-1 text-[12px] leading-[18px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              Crie sua primeira área →
            </NavLink>
          ) : (
            areas.map((area) => (
              <NavLink
                key={area.id}
                to={`/areas/${area.id}`}
                className={({ isActive }) =>
                  cx(
                    "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 text-[13px]",
                    "transition-colors duration-[var(--dur-fast)]",
                    isActive
                      ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                  )
                }
                style={{ height: "32px" }}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: area.color }}
                  aria-hidden
                />
                <span className="truncate">{area.name}</span>
              </NavLink>
            ))
          )}
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      <div className="border-t border-[var(--border-subtle)] p-2">
        {!collapsed && <BackupIndicator />}
        <div className={cx("flex items-center gap-1", collapsed && "flex-col")}>
          <NavLink
            to="/settings"
            title="Configurações"
            className={({ isActive }) =>
              cx(
                "flex size-8 items-center justify-center rounded-[var(--radius-md)]",
                "transition-colors duration-[var(--dur-fast)]",
                isActive
                  ? "bg-[var(--bg-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              )
            }
          >
            <Settings size={15} strokeWidth={1.9} />
          </NavLink>
          <button
            onClick={toggleSidebar}
            title={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            aria-label={collapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {collapsed ? (
              <PanelLeft size={15} strokeWidth={1.9} />
            ) : (
              <PanelLeftClose size={15} strokeWidth={1.9} />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** Ligado ao job real de backup no M5; o lugar existe desde já para a pergunta
 *  "meus dados estão seguros?" ter sempre onde ser respondida. */
function BackupIndicator() {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5">
      <ShieldCheck size={13} className="shrink-0 text-[var(--text-tertiary)]" />
      <span className="truncate text-[11px] text-[var(--text-tertiary)]">
        Backup: em M5
      </span>
    </div>
  );
}

/** O "N" em traço contínuo dentro de um squircle índigo. */
function NexusMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
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
