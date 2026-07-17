/**
 * Áreas — CRUD.
 *
 * Áreas são a estrutura da vida do usuário. Elas se arquivam, nunca se apagam:
 * um DELETE levaria junto, por CASCADE, todo node que aponta para elas — anos
 * de notas e projetos.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Archive, Plus, Check } from "lucide-react";

import { listAreas, createArea, archiveArea, countNodes, type Area } from "../../lib/ipc";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  cx,
} from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

/** Paleta do Aurora. Cores livres virariam um app arco-íris; estas convivem. */
const PALETTE = [
  "#7C8CF8",
  "#4ADE80",
  "#FBBF24",
  "#F87171",
  "#38BDF8",
  "#C084FC",
  "#FB923C",
  "#2DD4BF",
];

const ICONS = [
  "circle",
  "heart",
  "briefcase",
  "wallet",
  "book-open",
  "dumbbell",
  "users",
  "home",
  "sparkles",
  "graduation-cap",
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
      qc.invalidateQueries({ queryKey: ["system-info"] });
      push("success", "Área arquivada — nada foi apagado");
    },
    onError: pushError,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Áreas"
        subtitle="A estrutura da sua vida — tudo pertence a uma Área"
        actions={
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Nova área
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {creating && <CreateForm onDone={() => setCreating(false)} />}

        {areas.length === 0 && !isPending && !creating ? (
          <div className="h-[60%]">
            <EmptyState
              icon={Layers}
              title="Nenhuma área ainda"
              hint="Áreas são os grandes domínios da sua vida: Saúde, Carreira, Finanças. Tudo no NEXUS pertence a uma delas."
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  Criar a primeira
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
  );
}

function AreaCard({ area, onArchive }: { area: Area; onArchive: () => void }) {
  const { data: count } = useQuery({
    queryKey: ["nodes", "count", { areaId: area.id }],
    queryFn: () => countNodes({ areaId: area.id }),
  });

  return (
    <Card className="group relative p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 size-3 shrink-0 rounded-full"
          style={{ background: area.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {area.name}
          </h3>
          <p className="tabular mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {count ?? "—"} {count === 1 ? "item" : "itens"}
          </p>
        </div>
        <button
          onClick={onArchive}
          title="Arquivar"
          aria-label={`Arquivar ${area.name}`}
          className="shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--text-primary)]"
        >
          <Archive size={13} />
        </button>
      </div>
    </Card>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [icon, setIcon] = useState(ICONS[0]);

  const create = useMutation({
    mutationFn: () => createArea(name.trim(), icon, color),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["system-info"] });
      onDone();
    },
    onError: pushError,
  });

  const submit = () => {
    if (!name.trim() || create.isPending) return;
    create.mutate();
  };

  return (
    <Card className="mb-4 p-4">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onDone();
        }}
        placeholder="Nome da área (ex: Saúde)"
        className="w-full bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />

      <div className="mt-4 flex items-center gap-1.5">
        <span className="mr-1 text-[11px] text-[var(--text-tertiary)]">Cor</span>
        {PALETTE.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Cor ${c}`}
            className={cx(
              "flex size-5 items-center justify-center rounded-full transition-transform",
              color === c && "scale-110",
            )}
            style={{ background: c }}
          >
            {color === c && <Check size={11} className="text-black/70" />}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-[var(--text-tertiary)]">Ícone</span>
        {ICONS.map((i) => (
          <button
            key={i}
            onClick={() => setIcon(i)}
            className={cx(
              "rounded-[var(--radius-sm)] border px-2 py-0.5 text-[11px] transition-colors",
              icon === i
                ? "border-[var(--accent)] text-[var(--text-primary)]"
                : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
          >
            {i}
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={submit}
          disabled={!name.trim() || create.isPending}
        >
          {create.isPending ? "Criando…" : "Criar área"}
        </Button>
      </div>
    </Card>
  );
}
