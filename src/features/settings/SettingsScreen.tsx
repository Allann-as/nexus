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

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Database,
  Download,
  FolderSync,
  HardDrive,
  Info,
  Keyboard,
  Layers,
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
  quickCheck,
  rebuildSearchIndex,
  systemInfo,
  toNexusError,
  vacuumDb,
  xpReference,
} from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import { Button, Card, Kbd, PageHeader, cx } from "../../design-system/primitives";
import { CountUp, StatCard } from "../../design-system/cards";
import { Formula } from "../../design-system/Formula";
import { NexusMark } from "../../design-system/NexusMark";
import { useToasts } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
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
    </div>
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

      {/* Backup & exportação são o coração do M5 — aqui aparecem com estado honesto. */}
      <SettingCard title="Backup automático" hint="Snapshots com retenção (7 diários · 4 semanais · 12 mensais).">
        <FutureRow icon={ShieldCheck} label="Último backup" state="Chega no M5" />
        <FutureRow icon={FolderSync} label="Pasta de sincronização" state="Chega no M5" />
      </SettingCard>

      <SettingCard title="Exportar e restaurar" hint="Seus dados em formato humano (JSON + CSV + mídia), e a volta a partir de um backup.">
        <FutureRow icon={Download} label="Exportação total" state="Chega no M5" />
        <FutureRow icon={RotateCcw} label="Restaurar de um backup" state="Chega no M5" />
      </SettingCard>
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

/** Uma linha de recurso que ainda não existe — estado honesto, não botão morto. */
function FutureRow({ icon: Icon, label, state }: { icon: LucideIcon; label: string; state: string }) {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] last:border-0"
      style={{ minHeight: "var(--row-data)" }}
    >
      <span className="flex items-center gap-2.5 text-[13px] text-[var(--text-secondary)]">
        <Icon size={15} className="text-[var(--text-tertiary)]" />
        {label}
      </span>
      <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] font-medium tracking-[0.06em] text-[var(--text-tertiary)] uppercase">
        {state}
      </span>
    </div>
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
