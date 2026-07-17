/**
 * A tela de uma Esfera: header tingido + tabs pill.
 *
 * Nada de sidebar interna (§2.2). A Esfera é um lugar, não uma pasta: você entra,
 * e o header já diz onde você está pela cor antes de você ler o nome.
 *
 * O QUE cada tab mostra depende do `template` — e é só isso que o template
 * decide. As tabs especializadas (checkpoints da Saúde, aportes das Finanças,
 * biblioteca dos Estudos) chegam no M3.5/M4; aqui elas já aparecem desabilitadas
 * com o marco em que chegam. Uma tab que promete e abre vazia é pior que uma tab
 * que diz honestamente "M3.5".
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Settings2 } from "lucide-react";

import {
  getArea,
  listAccounts,
  sphereOverview,
  toNexusError,
  type Area,
  type SphereCard,
  type Template,
} from "../../lib/ipc";
import { Button, cx } from "../../design-system/primitives";
import { SphereIcon } from "../hub/SphereIcon";
import { GoalsList } from "../goals/GoalsList";
import { SphereDashboard } from "./SphereDashboard";
import { HealthDashboard } from "./HealthDashboard";
import { HealthCheckpoints } from "./HealthCheckpoints";
import { HealthTraining } from "./HealthTraining";
import { HealthExams } from "./HealthExams";
import { FinanceDashboard } from "../finance/FinanceDashboard";
import { ContributionsTab } from "../finance/ContributionsTab";
import { AporteModal } from "../finance/AporteModal";
import { CaixinhasTab } from "../fin-goals/CaixinhasTab";
import { CareerContent } from "../career/CareerContent";
import { StudiesContent } from "../studies/StudiesContent";
import { SimpleContent } from "../simple/SimpleContent";

/**
 * As tabs de cada template.
 *
 * `milestone` = o marco em que a tab ganha conteúdo. `undefined` = já funciona.
 */
interface Tab {
  key: string;
  label: string;
  milestone?: string;
}

const TABS: Record<Template, Tab[]> = {
  health: [
    { key: "dashboard", label: "Painel" },
    { key: "goals", label: "Metas" },
    { key: "checkpoints", label: "Checkpoints" },
    { key: "training", label: "Treino" },
    { key: "exams", label: "Exames" },
  ],
  finance: [
    { key: "dashboard", label: "Painel" },
    { key: "goals", label: "Metas" },
    { key: "contributions", label: "Aportes" },
    // A alocação (donut + Saúde Financeira) mora no Painel — é o resumo da
    // Esfera. Uma tab só para ela repetiria o que o Painel já mostra.
  ],
  fin_goals: [
    { key: "boxes", label: "Caixinhas" },
    { key: "goals", label: "Metas" },
  ],
  career: [
    { key: "dashboard", label: "Painel" },
    { key: "goals", label: "Metas" },
    { key: "projects", label: "Projetos" },
    { key: "skills", label: "Habilidades" },
  ],
  studies: [
    { key: "dashboard", label: "Painel" },
    { key: "goals", label: "Metas" },
    { key: "languages", label: "Idiomas" },
    { key: "college", label: "Faculdade" },
    { key: "courses", label: "Cursos" },
    { key: "library", label: "Biblioteca" },
  ],
  simple: [
    { key: "dashboard", label: "Painel" },
    { key: "goals", label: "Metas" },
    { key: "agenda", label: "Agenda" },
    { key: "checklists", label: "Checklists" },
  ],
};

export function SphereScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("dashboard");

  const area = useQuery({ queryKey: ["areas", id], queryFn: () => getArea(id) });
  // O card já vem calculado pelo Hub; reusar a mesma query evita uma segunda
  // rota no backend para dizer a mesma coisa, e o cache do TanStack faz a
  // navegação Hub → Esfera ser instantânea.
  const overview = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview });
  const card = overview.data?.find((s) => s.id === id);

  if (area.error) {
    return (
      <div className="nx-page h-full p-8">
        <div className="rounded-[var(--radius-lg)] border border-[var(--danger)] bg-[var(--bg-surface)] p-4">
          <p className="text-[13px] text-[var(--danger)]">{toNexusError(area.error).message}</p>
        </div>
      </div>
    );
  }

  const sphere = area.data;
  const tabs = sphere ? TABS[sphere.template] : [];
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];

  return (
    <div
      className="nx-page nx-enter h-full overflow-y-auto"
      // Uma variável, e a tela inteira se tinge: a aurora do `.nx-page`, os
      // cards, o gráfico, o checkbox. Nenhum deles sabe que Esferas existem.
      style={sphere ? ({ "--sphere": sphere.color } as React.CSSProperties) : undefined}
    >
      <div className="mx-auto max-w-[1100px] px-8 pt-8 pb-12">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft size={13} />
          Hub
        </button>

        <header className="mt-4 flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div
              className="grid size-14 place-items-center rounded-[var(--radius-lg)]"
              style={{
                background: "color-mix(in srgb, var(--sphere) 14%, transparent)",
                boxShadow: "0 0 32px color-mix(in srgb, var(--sphere) 18%, transparent)",
              }}
            >
              {sphere && (
                <SphereIcon name={sphere.icon} size={26} style={{ color: "var(--sphere)" }} />
              )}
            </div>
            <div>
              <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.03em]">
                {sphere?.name ?? "…"}
              </h1>
              {sphere && (
                <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
                  {TEMPLATE_LABEL[sphere.template]}
                </p>
              )}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon={Settings2}
            onClick={() => navigate("/areas")}
          >
            Editar
          </Button>
        </header>

        {/* ===== tabs pill ===== */}
        <nav className="mt-6 flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => !t.milestone && setTab(t.key)}
              disabled={!!t.milestone}
              title={t.milestone ? `Chega no ${t.milestone}` : undefined}
              className={cx(
                "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium",
                "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
                "border",
                t.key === active?.key
                  ? "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--text-primary)]"
                  : t.milestone
                    ? "cursor-not-allowed border-transparent text-[var(--text-tertiary)] opacity-60"
                    : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
              )}
            >
              {t.label}
              {t.milestone && (
                <span className="rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-tertiary)]">
                  {t.milestone}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-6">
          {sphere && (
            <SphereContent
              sphere={sphere}
              card={card}
              tab={active?.key ?? "dashboard"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * O que cada tab de cada template mostra.
 *
 * O `template` da Esfera decide o conteúdo; o `SphereScreen` só desenha o header
 * e as pílulas. "Metas" é universal (chega pela Esfera dona); o resto é a tela
 * que o template promete. Um `default` cai no painel genérico — é o que uma
 * Esfera ainda sem tela especializada mostra.
 */
function SphereContent({
  sphere,
  card,
  tab,
}: {
  sphere: Area;
  card: SphereCard | undefined;
  tab: string;
}) {
  if (tab === "goals") return <GoalsList areaId={sphere.id} />;

  if (sphere.template === "health") {
    if (tab === "checkpoints") return <HealthCheckpoints areaId={sphere.id} />;
    if (tab === "training") return <HealthTraining areaId={sphere.id} colour={sphere.color} />;
    if (tab === "exams") return <HealthExams />;
    return <HealthDashboard sphere={sphere} card={card} />;
  }

  if (sphere.template === "finance") {
    return <FinanceContent tab={tab} />;
  }

  if (sphere.template === "fin_goals") {
    return <CaixinhasTab areaId={sphere.id} />;
  }

  if (sphere.template === "career") {
    return <CareerContent areaId={sphere.id} tab={tab} />;
  }

  if (sphere.template === "studies") {
    return <StudiesContent areaId={sphere.id} tab={tab} />;
  }

  if (sphere.template === "simple") {
    return <SimpleContent sphere={sphere} card={card} tab={tab} />;
  }

  return <SphereDashboard sphere={sphere} card={card} />;
}

/**
 * As Finanças, com o modal de aporte compartilhado entre o Painel e a lista.
 *
 * O modal vive AQUI e não em cada tab: abrir um aporte do Painel e da lista tem
 * que ser o mesmo gesto, e um modal por tab teria dois estados a sincronizar.
 */
function FinanceContent({ tab }: { tab: string }) {
  const client = useQueryClient();
  const [aporte, setAporte] = useState(false);
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["finance"] });
    setAporte(false);
  };

  return (
    <>
      {tab === "contributions" ? (
        <ContributionsTab onAporte={() => setAporte(true)} />
      ) : (
        <FinanceDashboard onAporte={() => setAporte(true)} />
      )}
      {aporte && (
        <AporteModal accounts={accounts} onClose={() => setAporte(false)} onSaved={refresh} />
      )}
    </>
  );
}

const TEMPLATE_LABEL: Record<Template, string> = {
  health: "Esfera de saúde",
  finance: "Patrimônio e aportes",
  fin_goals: "Objetivos financeiros",
  career: "Carreira",
  studies: "Estudos",
  simple: "Agenda e checklists",
};
