/**
 * Projetos da Carreira — redesenho v1.3 (COCKPIT).
 *
 * O que havia: uma grade de cartões com o TÍTULO e nada mais, e um clique que
 * levava para `/projects`, a tela global. Ou seja, a aba "Projetos" da Esfera não
 * mostrava projeto nenhum — mostrava uma LISTA DE NOMES e um atalho para sair da
 * Esfera. Quem abria a Carreira para ver como o projeto está tinha que trocar de
 * tela, perder o contexto da Esfera e voltar.
 *
 * Agora o projeto se abre AQUI: a checklist de tarefas, o progresso, a evolução
 * dos últimos dias e a meta a que ele serve. A tela global continua existindo e
 * continua sendo a visão de TODOS os projetos do app — o que sai é a obrigação de
 * ir até lá para responder "quanto falta neste aqui".
 *
 * Três decisões de dado, todas da lente das três lições:
 *
 * 1. **A barra de progresso é a contagem, não uma estimativa.** `done/total` de
 *    tarefas, com os dois números escritos ao lado. Projeto SEM tarefa não ganha
 *    barra nenhuma: 0 de 0 não é 0% (é "ainda não há o que medir"), e uma barra
 *    vazia diria que o projeto está parado quando ele só não foi decomposto.
 *
 * 2. **A evolução diária é uma contagem por dia, com o PICO escrito.** Uma série
 *    de contagens não tem teto natural, então a altura é relativa ao pico da
 *    janela — e por isso o pico vai por extenso ao lado. Escala relativa sem o
 *    número é exatamente o que a régua de nível perdeu no ADR-0086; aqui ela fica,
 *    mas DECLARADA. Com `track`, porque zero tarefas num dia é resposta legítima e
 *    frequente, e sem o trilho o dia vazio somia (lição 2).
 *
 * 3. **Sem tarefa concluída, sem gráfico.** A janela de 14 dias só aparece quando
 *    há algo dentro dela. Catorze colunas vazias não informam que nada aconteceu;
 *    informam que o app está com defeito.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, FolderKanban, Plus, Target, X } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Checkbox } from "../../design-system/Checkbox";
import { BarSpark, Chip, MonoLabel, SegBar } from "../../design-system/instruments";
import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  createProject,
  createTask,
  deleteNode,
  linkNodes,
  listGoals,
  listNodes,
  listProjectTasks,
  nodeLinks,
  setTaskCompleted,
  unlinkNodes,
  type Task,
} from "../../lib/ipc";

/** A janela da evolução diária. Duas semanas: cabe em 84px e cobre o ritmo real. */
const JANELA_DIAS = 14;

const pad = (n: number) => String(n).padStart(2, "0");
/** O dia LOCAL de um epoch-ms como 'YYYY-MM-DD' — a convenção do backend. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * As tarefas concluídas por dia nos últimos `JANELA_DIAS`, do mais antigo ao mais
 * recente. Contagem pura: quem não fechou nada num dia tem zero, e o zero é dado.
 */
function evolucaoDiaria(tasks: Task[]): number[] {
  const hoje = new Date();
  const dias: string[] = [];
  for (let i = JANELA_DIAS - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i);
    dias.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  const porDia = new Map<string, number>(dias.map((d) => [d, 0]));
  for (const t of tasks) {
    if (t.completedAt == null) continue;
    const dia = localDay(t.completedAt);
    if (porDia.has(dia)) porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }
  return dias.map((d) => porDia.get(d) ?? 0);
}

export function CareerProjects({
  areaId,
  label,
  hint,
}: {
  areaId: string;
  label: string;
  hint: string;
}) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  const projects = useQuery({
    queryKey: ["nodes", "project", areaId],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 500 }),
  });

  const create = async () => {
    if (!title.trim()) return;
    try {
      await createProject(title.trim(), areaId);
      push("success", `${label} criado`);
      setTitle("");
      setCreating(false);
      void client.invalidateQueries({ queryKey: ["nodes", "project", areaId] });
    } catch (e) {
      pushError(e);
    }
  };

  const items = projects.data ?? [];

  return (
    <div className="nx-enter">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <MonoLabel>{label}</MonoLabel>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            Cada projeto abre aqui: a checklist, o quanto andou e a meta a que ele serve.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <span className="tabular text-[11px] text-[var(--text-tertiary)]">
              {items.length} {items.length === 1 ? "ativo" : "ativos"}
            </span>
          )}
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
            Novo
          </Button>
        </div>
      </header>

      {creating && (
        <div className="mb-4 flex gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder={`Nome do ${label.toLowerCase()}…`}
            className="h-9 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={create} disabled={!title.trim()}>
            Criar
          </Button>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={FolderKanban}
          title={`Nenhum ${label.toLowerCase()} ainda`}
          hint={hint}
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Novo
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {items.map((p) => (
            <ProjectCard key={p.id} id={p.id} title={p.title} areaId={areaId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ id, title, areaId }: { id: string; title: string; areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [aberto, setAberto] = useState(false);
  const [novaTarefa, setNovaTarefa] = useState("");
  const [ligando, setLigando] = useState(false);

  // `includeDone = true`: a checklist mostra o que já foi feito. Esconder o
  // concluído tiraria justamente a prova de que o projeto andou.
  const tarefas = useQuery({
    queryKey: ["project-tasks", id],
    queryFn: () => listProjectTasks(id, true),
  });
  const links = useQuery({ queryKey: ["node-links", id], queryFn: () => nodeLinks(id) });
  // As metas da Esfera só são buscadas quando o seletor abre — a lista não
  // aparece em tela nenhuma antes disso.
  const metas = useQuery({
    queryKey: ["goals", areaId],
    queryFn: () => listGoals(areaId),
    enabled: ligando,
  });

  const items = useMemo(() => tarefas.data ?? [], [tarefas.data]);
  const total = items.length;
  const done = items.filter((t) => t.completedAt != null).length;

  const serie = useMemo(() => evolucaoDiaria(items), [items]);
  const pico = Math.max(0, ...serie);
  const noPeriodo = serie.reduce((a, b) => a + b, 0);

  const invalida = () => {
    void client.invalidateQueries({ queryKey: ["project-tasks", id] });
    void client.invalidateQueries({ queryKey: ["nodes", "project", areaId] });
  };

  const alterna = useMutation({
    mutationFn: (t: Task) => setTaskCompleted(t.id, t.completedAt == null),
    onSuccess: invalida,
    onError: pushError,
  });

  const adiciona = useMutation({
    mutationFn: (titulo: string) => createTask({ title: titulo, areaId, projectId: id }),
    onSuccess: () => {
      setNovaTarefa("");
      invalida();
    },
    onError: pushError,
  });

  const apagaTarefa = useMutation({
    mutationFn: (taskId: string) => deleteNode(taskId),
    onSuccess: () => {
      push("success", "Tarefa excluída");
      invalida();
    },
    onError: pushError,
  });

  const apagaProjeto = useMutation({
    mutationFn: () => deleteNode(id),
    onSuccess: () => {
      push("success", "Projeto excluído");
      invalida();
      void client.invalidateQueries({ queryKey: ["node-links", id] });
    },
    onError: pushError,
  });

  const liga = useMutation({
    mutationFn: (goalId: string) => linkNodes(id, goalId, "contributes_to"),
    onSuccess: () => {
      setLigando(false);
      void client.invalidateQueries({ queryKey: ["node-links", id] });
    },
    onError: pushError,
  });

  const desliga = useMutation({
    mutationFn: (goalId: string) => unlinkNodes(id, goalId, "contributes_to"),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["node-links", id] }),
    onError: pushError,
  });

  const metasLigadas = (links.data?.outgoing ?? []).filter((l) => l.linkType === "contributes_to");
  const jaLigadas = new Set(metasLigadas.map((l) => l.nodeId));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
          <FolderKanban size={16} style={{ color: "var(--sphere)" }} />
        </span>
        <p className="min-w-0 flex-1 truncate pt-1.5 text-[14px] font-medium text-[var(--text-primary)]">
          {title}
        </p>
      </div>

      {/* O progresso É a contagem. Sem tarefa não há barra: 0 de 0 não é 0%. */}
      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="tabular font-mono text-[18px] leading-none font-semibold text-[var(--text-primary)]">
              {done}
              <span className="text-[12px] font-normal text-[var(--text-tertiary)]">/{total}</span>
            </span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {done === total ? "tudo feito" : `${total - done} em aberto`}
            </span>
          </div>
          <SegBar value={done / total} segments={Math.min(total, 20)} height={8} />
        </div>
      ) : (
        <p className="text-[11.5px] text-[var(--text-tertiary)]">
          Sem tarefas ainda — abra e escreva a primeira.
        </p>
      )}

      {/* A evolução dos 14 dias, com o PICO escrito: a altura é relativa e por
          isso a escala precisa estar na tela (ADR-0086). Sem nada concluído na
          janela, não desenha — 14 colunas vazias não são informação. */}
      {noPeriodo > 0 && (
        <div className="flex items-center gap-2.5">
          <BarSpark
            data={serie.map((v) => (pico > 0 ? v / pico : 0))}
            width={112}
            height={26}
            track
            className="shrink-0"
          />
          <span className="text-[10.5px] leading-[14px] text-[var(--text-tertiary)]">
            {noPeriodo} {noPeriodo === 1 ? "tarefa" : "tarefas"} em {JANELA_DIAS} dias
            <br />
            <span className="tabular">pico de {pico}/dia</span>
          </span>
        </div>
      )}

      {/* As metas a que este projeto serve — o link `contributes_to` do M4.6. */}
      {(metasLigadas.length > 0 || ligando) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {metasLigadas.map((m) => (
            <Chip key={m.nodeId} icon={Target} onClick={() => desliga.mutate(m.nodeId)}>
              {m.title}
              <X size={11} className="opacity-60" />
            </Chip>
          ))}
        </div>
      )}

      {ligando && (
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5">
          <MonoLabel>Ligar a uma meta</MonoLabel>
          {(metas.data ?? []).filter((g) => !jaLigadas.has(g.id)).length === 0 ? (
            <p className="text-[11.5px] text-[var(--text-tertiary)]">
              {metas.isLoading ? "Carregando…" : "Nenhuma meta disponível nesta Esfera."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(metas.data ?? [])
                .filter((g) => !jaLigadas.has(g.id))
                .map((g) => (
                  <Chip key={g.id} onClick={() => liga.mutate(g.id)}>
                    {g.title}
                  </Chip>
                ))}
            </div>
          )}
        </div>
      )}

      {/* A checklist mora atrás de um clique porque um projeto de 20 tarefas
          viraria uma parede numa grade de cartões — mas o clique abre AQUI, e
          não numa outra tela. */}
      {aberto && (
        <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-2.5">
          {items.map((t) => (
            <div key={t.id} className="group flex items-center gap-2">
              <Checkbox
                checked={t.completedAt != null}
                onChange={() => alterna.mutate(t)}
                size={17}
                title={t.completedAt != null ? "Desmarcar" : "Concluir"}
              />
              <span
                className={cx(
                  "min-w-0 flex-1 truncate text-[12.5px]",
                  t.completedAt != null
                    ? "text-[var(--text-tertiary)] line-through"
                    : "text-[var(--text-secondary)]",
                )}
              >
                {t.title}
              </span>
              <ArmedDelete
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                onConfirm={() => apagaTarefa.mutate(t.id)}
                pending={apagaTarefa.isPending}
                question="Excluir esta tarefa?"
                ariaLabel={`Excluir a tarefa ${t.title}`}
              />
            </div>
          ))}

          <div className="mt-1 flex gap-2">
            <input
              value={novaTarefa}
              onChange={(e) => setNovaTarefa(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && novaTarefa.trim()) adiciona.mutate(novaTarefa.trim());
                if (e.key === "Escape") setNovaTarefa("");
              }}
              placeholder="Nova tarefa…"
              className="h-8 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 text-[12.5px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
            />
            <button
              onClick={() => novaTarefa.trim() && adiciona.mutate(novaTarefa.trim())}
              disabled={!novaTarefa.trim() || adiciona.isPending}
              aria-label="Adicionar tarefa"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] disabled:opacity-40"
            >
              <Check size={14} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAberto((v) => !v)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            <ChevronDown
              size={13}
              className={cx("transition-transform", aberto && "rotate-180")}
              aria-hidden
            />
            {aberto ? "Fechar" : total > 0 ? "Ver tarefas" : "Adicionar tarefas"}
          </button>
          {!ligando && (
            <button
              onClick={() => setLigando(true)}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11.5px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              <Target size={12} aria-hidden />
              Ligar a meta
            </button>
          )}
        </div>
        <ArmedDelete
          onConfirm={() => apagaProjeto.mutate()}
          pending={apagaProjeto.isPending}
          question="Excluir este projeto?"
          ariaLabel={`Excluir o projeto ${title}`}
        />
      </div>
    </Card>
  );
}
