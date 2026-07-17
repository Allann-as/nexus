/**
 * Settings — M0 ships the "Seus dados" page.
 *
 * It exists this early on purpose: the user should be able to answer "where is
 * my data and how much of it is there?" from the very first build. Theme,
 * shortcuts, backup folder, export and maintenance land in M5.
 */

import { useQuery } from "@tanstack/react-query";

import { systemInfo, toNexusError } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { Card, PageHeader, Button } from "../../design-system/primitives";
import { useUi } from "../../stores/ui";

export function SettingsScreen() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const { data, error } = useQuery({
    queryKey: ["system-info"],
    queryFn: systemInfo,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Configurações" subtitle="Aparência e seus dados" />

      <div className="max-w-[720px] space-y-4 px-8 pb-8">
        <Card className="p-5">
          <h2 className="text-[13px] font-medium">Tema</h2>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            O escuro é o padrão do NEXUS.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant={theme === "dark" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setTheme("dark")}
            >
              Escuro
            </Button>
            <Button
              variant={theme === "light" ? "primary" : "secondary"}
              size="sm"
              onClick={() => setTheme("light")}
            >
              Claro
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-[13px] font-medium">Seus dados</h2>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            Tudo vive neste computador. Nada sai daqui.
          </p>

          {error ? (
            <p className="mt-3 text-[13px] text-[var(--danger)]">
              {toNexusError(error).message}
            </p>
          ) : (
            <dl className="mt-4 space-y-2.5">
              <Row label="Pasta de dados" value={data?.dataDir ?? "—"} mono />
              <Row
                label="Tamanho do banco"
                value={data ? formatBytes(data.dbSizeBytes) : "—"}
              />
              <Row label="Nodes" value={data ? String(data.nodeCount) : "—"} />
              <Row label="Áreas" value={data ? String(data.areaCount) : "—"} />
              <Row
                label="Eventos no ledger"
                value={data ? String(data.ledgerCount) : "—"}
              />
              <Row
                label="Versão do schema"
                value={data ? `v${data.schemaVersion}` : "—"}
              />
              <Row label="Versão do app" value={data?.appVersion ?? "—"} />
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-2.5 last:border-0"
      style={{ minHeight: "var(--row-data)" }}
    >
      <dt className="shrink-0 text-[13px] text-[var(--text-secondary)]">{label}</dt>
      <dd
        data-selectable
        className={`truncate text-[13px] text-[var(--text-primary)] ${mono ? "font-mono text-[12px]" : "tabular"}`}
      >
        {value}
      </dd>
    </div>
  );
}
