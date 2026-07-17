/**
 * Dashboard — M0 skeleton.
 *
 * The columns the spec calls for (Hoje, hábitos, Nexus Score, "Neste dia",
 * alerta de sobrecarga) arrive with the data that feeds them in M2/M4. What is
 * real today is the backend round-trip: this screen proves React → invoke →
 * Rust → SQLite → back is wired end to end.
 */

import { useQuery } from "@tanstack/react-query";
import { Database, ShieldCheck, WifiOff } from "lucide-react";

import { systemInfo, toNexusError } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { Card, PageHeader } from "../../design-system/primitives";

export function DashboardScreen() {
  const { data, error, isPending } = useQuery({
    queryKey: ["system-info"],
    queryFn: systemInfo,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Dashboard"
        subtitle="Fundação instalada — os módulos chegam por milestone"
      />

      <div className="grid grid-cols-3 gap-4 px-8 pb-8">
        <Stat
          icon={Database}
          label="Nodes"
          value={isPending ? "—" : String(data?.nodeCount ?? 0)}
          hint="Toda entidade do NEXUS é um node"
        />
        <Stat
          icon={ShieldCheck}
          label="Schema"
          value={isPending ? "—" : `v${data?.schemaVersion ?? 0}`}
          hint={isPending ? "" : formatBytes(data?.dbSizeBytes ?? 0) + " em disco"}
        />
        <Stat
          icon={WifiOff}
          label="Rede"
          value="0"
          hint="Chamadas de rede em runtime — por construção"
        />
      </div>

      <div className="px-8 pb-8">
        <Card className="p-5">
          <h2 className="text-[13px] font-medium text-[var(--text-primary)]">
            M0 — Fundação
          </h2>
          <p className="mt-1.5 max-w-[560px] text-[13px] leading-[21px] text-[var(--text-secondary)]">
            Banco SQLite embarcado com WAL, chaves estrangeiras e o schema core
            aplicado. Shell, design system e paleta de comandos operantes. Os
            dados vivem em{" "}
            <span
              data-selectable
              className="font-mono text-[12px] text-[var(--text-tertiary)]"
            >
              {data?.dataDir ?? "%APPDATA%\\Nexus"}
            </span>
            .
          </p>
        </Card>
      </div>

      {error && (
        <div className="px-8 pb-8">
          <Card className="border-[var(--danger)] p-4">
            <p className="text-[13px] text-[var(--danger)]">
              {toNexusError(error).message}
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        <Icon size={13} strokeWidth={2} />
        <span className="text-[11px] font-medium tracking-[0.06em] uppercase">
          {label}
        </span>
      </div>
      <div className="tabular mt-2 text-[24px] leading-[30px] font-medium text-[var(--text-primary)]">
        {value}
      </div>
      <p className="mt-0.5 text-[12px] leading-[17px] text-[var(--text-tertiary)]">
        {hint}
      </p>
    </Card>
  );
}
