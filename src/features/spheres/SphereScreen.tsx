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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Settings2 } from "lucide-react";

import {
  countNodes,
  getArea,
  listAccounts,
  sphereOverview,
  toNexusError,
  type Area,
  type SphereCard,
  type Template,
} from "../../lib/ipc";
import { Button } from "../../design-system/primitives";
import { SphereIcon } from "../hub/SphereIcon";
import { SphereNav } from "./SphereNav";
import { SPHERE_SECTIONS, resolveIndicator, type IndicatorView } from "./sections";
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

export function SphereScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const area = useQuery({ queryKey: ["areas", id], queryFn: () => getArea(id) });
  // O card já vem calculado pelo Hub; reusar a mesma query evita uma segunda
  // rota no backend para dizer a mesma coisa, e o cache do TanStack faz a
  // navegação Hub → Esfera ser instantânea.
  const overview = useQuery({ queryKey: ["spheres", "overview"], queryFn: sphereOverview });
  const card = overview.data?.find((s) => s.id === id);

  // Os números dos micro-indicadores. `active_goals` é universal (toda Esfera tem
  // "Metas"); os outros dois só valem a viagem no template que os mostra.
  const goals = useQuery({
    queryKey: ["nodes", "count", { kind: "goal", status: "active", areaId: id }],
    queryFn: () => countNodes({ kind: "goal", status: "active", areaId: id }),
    enabled: !!id,
  });
  const boxes = useQuery({
    queryKey: ["nodes", "count", { kind: "fin_goal", status: "active", areaId: id }],
    queryFn: () => countNodes({ kind: "fin_goal", status: "active", areaId: id }),
    enabled: !!id && area.data?.template === "fin_goals",
  });
  const reading = useQuery({
    queryKey: ["nodes", "count", { kind: "book", status: "active", areaId: id }],
    queryFn: () => countNodes({ kind: "book", status: "active", areaId: id }),
    enabled: !!id && area.data?.template === "studies",
  });
  const subjects = useQuery({
    queryKey: ["nodes", "count", { kind: "subject", status: "active", areaId: id }],
    queryFn: () => countNodes({ kind: "subject", status: "active", areaId: id }),
    enabled: !!id && area.data?.template === "studies",
  });

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
  const sections = sphere ? SPHERE_SECTIONS[sphere.template] : [];
  // A seção ativa vive no URL (`?s=`): deep-linkável, sobrevive ao voltar, e é o
  // que deixa o Ctrl+K abrir uma seção direto. Uma chave inválida cai na primeira.
  const requested = params.get("s");
  const active = sections.find((s) => s.key === requested)?.key ?? sections[0]?.key ?? "dashboard";
  const setActive = (key: string) => {
    const next = new URLSearchParams(params);
    next.set("s", key);
    // replace: as setas trocam de seção rápido; empilhar histórico a cada tecla
    // encheria o "voltar" de passos que ninguém pediu.
    setParams(next, { replace: true });
  };

  const indicatorData = {
    card,
    activeGoals: goals.data ?? 0,
    activeBoxes: boxes.data ?? 0,
    reading: reading.data ?? 0,
    activeSubjects: subjects.data ?? 0,
  };
  const indicators: Record<string, IndicatorView | null> = {};
  for (const s of sections) indicators[s.key] = resolveIndicator(s.indicator, indicatorData);

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

        {sphere && (
          <div className="mt-6">
            <SphereNav
              sections={sections}
              active={active}
              indicators={indicators}
              onSelect={setActive}
            />
          </div>
        )}

        {/* A troca de seção anima o conteúdo (fade + 6px). A `key` remonta o
            bloco, disparando a keyframe; `prefers-reduced-motion` a corta. */}
        <div className="mt-6">
          {sphere && (
            <div key={active} className="nx-section-enter">
              <SphereContent sphere={sphere} card={card} tab={active} />
            </div>
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
