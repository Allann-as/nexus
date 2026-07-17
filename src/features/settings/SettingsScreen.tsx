/**
 * Settings — M0 ships the "Seus dados" page.
 *
 * It exists this early on purpose: the user should be able to answer "where is
 * my data and how much of it is there?" from the very first build. Shortcuts,
 * backup folder, export and maintenance land in M5.
 */

import { useQuery } from "@tanstack/react-query";
import { Boxes, HardDrive, Layers, Moon, ScrollText, Sun } from "lucide-react";

import { systemInfo, toNexusError } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { Card, PageHeader, Button } from "../../design-system/primitives";
import { CountUp, StatCard } from "../../design-system/cards";
import { useUi } from "../../stores/ui";

export function SettingsScreen() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const { data, error } = useQuery({
    queryKey: ["system-info"],
    queryFn: systemInfo,
  });

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] pb-12">
        <PageHeader title="Configurações" subtitle="Aparência e seus dados" />

        <div className="max-w-[720px] space-y-4 px-8">
          <Card className="p-5">
            <h2 className="text-[13px] font-medium">Tema</h2>
            <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
              O escuro é o padrão do NEXUS.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant={theme === "dark" ? "primary" : "secondary"}
                size="sm"
                icon={Moon}
                onClick={() => setTheme("dark")}
              >
                Escuro
              </Button>
              <Button
                variant={theme === "light" ? "primary" : "secondary"}
                size="sm"
                icon={Sun}
                onClick={() => setTheme("light")}
              >
                Claro
              </Button>
            </div>
          </Card>

          {error ? (
            <Card className="p-5">
              <h2 className="text-[13px] font-medium">Seus dados</h2>
              <p className="mt-3 text-[13px] text-[var(--danger)]">
                {toNexusError(error).message}
              </p>
            </Card>
          ) : (
            <>
              {/* Os quatro números que respondem "quanto disto é meu?" saem da
                  lista e viram o dado grande — o resto é procedência, não
                  medida. */}
              <div className="grid grid-cols-4 gap-3">
                <StatCard
                  icon={Boxes}
                  label="Nodes"
                  value={data ? <CountUp to={data.nodeCount} /> : "—"}
                  tone="sphere"
                />
                <StatCard
                  icon={Layers}
                  label="Esferas"
                  value={data ? <CountUp to={data.areaCount} /> : "—"}
                  tone="accent"
                />
                <StatCard
                  icon={ScrollText}
                  label="No ledger"
                  value={data ? <CountUp to={data.ledgerCount} /> : "—"}
                  tone="success"
                />
                <StatCard
                  icon={HardDrive}
                  label="Banco"
                  value={data ? formatBytes(data.dbSizeBytes) : "—"}
                  tone="sphere"
                />
              </div>

              <Card className="p-5">
                <h2 className="text-[13px] font-medium">Seus dados</h2>
                <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
                  Tudo vive neste computador. Nada sai daqui.
                </p>

                <dl className="mt-4 space-y-2.5">
                  <Row label="Pasta de dados" value={data?.dataDir ?? "—"} mono />
                  <Row
                    label="Versão do schema"
                    value={data ? `v${data.schemaVersion}` : "—"}
                  />
                  <Row label="Versão do app" value={data?.appVersion ?? "—"} />
                </dl>
              </Card>
            </>
          )}
        </div>
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
      <dt className="shrink-0 text-[10px] font-medium tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </dt>
      <dd
        data-selectable
        className={`truncate text-[13px] text-[var(--text-primary)] ${mono ? "font-mono text-[12px]" : "tabular"}`}
      >
        {value}
      </dd>
    </div>
  );
}
