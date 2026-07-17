import { NavLink } from "react-router-dom";
import { Settings, PanelLeftClose, PanelLeft, ShieldCheck } from "lucide-react";

import { NAV_ITEMS } from "./navigation";
import { cx } from "../design-system/primitives";
import { useUi } from "../stores/ui";

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

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
                {!collapsed && <span className="truncate">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Áreas do usuário — populated in M1, once areas have a CRUD. */}
      {!collapsed && (
        <div className="mt-3 px-4">
          <div className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
            Áreas
          </div>
          <p className="mt-2 text-[12px] leading-[18px] text-[var(--text-tertiary)]">
            Suas áreas aparecem aqui.
          </p>
        </div>
      )}

      <div className="flex-1" />

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

/** Wired to the real backup job in M5; the slot exists from day one so the
 *  "is my data safe?" answer always has a home. */
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

/** The "N" in a continuous stroke inside an indigo squircle. */
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
