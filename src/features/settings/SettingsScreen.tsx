/**
 * Configurações — um hub navegável (M4.6, item 8).
 *
 * Seis seções, no mesmo nível de acabamento das Esferas: Aparência, Atalhos,
 * Backup & Dados, Manutenção, Gamificação e Sobre. A seção ativa mora no URL
 * (`?s=`), como as Esferas (ADR-0044) — deep-linkável e alcançável pelo Ctrl+K.
 *
 * O que depende do M5 (retenção de backup, exportação, restauração, pasta de
 * sync) aparece com ESTADO HONESTO — "chega no M5" —, nunca um botão morto.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Database,
  Download,
  FolderSync,
  HardDrive,
  HardDriveDownload,
  Info,
  Keyboard,
  KeyRound,
  Layers,
  Lock,
  Moon,
  Palette,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Trophy,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import {
  appSettings,
  setCloseToTray,
  backupStatus,
  createBackup,
  exportData,
  listBackups,
  disablePin,
  lockStatus,
  quickCheck,
  rebuildSearchIndex,
  restoreBackup,
  setBackupConfig,
  setPin,
  systemInfo,
  toNexusError,
  vacuumDb,
  xpReference,
  type BackupInfo,
} from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { Button, Card, Kbd, PageHeader, cx } from "../../design-system/primitives";
import { CountUp, StatCard } from "../../design-system/cards";
import { Formula } from "../../design-system/Formula";
import { NexusMark } from "../../design-system/NexusMark";
import { useToasts } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import { useLock } from "../../stores/lock";
import { allShortcuts } from "./shortcuts";

interface SettingsSection {
  key: string;
  label: string;
  icon: LucideIcon;
}

const SECTIONS: SettingsSection[] = [
  { key: "aparencia", label: "Aparência", icon: Palette },
  { key: "atalhos", label: "Atalhos", icon: Keyboard },
  { key: "dados", label: "Backup & Dados", icon: Database },
  { key: "manutencao", label: "Manutenção", icon: Wrench },
  { key: "seguranca", label: "Segurança", icon: Lock },
  { key: "gamificacao", label: "Gamificação", icon: Trophy },
  { key: "sobre", label: "Sobre", icon: Info },
];

export function SettingsScreen() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("s");
  const active = SECTIONS.find((s) => s.key === requested)?.key ?? SECTIONS[0].key;
  const setActive = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("s", key);
    setParams(next, { replace: true });
  };

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-8 pt-8 pb-16">
        <PageHeader title="Configurações" subtitle="Aparência, dados e o que faz o app funcionar" />

        <div className="mt-6 flex flex-col gap-8 md:flex-row">
          {/* Nav lateral */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-[200px] md:flex-col md:overflow-visible">
            {SECTIONS.map((s) => {
              const on = s.key === active;
              return (
                <button
                  key={s.key}
                  onClick={() => setActive(s.key)}
                  className={cx(
                    "flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-left text-[13px] font-medium whitespace-nowrap transition-colors duration-[var(--dur-fast)]",
                    on
                      ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <s.icon size={16} style={{ color: on ? "var(--accent)" : undefined }} />
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Conteúdo */}
          <div key={active} className="nx-section-enter min-w-0 flex-1">
            {active === "aparencia" && <AppearanceSection />}
            {active === "atalhos" && <ShortcutsSection />}
            {active === "dados" && <DataSection />}
            {active === "manutencao" && <MaintenanceSection />}
            {active === "seguranca" && <SecuritySection />}
            {active === "gamificacao" && <GamificationSection />}
            {active === "sobre" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== Aparência ===== */

function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const reducedMotion = useUi((s) => s.reducedMotion);
  const setReducedMotion = useUi((s) => s.setReducedMotion);

  return (
    <div className="flex flex-col gap-4">
      <SettingCard title="Tema" hint="O escuro é o padrão do NEXUS.">
        <div className="flex gap-2">
          <Choice active={theme === "dark"} icon={Moon} onClick={() => setTheme("dark")}>
            Escuro
          </Choice>
          <Choice active={theme === "light"} icon={Sun} onClick={() => setTheme("light")}>
            Claro
          </Choice>
        </div>
      </SettingCard>

      <SettingCard title="Densidade" hint="Compacta aperta as linhas de dados — mais informação por tela.">
        <div className="flex gap-2">
          <Choice active={density === "comfortable"} onClick={() => setDensity("comfortable")}>
            Confortável
          </Choice>
          <Choice active={density === "compact"} onClick={() => setDensity("compact")}>
            Compacta
          </Choice>
        </div>
      </SettingCard>

      <SettingCard
        title="Reduzir movimento"
        hint="Desliga as animações e o count-up. Vale mesmo que o sistema esteja em movimento normal."
      >
        <Toggle on={reducedMotion} onChange={setReducedMotion} />
      </SettingCard>

      <TraySetting />
    </div>
  );
}

/** O "fechar para a bandeja" (ARSENAL) — persiste no backend, que o lê no
 *  handler de fechamento da janela. */
function TraySetting() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["app-settings"], queryFn: appSettings });
  const save = useMutation({
    mutationFn: (v: boolean) => setCloseToTray(v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["app-settings"] }),
  });
  return (
    <SettingCard
      title="Fechar para a bandeja"
      hint="Fechar a janela minimiza o NEXUS para a bandeja do Windows em vez de sair. Ctrl+Shift+N abre a Captura Rápida mesmo com o app em segundo plano."
    >
      <Toggle on={q.data?.closeToTray ?? true} onChange={(v) => save.mutate(v)} />
    </SettingCard>
  );
}

/* ===== Atalhos ===== */

function ShortcutsSection() {
  const [q, setQ] = useState("");
  const all = useMemo(() => allShortcuts(), []);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return all;
    return all.filter(
      (s) => s.label.toLowerCase().includes(t) || s.keys.join(" ").toLowerCase().includes(t),
    );
  }, [all, q]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const s of filtered) {
      const arr = m.get(s.group) ?? [];
      arr.push(s);
      m.set(s.group, arr);
    }
    return [...m.entries()];
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          size={15}
          className="absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar atalho…"
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] pr-3 pl-9 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-tertiary)]"
        />
      </div>

      {groups.length === 0 ? (
        <p className="px-1 py-6 text-center text-[13px] text-[var(--text-tertiary)]">
          Nenhum atalho com “{q}”.
        </p>
      ) : (
        groups.map(([group, items]) => (
          <div key={group}>
            <h3 className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
              {group}
            </h3>
            <Card className="divide-y divide-[var(--border-subtle)] p-0">
              {items.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-4 px-4"
                  style={{ minHeight: "var(--row-data)" }}
                >
                  <span className="text-[13px] text-[var(--text-primary)]">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}

/* ===== Backup & Dados ===== */

function DataSection() {
  const { data, error } = useQuery({ queryKey: ["system-info"], queryFn: systemInfo });

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Card className="p-5">
          <p className="text-[13px] text-[var(--danger)]">{toNexusError(error).message}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Boxes} label="Nodes" value={data ? <CountUp to={data.nodeCount} /> : "—"} />
            <StatCard icon={Layers} label="Esferas" value={data ? <CountUp to={data.areaCount} /> : "—"} tone="accent" />
            <StatCard icon={ScrollText} label="No ledger" value={data ? <CountUp to={data.ledgerCount} /> : "—"} tone="success" />
            <StatCard icon={HardDrive} label="Banco" value={data ? formatBytes(data.dbSizeBytes) : "—"} />
          </div>

          <SettingCard title="Seus dados" hint="Tudo vive neste computador. Nada sai daqui.">
            <dl className="space-y-2.5">
              <DataRow label="Pasta de dados" value={data?.dataDir ?? "—"} mono />
              {data?.isCustomDataDir && (
                <div className="rounded-[var(--radius-md)] border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-[12px] text-[var(--warning)]">
                  Modo dev: rodando com dados de TESTE (NEXUS_DATA_DIR), não o seu banco real.
                </div>
              )}
              <DataRow label="Versão do schema" value={data ? `v${data.schemaVersion}` : "—"} />
              <DataRow label="Versão do app" value={data?.appVersion ?? "—"} />
            </dl>
          </SettingCard>
        </>
      )}

      {/* Backup e restauro são funcionais desde o M5 (ADR-0050). */}
      <BackupSettings />
      <RestoreCard />

      <ExportCard />
    </div>
  );
}

function ExportCard() {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [result, setResult] = useState<{ dir: string; tables: number; rows: number; mediaFiles: number } | null>(
    null,
  );

  const run = useMutation({
    mutationFn: exportData,
    onSuccess: (info) => {
      setResult(info);
      push("success", "Exportação concluída");
    },
    onError: pushError,
  });

  return (
    <SettingCard
      title="Exportação humana"
      hint="Seus dados em formato aberto (um JSON por tabela + CSVs + mídia + README), legíveis daqui a 30 anos sem o app."
    >
      <div className="flex flex-col gap-3">
        <ActionRow
          icon={Download}
          title="Exportar tudo agora"
          hint="Escreve uma pasta em exports/ com o dump completo e um README que explica cada arquivo."
          button="Exportar"
          pending={run.isPending}
          onClick={() => run.mutate()}
        />
        {result && (
          <div className="rounded-[var(--radius-md)] border border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] px-4 py-3">
            <p className="text-[12.5px] text-[var(--text-primary)]">
              <span className="tabular font-semibold">{result.tables}</span> tabelas ·{" "}
              <span className="tabular font-semibold">{result.rows.toLocaleString("pt-BR")}</span> linhas
              {result.mediaFiles > 0 && (
                <>
                  {" "}·{" "}
                  <span className="tabular font-semibold">{result.mediaFiles}</span> anexo(s)
                </>
              )}
            </p>
            <p data-selectable className="mt-1 truncate font-mono text-[11.5px] text-[var(--text-tertiary)]">
              {result.dir}
            </p>
          </div>
        )}
      </div>
    </SettingCard>
  );
}

/** O quanto tempo faz de um instante, em texto de tom adulto. */
function whenText(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `hoje às ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `ontem às ${time}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })} às ${time}`;
}

function BackupSettings() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const status = useQuery({ queryKey: ["backup-status"], queryFn: backupStatus });

  const [syncDir, setSyncDir] = useState("");
  const [pw, setPw] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (status.data && !hydrated) {
      setSyncDir(status.data.syncDir ?? "");
      setHydrated(true);
    }
  }, [status.data, hydrated]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["backup-status"] });
    qc.invalidateQueries({ queryKey: ["backups"] });
  };

  const save = useMutation({
    mutationFn: (v: { enabled: boolean; syncDir: string | null; password: string | null }) =>
      setBackupConfig(v.enabled, v.syncDir, v.password),
    onSuccess: () => invalidate(),
    onError: pushError,
  });

  const backupNow = useMutation({
    mutationFn: createBackup,
    onSuccess: (info) => {
      push("success", `Backup criado — ${info.name}`);
      invalidate();
    },
    onError: pushError,
  });

  const s = status.data;
  const enabled = s?.enabled ?? true;

  return (
    <SettingCard
      title="Backup automático"
      hint="Um snapshot por dia na abertura do app. Retenção 7 diários · 4 semanais · 12 mensais."
    >
      <div className="flex flex-col gap-4">
        {/* Último backup + o interruptor */}
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2.5 text-[13px] text-[var(--text-secondary)]">
            <ShieldCheck size={15} className="text-[var(--text-tertiary)]" />
            {s
              ? s.lastBackupMs
                ? `Último backup ${whenText(s.lastBackupMs)}`
                : "Nenhum backup ainda"
              : "—"}
          </span>
          <Toggle
            on={enabled}
            onChange={(v) => save.mutate({ enabled: v, syncDir: s?.syncDir ?? null, password: null })}
          />
        </div>

        <ActionRow
          icon={HardDriveDownload}
          title="Fazer backup agora"
          hint={
            s?.hasPassword
              ? "Cifrado com sua senha. Guardado na pasta de backups."
              : "Guardado na pasta de backups deste computador."
          }
          button="Backup"
          pending={backupNow.isPending}
          onClick={() => backupNow.mutate()}
        />

        {/* Pasta de sincronização */}
        <div>
          <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
            <FolderSync size={14} className="text-[var(--text-tertiary)]" />
            Pasta de sincronização (opcional)
          </label>
          <p className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">
            Cada backup é copiado para cá também — aponte para uma pasta do OneDrive ou Dropbox.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={syncDir}
              onChange={(e) => setSyncDir(e.target.value)}
              placeholder="C:\Users\...\OneDrive\Nexus"
              data-selectable
              className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  { enabled, syncDir: syncDir.trim() || null, password: null },
                  { onSuccess: () => push("success", "Pasta de sincronização salva") },
                )
              }
            >
              Salvar
            </Button>
          </div>
        </div>

        {/* Senha */}
        <div>
          <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
            <KeyRound size={14} className="text-[var(--text-tertiary)]" />
            Senha do backup (opcional)
            {s?.hasPassword && (
              <span className="rounded-full border border-[var(--success)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                Ativa
              </span>
            )}
          </label>
          <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_9%,transparent)] px-3 py-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <p className="text-[11.5px] leading-[17px] text-[var(--warning)]">
              Cifra o zip com AES-256. <strong>Perder a senha é perder o backup</strong> — não há
              recuperação. Sem senha, o backup ainda funciona (só não fica cifrado).
            </p>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder={s?.hasPassword ? "Digite para trocar a senha" : "Definir uma senha"}
              data-selectable
              className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={save.isPending || pw.length === 0}
              onClick={() =>
                save.mutate(
                  { enabled, syncDir: s?.syncDir ?? null, password: pw },
                  {
                    onSuccess: () => {
                      push("success", "Senha definida");
                      setPw("");
                    },
                  },
                )
              }
            >
              {s?.hasPassword ? "Trocar" : "Definir"}
            </Button>
            {s?.hasPassword && (
              <Button
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    { enabled, syncDir: s?.syncDir ?? null, password: "" },
                    { onSuccess: () => push("success", "Senha removida — backups deixam de ser cifrados") },
                  )
                }
              >
                Remover
              </Button>
            )}
          </div>
        </div>
      </div>
    </SettingCard>
  );
}

function RestoreCard() {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const status = useQuery({ queryKey: ["backup-status"], queryFn: backupStatus });
  const backups = useQuery({ queryKey: ["backups"], queryFn: listBackups });

  const [confirming, setConfirming] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [staged, setStaged] = useState(false);

  const restore = useMutation({
    mutationFn: (v: { name: string; password: string | null }) => restoreBackup(v.name, v.password),
    onSuccess: () => {
      setStaged(true);
      setConfirming(null);
      setPw("");
    },
    onError: pushError,
  });

  const list = backups.data ?? [];
  const needsPassword = status.data?.hasPassword ?? false;

  if (staged) {
    return (
      <SettingCard title="Restaurar de um backup" hint="A restauração é aplicada na próxima abertura.">
        <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent-muted)] px-4 py-3">
          <RotateCcw size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div>
            <p className="text-[13px] font-medium text-[var(--text-primary)]">
              Restauração agendada.
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Feche e reabra o NEXUS: o banco será substituído no boot, depois de passar no
              quick_check. Se algo estiver errado com o backup, seu banco atual fica como está.
            </p>
          </div>
        </div>
      </SettingCard>
    );
  }

  return (
    <SettingCard
      title="Restaurar de um backup"
      hint="Substitui o banco atual pelo do backup escolhido. Aplicado no próximo boot, após validação."
    >
      {backups.isPending ? (
        <div className="h-16 animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-base)]" />
      ) : list.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-tertiary)]">
          Nenhum backup ainda. O primeiro nasce na próxima abertura do app (ou no botão acima).
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {needsPassword && (
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Senha do backup (se cifrado)"
              data-selectable
              className="mb-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
          )}
          {list.map((b) => (
            <RestoreRow
              key={b.name}
              backup={b}
              confirming={confirming === b.name}
              pending={restore.isPending}
              onAsk={() => setConfirming(b.name)}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                restore.mutate(
                  { name: b.name, password: needsPassword && pw ? pw : null },
                  {
                    onSuccess: () =>
                      push("success", "Restauração agendada — reinicie o app para aplicar"),
                  },
                )
              }
            />
          ))}
        </div>
      )}
    </SettingCard>
  );
}

function RestoreRow({
  backup,
  confirming,
  pending,
  onAsk,
  onCancel,
  onConfirm,
}: {
  backup: BackupInfo;
  confirming: boolean;
  pending: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[12.5px] text-[var(--text-primary)]">
          {whenText(backup.createdAtMs)}
        </p>
        <p className="tabular text-[11px] text-[var(--text-tertiary)]">
          {formatBytes(backup.sizeBytes)}
        </p>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11.5px] text-[var(--text-secondary)]">Substituir o banco?</span>
          <Button variant="secondary" size="sm" onClick={onConfirm} disabled={pending}>
            {pending ? "…" : "Sim, restaurar"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Não
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onAsk}>
          Restaurar
        </Button>
      )}
    </div>
  );
}

/* ===== Manutenção ===== */

function MaintenanceSection() {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const check = useMutation({
    mutationFn: quickCheck,
    onSuccess: (r) =>
      r === "ok"
        ? push("success", "Banco íntegro (quick_check: ok)")
        : push("error", `quick_check: ${r}`),
    onError: pushError,
  });
  const rebuild = useMutation({
    mutationFn: rebuildSearchIndex,
    onSuccess: () => push("success", "Índice de busca reconstruído"),
    onError: pushError,
  });
  const vacuum = useMutation({
    mutationFn: vacuumDb,
    onSuccess: (bytes) => push("success", `VACUUM concluído — banco em ${formatBytes(bytes)}`),
    onError: pushError,
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-[12.5px] text-[var(--text-tertiary)]">
        Operações locais sobre o arquivo do banco. Seguras de rodar a qualquer momento — nenhuma
        toca o ledger nem apaga dado seu.
      </p>
      <ActionRow
        icon={ShieldCheck}
        title="Verificar integridade"
        hint="Roda PRAGMA quick_check — o mesmo teste da abertura do app."
        button="Verificar"
        pending={check.isPending}
        onClick={() => check.mutate()}
      />
      <ActionRow
        icon={Search}
        title="Reconstruir a busca"
        hint="Regera o índice FTS a partir do estado atual, se a busca parecer defasada."
        button="Reconstruir"
        pending={rebuild.isPending}
        onClick={() => rebuild.mutate()}
      />
      <ActionRow
        icon={Zap}
        title="Compactar o banco (VACUUM)"
        hint="Devolve ao disco o espaço de linhas apagadas e desfragmenta o arquivo."
        button="Compactar"
        pending={vacuum.isPending}
        onClick={() => vacuum.mutate()}
      />
    </div>
  );
}

/* ===== Segurança (M5.5 §3.5) ===== */

function SecuritySection() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const setEnabled = useLock((s) => s.setEnabled);
  const status = useQuery({ queryKey: ["lock-status"], queryFn: lockStatus });
  const enabled = status.data?.enabled ?? false;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [off, setOff] = useState("");

  const afterChange = (nowEnabled: boolean) => {
    setEnabled(nowEnabled);
    setCurrent("");
    setNext("");
    setOff("");
    qc.invalidateQueries({ queryKey: ["lock-status"] });
  };

  const change = useMutation({
    mutationFn: () => setPin(enabled ? current : null, next),
    onSuccess: () => {
      push("success", enabled ? "PIN alterado" : "Tela de bloqueio ativada");
      afterChange(true);
    },
    onError: pushError,
  });

  const disable = useMutation({
    mutationFn: () => disablePin(off),
    onSuccess: () => {
      push("success", "Tela de bloqueio desativada");
      afterChange(false);
    },
    onError: pushError,
  });

  const isPin = (v: string) => /^\d{6}$/.test(v);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <p className="text-[12px] leading-[18px] text-[var(--text-secondary)]">
          O PIN é <strong className="text-[var(--text-primary)]">privacidade de tela</strong>:
          impede que alguém que pega o computador desbloqueado abra o NEXUS. Ele{" "}
          <strong className="text-[var(--text-primary)]">não cifra o banco</strong> — quem tem
          acesso à máquina consegue ler o arquivo. Guardamos só um hash com salt, nunca o PIN. O
          backup e a restauração não dependem dele. Bloqueie a qualquer momento com <Kbd>Ctrl</Kbd>{" "}
          <Kbd>L</Kbd>.
        </p>
      </div>

      <SettingCard
        title={enabled ? "Trocar o PIN" : "Ativar a tela de bloqueio"}
        hint={
          enabled
            ? "Informe o PIN atual e o novo. Seis dígitos."
            : "Defina um PIN de seis dígitos. O app passará a abrir bloqueado."
        }
      >
        <div className="flex flex-col gap-2.5">
          {enabled && (
            <PinInput value={current} onChange={setCurrent} placeholder="PIN atual" />
          )}
          <PinInput value={next} onChange={setNext} placeholder="Novo PIN (6 dígitos)" />
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={change.isPending || !isPin(next) || (enabled && !isPin(current))}
              onClick={() => change.mutate()}
            >
              {change.isPending ? "…" : enabled ? "Trocar PIN" : "Ativar"}
            </Button>
          </div>
        </div>
      </SettingCard>

      {enabled && (
        <SettingCard
          title="Desativar a tela de bloqueio"
          hint="Informe o PIN atual para desligar. O app voltará a abrir direto."
        >
          <div className="flex flex-col gap-2.5">
            <PinInput value={off} onChange={setOff} placeholder="PIN atual" />
            <div>
              <Button
                variant="danger"
                size="sm"
                disabled={disable.isPending || !isPin(off)}
                onClick={() => disable.mutate()}
              >
                {disable.isPending ? "…" : "Desativar"}
              </Button>
            </div>
          </div>
        </SettingCard>
      )}
    </div>
  );
}

/** Um campo de PIN: seis dígitos, mascarado, só aceita número. */
function PinInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder={placeholder}
      data-selectable
      className="tabular w-full max-w-[240px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-[14px] tracking-[0.3em] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:tracking-normal placeholder:text-[var(--text-tertiary)]"
    />
  );
}

/* ===== Gamificação ===== */

function GamificationSection() {
  const { data, error } = useQuery({ queryKey: ["xp-reference"], queryFn: xpReference });

  if (error) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-[var(--danger)]">{toNexusError(error).message}</p>
      </Card>
    );
  }
  if (!data) return <div className="h-40 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-[12.5px] text-[var(--text-tertiary)]">
        Zero caixa-preta: o XP é a soma dos pontos abaixo, e o nível vem da curva. Nada é gravado —
        apagar um feito ajusta o XP na recomputação seguinte.
      </p>

      <SettingCard title="Tabela de pontos" hint="Quanto vale cada feito, por Esfera.">
        <div className="divide-y divide-[var(--border-subtle)]">
          {data.points.map((p) => (
            <div
              key={p.label}
              className="flex items-center justify-between gap-4"
              style={{ minHeight: "var(--row-data)" }}
            >
              <span className="text-[13px] text-[var(--text-primary)]">{p.label}</span>
              <span className="tabular shrink-0 font-mono text-[13px] font-semibold text-[var(--accent)]">
                +{p.points}
              </span>
            </div>
          ))}
        </div>
      </SettingCard>

      <SettingCard title="Curva de nível" hint="O custo de cada nível e o XP acumulado para alcançá-lo.">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                <th className="pb-2 font-medium">Nível</th>
                <th className="pb-2 text-right font-medium">Custo do degrau</th>
                <th className="pb-2 text-right font-medium">XP acumulado</th>
              </tr>
            </thead>
            <tbody>
              {data.curve.map((s) => (
                <tr key={s.level} className="border-t border-[var(--border-subtle)]">
                  <td className="py-1.5 font-mono font-semibold text-[var(--text-primary)]">
                    {s.level}
                  </td>
                  <td className="tabular py-1.5 text-right text-[var(--text-secondary)]">
                    {s.level === 1 ? "—" : s.cost.toLocaleString("pt-BR")}
                  </td>
                  <td className="tabular py-1.5 text-right font-medium text-[var(--text-primary)]">
                    {s.cumulative.toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Formula>{data.formula}</Formula>
      </SettingCard>
    </div>
  );
}

/* ===== Sobre ===== */

function AboutSection() {
  const { data } = useQuery({ queryKey: ["system-info"], queryFn: systemInfo });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col items-center gap-4 p-8 text-center">
        <NexusMark size={72} plate />
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
            NEXUS
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
            Seu sistema operacional pessoal — 100% offline, seus dados só seus.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
          <Tag>versão {data?.appVersion ?? "—"}</Tag>
          <Tag>schema v{data?.schemaVersion ?? "—"}</Tag>
          <Tag>SQLite · Tauri · React</Tag>
        </div>
      </Card>

      <SettingCard title="A marca" hint="O astrolábio: anéis concêntricos são as Esferas da vida; o núcleo é o nexo.">
        <div className="flex items-center gap-4">
          <NexusMark size={40} />
          <p className="text-[12.5px] text-[var(--text-secondary)]">
            O NEXUS é o instrumento com que se navega a própria vida. A marca não se tinge com o
            tema nem com a Esfera — é um ativo de identidade única (ADR-0043).
          </p>
        </div>
      </SettingCard>

      <div className="flex items-center gap-2 px-1 text-[12px] text-[var(--text-tertiary)]">
        <Sparkles size={13} />
        Zero rede em runtime · zero IA · ledger append-only imutável.
      </div>
    </div>
  );
}

/* ===== peças compartilhadas ===== */

function SettingCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h2>
      {hint && <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">{hint}</p>}
      <div className="mt-3.5">{children}</div>
    </Card>
  );
}

function Choice({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean;
  icon?: LucideIcon;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors duration-[var(--dur-fast)]",
        active
          ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text-primary)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]",
      )}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-[var(--dur-fast)]",
        on ? "bg-[var(--accent)]" : "bg-[var(--bg-raised)] border border-[var(--border-subtle)]",
      )}
    >
      <span
        className="inline-block size-4 rounded-full bg-white transition-transform duration-[var(--dur-fast)]"
        style={{ transform: on ? "translateX(22px)" : "translateX(3px)" }}
      />
    </button>
  );
}

function ActionRow({
  icon: Icon,
  title,
  hint,
  button,
  pending,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  button: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--bg-raised)]">
          <Icon size={16} className="text-[var(--text-secondary)]" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">{title}</p>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{hint}</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onClick} disabled={pending}>
        {pending ? "…" : button}
      </Button>
    </Card>
  );
}

function DataRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
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
        className={cx(
          "truncate text-[13px] text-[var(--text-primary)]",
          mono ? "font-mono text-[12px]" : "tabular",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2.5 py-1 font-medium text-[var(--text-secondary)]">
      {children}
    </span>
  );
}
