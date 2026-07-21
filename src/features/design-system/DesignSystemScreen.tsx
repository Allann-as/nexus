/**
 * A tela-vitrine do design system COCKPIT (v1.3, §1 do plano).
 *
 * Não é uma tela de produto: é o BANCO DE PROVAS. Toda peça-instrumento aparece
 * aqui uma vez, na luz do tema atual, para que o Cockpit seja aprovado como
 * SISTEMA antes de tocar em qualquer tela real. Se um componente fica feio aqui,
 * ele está feio em todo lugar — e essa é justamente a economia da Fase 1.
 *
 * Alcançável por `G+d` e pela paleta; fica fora da rail (é ferramenta de dev).
 */

import { useState } from "react";
import {
  Activity,
  Flame,
  HeartPulse,
  Landmark,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { PageContainer, PageHeader, Button } from "../../design-system/primitives";
import { StatTile, HeroCard, SummaryCard, Val } from "../../design-system/cards";
import { Sparkline } from "../../design-system/charts";
import {
  SegBar,
  BarSpark,
  Ring,
  StatusList,
  Heatmap,
  Terminal,
  Chip,
  SegToggle,
  BankTile,
  SphereHeader,
  MonoLabel,
  Led,
  type HeatCell,
} from "../../design-system/instruments";
import { NexusMark } from "../../design-system/NexusMark";

const SPARK = [0.2, 0.35, 0.3, 0.5, 0.45, 0.62, 0.58, 0.7, 0.66, 0.82, 0.9];
const BARS = [0.3, 0.6, 0.45, 0.8, 0.7, 0.9, 0.55, 0.4, 0.75, 1, 0.65, 0.85];

/** Uma grade de 12 semanas × 7 dias com valores pseudo-variados (determinístico). */
const HEAT: HeatCell[] = Array.from({ length: 12 * 7 }, (_, i) => {
  const v = ((i * 37) % 100) / 100;
  return { value: i % 11 === 0 ? null : v, title: `célula ${i}` };
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <MonoLabel>{title}</MonoLabel>
        <span className="h-px flex-1 bg-[var(--border-subtle)]" />
      </div>
      {children}
    </section>
  );
}

export function DesignSystemScreen() {
  const [flow, setFlow] = useState<"aporte" | "resgate">("aporte");
  const [view, setView] = useState<"mes" | "semana" | "dia">("mes");
  const [bank, setBank] = useState("nubank");
  const [chip, setChip] = useState<string | null>("acoes");

  return (
    <div className="nx-page nx-enter min-h-full pb-16">
      <PageHeader
        title="Cockpit — Design System"
        subtitle="O banco de provas da linguagem visual v1.3. Toda peça-instrumento, uma vez."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost">Ghost</Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="primary" icon={TrendingUp}>
              Primário
            </Button>
          </div>
        }
      />

      <PageContainer>
        {/* ===== A MARCA ===== */}
        <Section title="Marca — SINAL-N">
          <div className="flex flex-wrap items-center gap-8 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
            <div className="flex flex-col items-center gap-2">
              <NexusMark size={64} plate glow />
              <MonoLabel>plate + glow</MonoLabel>
            </div>
            <div className="flex flex-col items-center gap-2">
              <NexusMark size={48} plate />
              <MonoLabel>plate 48</MonoLabel>
            </div>
            <div className="flex flex-col items-center gap-2">
              <NexusMark size={28} />
              <MonoLabel>rail 28</MonoLabel>
            </div>
            <div className="flex flex-col items-center gap-2">
              <NexusMark size={16} />
              <MonoLabel>tray 16</MonoLabel>
            </div>
          </div>
        </Section>

        {/* ===== PALETA ===== */}
        <Section title="Paleta">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ["--bg", "fundo"],
              ["--panel", "painel"],
              ["--panel2", "painel2"],
              ["--line", "linha"],
              ["--phos", "fósforo"],
              ["--amb", "âmbar"],
              ["--red", "vermelho"],
              ["--cy", "ciano"],
              ["--vi", "violeta"],
              ["--tx1", "texto1"],
              ["--tx2", "texto2"],
              ["--tx3", "texto3"],
            ].map(([varName, label]) => (
              <div key={varName} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2">
                <div className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)]" style={{ background: `var(${varName})` }} />
                <div className="mt-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{label}</div>
                <div className="font-mono text-[9px] text-[var(--text-tertiary)]">{varName}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ===== MEDIDORES ===== */}
        <Section title="Medidores — SegBar / Ring / BarSpark / Sparkline">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div>
                <MonoLabel>SegBar — substitui o velocímetro</MonoLabel>
                <SegBar value={0.72} className="mt-2" />
              </div>
              <SegBar value={0.34} color="var(--amb)" />
              <SegBar value={0.92} color="var(--cy)" />
              <SegBar value={0.5} color="var(--vi)" segments={30} height={14} />
            </div>
            <div className="flex flex-wrap items-center gap-6 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <Ring value={0.68} label="dia" />
              <Ring value={0.4} size={88} color="var(--cy)" label="ano" />
              <div className="flex flex-col gap-2">
                <MonoLabel>BarSpark</MonoLabel>
                <BarSpark data={BARS} width={160} height={44} />
                <MonoLabel>Sparkline</MonoLabel>
                <Sparkline data={SPARK} width={160} height={44} />
              </div>
            </div>
          </div>
        </Section>

        {/* ===== STAT TILES ===== */}
        <Section title="StatTile — o número com o vivo obrigatório">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={Flame} label="Sequência" value="34" unit="dias" seg={0.7} delta={{ value: 3 }} />
            <StatTile icon={HeartPulse} label="Hoje" value="4/6" ring={4 / 6} tone="sphere" />
            <StatTile icon={Wallet} label="Patrimônio" value="8.200" unit="R$" spark={SPARK} tone="cyan" />
            <StatTile icon={Activity} label="Semanas perfeitas" value="12" seg={0.85} tone="violet" />
          </div>
        </Section>

        {/* ===== HERO + SUMMARY ===== */}
        <Section title="HeroCard + SummaryCard">
          <div className="grid gap-4 lg:grid-cols-2">
            <HeroCard label="Nexus Score" value="72" unit="/100" aside={<Ring value={0.72} size={72} />}>
              <SegBar value={0.72} className="mt-4" />
            </HeroCard>
            <SummaryCard>
              nos dias em que você <Val>medita</Val>, a chance de cumprir <Val tone="cyan">ler 20 páginas</Val> sobe de{" "}
              <Val tone="warning">41%</Val> para <Val tone="success">78%</Val> (últimos 60 dias).
            </SummaryCard>
          </div>
        </Section>

        {/* ===== STATUS LIST ===== */}
        <Section title="StatusList — telemetria de Esferas">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <StatusList
              rows={[
                { icon: HeartPulse, label: "Saúde", value: "4/6", tone: "success", progress: 4 / 6 },
                { icon: Wallet, label: "Finanças", value: "R$ 8.200", tone: "cyan", progress: 0.9 },
                { icon: Target, label: "Carreira", value: "2/5", tone: "amber", progress: 0.4 },
                { icon: Activity, label: "Estudos", value: "3h", tone: "violet", progress: 0.55 },
                { icon: Landmark, label: "Casa", value: "—", tone: "muted", progress: 0 },
              ]}
            />
          </div>
        </Section>

        {/* ===== HEATMAP ===== */}
        <Section title="Heatmap — intensidade por célula">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <Heatmap cells={HEAT} columns={12} color="var(--sphere)" />
          </div>
        </Section>

        {/* ===== TERMINAL ===== */}
        <Section title="Terminal — o painel de operação (base do aporte)">
          <Terminal title="Aporte" icon={Wallet} tone="cyan" right={<Led tone="cyan" />}>
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <MonoLabel>Fluxo</MonoLabel>
                <div className="mt-2">
                  <SegToggle
                    tone="cyan"
                    value={flow}
                    onChange={setFlow}
                    options={[
                      { value: "aporte", label: "Aporte" },
                      { value: "resgate", label: "Resgate" },
                    ]}
                  />
                </div>
              </div>
              <div>
                <MonoLabel>Contas</MonoLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {["Nubank", "BTG", "Itaú", "Inter"].map((b) => (
                    <BankTile
                      key={b}
                      name={b}
                      balance={"R$ 1.500"}
                      selected={bank === b.toLowerCase()}
                      onClick={() => setBank(b.toLowerCase())}
                    />
                  ))}
                  <BankTile name="conta" add onClick={() => {}} />
                </div>
              </div>
            </div>
          </Terminal>
        </Section>

        {/* ===== CHIPS + TOGGLES ===== */}
        <Section title="Chip / SegToggle">
          <div className="flex flex-wrap items-center gap-6 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex flex-wrap gap-2">
              {[
                ["acoes", "Ações"],
                ["fii", "FIIs"],
                ["rf", "Renda Fixa"],
                ["cripto", "Cripto"],
              ].map(([id, label]) => (
                <Chip key={id} tone="cyan" active={chip === id} onClick={() => setChip(id)}>
                  {label}
                </Chip>
              ))}
            </div>
            <SegToggle
              value={view}
              onChange={setView}
              options={[
                { value: "mes", label: "Mês" },
                { value: "semana", label: "Semana" },
                { value: "dia", label: "Dia" },
              ]}
            />
          </div>
        </Section>

        {/* ===== SPHERE HEADER ===== */}
        <Section title="SphereHeader — o cabeçalho tingido">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" style={{ ["--sphere" as string]: "var(--sphere-financas)" }}>
            <SphereHeader
              icon={Wallet}
              title="Finanças"
              subtitle="Patrimônio, aportes e objetivos"
              tabs={[
                { id: "painel", label: "Painel", icon: Activity },
                { id: "aportes", label: "Aportes", icon: Wallet },
                { id: "objetivos", label: "Objetivos", icon: Target },
              ]}
              activeTab="painel"
              onTab={() => {}}
              actions={<Button variant="primary" icon={Wallet}>Aportar</Button>}
            />
          </div>
        </Section>
      </PageContainer>
    </div>
  );
}
