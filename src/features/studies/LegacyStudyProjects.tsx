/**
 * A classificação do LEGADO dos Estudos (v1.2, fase D).
 *
 * Até a v1.2, Idiomas, Faculdade e Cursos eram a mesma lista de `project` — e
 * NADA gravava a que seção cada item pertencia. Esse era o bug. A consequência
 * incômoda é que o app não tem como adivinhar agora: a informação nunca existiu.
 *
 * Então ele não adivinha — ele PERGUNTA. Esta seção lista os projetos ativos da
 * Esfera e oferece as três trilhas. Escolher uma cria a matéria equivalente e
 * ARQUIVA o projeto (nunca apaga: ele pode carregar tarefas, e arquivar preserva
 * tudo tirando só da vista). Quando não sobra nenhum, a seção some sozinha.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Languages, MonitorPlay } from "lucide-react";

import { useToasts } from "../../stores/toasts";
import {
  createSubject,
  listNodes,
  setNodeStatus,
  type Node,
  type SubjectTrack,
} from "../../lib/ipc";

const CHOICES: Array<{ track: SubjectTrack; label: string; icon: typeof Languages }> = [
  { track: "idioma", label: "Idioma", icon: Languages },
  { track: "faculdade", label: "Faculdade", icon: GraduationCap },
  { track: "curso", label: "Curso", icon: MonitorPlay },
];

export function LegacyStudyProjects({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const projects = useQuery({
    queryKey: ["nodes", "project", areaId, "legacy"],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 200 }),
  });

  const classify = useMutation({
    mutationFn: async (v: { project: Node; track: SubjectTrack }) => {
      await createSubject({
        title: v.project.title,
        areaId,
        track: v.track,
        // Um curso precisa nascer com estágio; nas outras trilhas o backend recusa.
        courseStage: v.track === "curso" ? "quero_fazer" : null,
      });
      // Arquivar, não apagar: o projeto pode ter tarefas penduradas.
      await setNodeStatus(v.project.id, "archived");
    },
    onSuccess: () => {
      push("success", "Item movido para a trilha escolhida");
      void client.invalidateQueries({ queryKey: ["nodes"] });
      void client.invalidateQueries({ queryKey: ["subjects", areaId] });
    },
    onError: pushError,
  });

  const items = projects.data ?? [];
  if (items.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <h3 className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
        Itens de antes da v1.2 — escolha a trilha
      </h3>
      <p className="mt-1.5 max-w-[560px] text-[12px] leading-[18px] text-[var(--text-secondary)]">
        Estes itens foram criados quando Idiomas, Faculdade e Cursos dividiam a mesma lista. O
        NEXUS não sabe a qual seção cada um pertence — isso nunca foi gravado, e era exatamente
        esse o problema. Escolha a trilha de cada um: o item é recriado nela e o projeto antigo é
        arquivado (nada é apagado).
      </p>

      <div className="mt-3 flex flex-col divide-y divide-[var(--border-subtle)]">
        {items.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 py-2.5"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">
              {p.title}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {CHOICES.map((c) => (
                <button
                  key={c.track}
                  onClick={() => classify.mutate({ project: p, track: c.track })}
                  disabled={classify.isPending}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors duration-[var(--dur-fast)] hover:border-[var(--sphere)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  <c.icon size={13} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
