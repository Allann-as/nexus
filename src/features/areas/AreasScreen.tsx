/**
 * Esferas — a tela de gerência.
 *
 * Aqui se CRIA, renomeia e arquiva. Quem quer USAR uma Esfera vai pelo Hub, que
 * é a tela bonita; esta é a gaveta de ferramentas.
 *
 * Esferas se arquivam, nunca se apagam: um DELETE levaria junto, por CASCADE,
 * todo node que aponta para elas — anos de notas e projetos. Regra 4 da
 * constituição.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Archive, ArrowRight, Check, Layers, Lock, Plus } from "lucide-react";

import {
  archiveArea,
  countNodes,
  createArea,
  listAreas,
  type Area,
  type Template,
} from "../../lib/ipc";
import { Button, EmptyState, PageHeader, cx } from "../../design-system/primitives";
import { ICON_CHOICES, SphereIcon } from "../hub/SphereIcon";
import { useToasts } from "../../stores/toasts";

/**
 * A paleta do Midnight.
 *
 * Cor livre viraria um app arco-íris — e, pior, deixaria o usuário escolher um
 * cinza-chumbo que some no fundo navy. Estas convivem entre si e todas passam
 * de 3:1 de contraste sobre `--bg-surface`. As cinco primeiras são as das
 * Esferas do sistema.
 */
const PALETTE = [
  "#34D399",
  "#4D8DFF",
  "#FBBF24",
  "#EC4899",
  "#38BDF8",
  "#A78BFA",
  "#FB923C",
  "#2DD4BF",
];

export function AreasScreen() {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [creating, setCreating] = useState(false);

  const { data: areas = [], isPending } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
  });

  const archive = useMutation({
    mutationFn: archiveArea,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["spheres"] });
      qc.invalidateQueries({ queryKey: ["system-info"] });
      push("success", "Esfera arquivada — nada foi apagado");
    },
    onError: pushError,
  });

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px]">
        <PageHeader
          title="Esferas"
          subtitle="A estrutura da sua vida — tudo pertence a uma Esfera"
          actions={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Nova Esfera
            </Button>
          }
        />

        <div className="px-8 pb-12">
          {creating && <CreateWizard onDone={() => setCreating(false)} />}

          {areas.length === 0 && !isPending && !creating ? (
            <div className="h-[50vh]">
              <EmptyState
                icon={Layers}
                title="Nenhuma Esfera ativa"
                hint="As cinco Esferas do NEXUS vêm instaladas. Se todas estão arquivadas, crie uma nova — ou desarquive pelas Configurações."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Plus}
                    onClick={() => setCreating(true)}
                  >
                    Criar uma Esfera
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {areas.map((area) => (
                <AreaCard
                  key={area.id}
                  area={area}
                  onArchive={() => archive.mutate(area.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AreaCard({ area, onArchive }: { area: Area; onArchive: () => void }) {
  const navigate = useNavigate();
  const { data: count } = useQuery({
    queryKey: ["nodes", "count", { areaId: area.id }],
    queryFn: () => countNodes({ areaId: area.id }),
  });

  return (
    <div
      style={{ "--sphere": area.color } as React.CSSProperties}
      className={cx(
        "group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4",
        "transition-[transform,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(240px 120px at 90% -30%, color-mix(in srgb, var(--sphere) 16%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex items-start gap-3">
        <div
          className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)]"
          style={{ background: "color-mix(in srgb, var(--sphere) 14%, transparent)" }}
        >
          <SphereIcon name={area.icon} size={15} style={{ color: "var(--sphere)" }} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 truncate text-[13px] font-medium text-[var(--text-primary)]">
            {area.name}
            {area.isSystem && (
              <Lock
                size={10}
                className="shrink-0 text-[var(--text-tertiary)]"
                aria-label="Esfera do sistema"
              />
            )}
          </h3>
          <p className="tabular mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {count ?? "—"} {count === 1 ? "item" : "itens"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => navigate(`/sphere/${area.id}`)}
            title="Abrir"
            aria-label={`Abrir ${area.name}`}
            className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <ArrowRight size={13} />
          </button>
          <button
            onClick={onArchive}
            title="Arquivar"
            aria-label={`Arquivar ${area.name}`}
            className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--danger)]"
          >
            <Archive size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * O wizard "+ Nova Esfera": nome, cor, ícone e template.
 *
 * O template é fixo em 'simple' e o campo mostra por quê em vez de esconder a
 * escolha. Os cinco especializados são instalados pelo NEXUS: uma segunda
 * Esfera com o dashboard de Finanças partiria o patrimônio em duas telas que
 * nunca somam. O backend recusa de qualquer forma (`Template::user_creatable`)
 * — a UI só está sendo honesta sobre uma regra que já existe.
 */
function CreateWizard({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [icon, setIcon] = useState("sparkles");

  const TEMPLATE: Template = "simple";

  const create = useMutation({
    mutationFn: () => createArea(name.trim(), icon, color, TEMPLATE),
    onSuccess: (area) => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["spheres"] });
      qc.invalidateQueries({ queryKey: ["system-info"] });
      push("success", `Esfera "${area.name}" criada`);
      onDone();
    },
    onError: pushError,
  });

  const submit = () => {
    if (!name.trim() || create.isPending) return;
    create.mutate();
  };

  return (
    <div
      style={{ "--sphere": color } as React.CSSProperties}
      className="nx-enter mb-5 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      {/* O preview: a Esfera já aparece com a cara que vai ter. Escolher cor
          numa fileira de bolinhas é escolher no escuro. */}
      <div
        className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4"
        style={{
          background:
            "linear-gradient(135deg, var(--bg-surface), color-mix(in srgb, var(--sphere) 12%, var(--bg-surface)))",
        }}
      >
        <div
          className="grid size-11 place-items-center rounded-[var(--radius-md)]"
          style={{ background: "color-mix(in srgb, var(--sphere) 16%, transparent)" }}
        >
          <SphereIcon name={icon} size={20} style={{ color: "var(--sphere)" }} />
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onDone();
          }}
          placeholder="Nome da Esfera (ex: Espiritualidade)"
          className="w-full bg-transparent text-[17px] font-semibold tracking-[-0.02em] text-[var(--text-primary)] outline-none placeholder:font-normal placeholder:text-[var(--text-tertiary)]"
        />
      </div>

      <div className="space-y-4 px-5 py-4">
        <Field label="Cor">
          <div className="flex flex-wrap items-center gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Cor ${c}`}
                className={cx(
                  "grid size-6 place-items-center rounded-full transition-transform duration-[var(--dur-fast)] ease-[var(--ease)]",
                  color === c ? "scale-110" : "hover:scale-110",
                )}
                style={{
                  background: c,
                  boxShadow: color === c ? `0 0 12px ${c}80` : undefined,
                }}
              >
                {color === c && <Check size={12} className="text-black/70" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Ícone">
          <div className="flex flex-wrap items-center gap-1.5">
            {ICON_CHOICES.map((i) => (
              <button
                key={i}
                onClick={() => setIcon(i)}
                aria-label={i}
                title={i}
                className={cx(
                  "grid size-8 place-items-center rounded-[var(--radius-md)] border transition-colors duration-[var(--dur-fast)]",
                  icon === i
                    ? "border-[color-mix(in_srgb,var(--sphere)_50%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_12%,transparent)] text-[var(--sphere)]"
                    : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
                )}
              >
                <SphereIcon name={i} size={15} />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Template">
          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2.5">
            <p className="text-[12px] font-medium text-[var(--text-primary)]">
              Agenda simples
            </p>
            <p className="mt-0.5 text-[11px] leading-[17px] text-[var(--text-tertiary)]">
              Compromissos com data e hora, checklists e hábitos linkados. As
              Esferas com painel especializado (Saúde, Finanças, Objetivos,
              Carreira, Estudos) já vêm instaladas — duplicá-las dividiria os
              mesmos dados em duas telas.
            </p>
          </div>
        </Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!name.trim() || create.isPending}
        >
          {create.isPending ? "Criando…" : "Criar Esfera"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-[56px] shrink-0 pt-1.5 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
