/**
 * Dashboard — esqueleto do M1.
 *
 * As colunas que a spec pede (Hoje, hábitos, Nexus Score, "Neste dia", alerta
 * de sobrecarga) chegam junto com os dados que as alimentam, no M2/M4. O que é
 * real hoje: contagens vindas do SQLite e o atalho de captura.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Database, History, Inbox, WifiOff } from "lucide-react";

import { systemInfo, countNodes, toNexusError } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { Card, PageHeader, Button, Kbd } from "../../design-system/primitives";

export function DashboardScreen() {
  const navigate = useNavigate();

  const { data, error, isPending } = useQuery({
    queryKey: ["system-info"],
    queryFn: systemInfo,
  });

  const { data: inboxCount } = useQuery({
    queryKey: ["nodes", "count", { kind: "inbox_item", status: "active" }],
    queryFn: () => countNodes({ kind: "inbox_item", status: "active" }),
  });

  const num = (v: number | undefined) => (isPending ? "—" : String(v ?? 0));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Dashboard"
        subtitle="Fundação e núcleo de dados — os módulos chegam por milestone"
      />

      <div className="grid grid-cols-4 gap-4 px-8 pb-6">
        <Stat
          icon={Inbox}
          label="Inbox"
          value={num(inboxCount)}
          hint={
            (inboxCount ?? 0) > 0 ? "esperando triagem" : "zerada — nada pendente"
          }
        />
        <Stat
          icon={Database}
          label="Nodes"
          value={num(data?.nodeCount)}
          hint="toda entidade é um node"
        />
        <Stat
          icon={History}
          label="Eventos"
          value={num(data?.ledgerCount)}
          hint="história imutável no ledger"
        />
        <Stat
          icon={WifiOff}
          label="Rede"
          value="0"
          hint="chamadas em runtime — por construção"
        />
      </div>

      <div className="px-8 pb-8">
        <Card className="p-5">
          <h2 className="text-[13px] font-medium text-[var(--text-primary)]">
            Comece capturando
          </h2>
          <p className="mt-1.5 max-w-[560px] text-[13px] leading-[21px] text-[var(--text-secondary)]">
            <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>N</Kbd> captura qualquer coisa de
            qualquer tela, sem decidir nada. Depois, no Inbox, <Kbd>T</Kbd> vira
            tarefa, <Kbd>H</Kbd> nota e <Kbd>P</Kbd> projeto. Tudo que você fizer
            entra no ledger — e a Timeline vai contar essa história a partir do M4.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate("/inbox")}>
              Abrir Inbox
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/areas")}>
              Criar áreas
            </Button>
          </div>
        </Card>
      </div>

      <div className="px-8 pb-8">
        <p className="text-[12px] text-[var(--text-tertiary)]">
          Schema v{data?.schemaVersion ?? "—"} ·{" "}
          {data ? formatBytes(data.dbSizeBytes) : "—"} em disco ·{" "}
          <span data-selectable className="font-mono">
            {data?.dataDir ?? "%APPDATA%\\Nexus"}
          </span>
        </p>
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
