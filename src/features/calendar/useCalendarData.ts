/**
 * Os dados do calendário: as ocorrências da janela, os choques dela, e a
 * extensão da materialização.
 *
 * Separado da tela porque são três perguntas com respostas de vidas diferentes —
 * a janela muda a cada seta, os conflitos derivam dela, e a extensão é uma
 * ESCRITA que acontece por navegar. Misturar isso no componente faria cada
 * `setState` de hover reavaliar as três.
 */

import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  eventConflicts,
  eventsRange,
  extendMaterialization,
  type Occurrence,
} from "../../lib/ipc";
import { addMonths, dayEndMs, dayStartMs } from "./grid";

/**
 * A que distância da borda a extensão dispara.
 *
 * O backend materializa 18 meses à frente da âncora de cada série. A UI não sabe
 * onde a borda está — e não precisa: pedir "materialize até 3 meses adiante do
 * que estou olhando" é idempotente e devolve 0 quase sempre. Três e não um
 * porque o gesto de navegar é rápido: quem segura a seta do mês passa por doze
 * meses antes de soltar, e a série tem que estar lá quando ele parar.
 */
const LOOKAHEAD_MONTHS = 3;

export interface CalendarWindow {
  from: string;
  to: string;
}

/** As ocorrências de uma janela de dias. */
export function useOccurrences(win: CalendarWindow) {
  return useQuery({
    queryKey: ["events", win.from, win.to],
    queryFn: () => eventsRange(win.from, win.to),
  });
}

/**
 * Os choques da janela, indexados por ocorrência.
 *
 * O backend responde pares (a, b); a tela pergunta "este bloco está em
 * conflito?". A chave é (eventId, startsAt) — o id do evento sozinho não
 * distingue uma das 78 terças, e marcar todas porque uma bateu seria pintar de
 * laranja um ano inteiro de terapia.
 */
export function useConflicts(win: CalendarWindow) {
  const fromMs = dayStartMs(win.from);
  const toMs = dayEndMs(win.to);

  const query = useQuery({
    queryKey: ["conflicts", win.from, win.to],
    queryFn: () => eventConflicts(fromMs, toMs),
  });

  const conflicted = useMemo(() => {
    const set = new Set<string>();
    for (const c of query.data ?? []) {
      set.add(occurrenceKey(c.a));
      set.add(occurrenceKey(c.b));
    }
    return set;
  }, [query.data]);

  return { conflicts: query.data ?? [], conflicted };
}

/** A chave de uma ocorrência: (evento, início). A mesma PK da tabela. */
export const occurrenceKey = (o: Pick<Occurrence, "eventId" | "startsAt">) =>
  `${o.eventId}@${o.startsAt}`;

/**
 * Estende a materialização conforme o usuário navega para longe.
 *
 * Fecha o buraco que a 0007 deixou de propósito: além do horizonte, a série
 * simplesmente não existe, e o mês 19 abriria vazio. A extensão não pode morar
 * na leitura (o pool do calendário é `query_only`), então ela mora aqui: no
 * gesto que a torna necessária.
 *
 * O `requested` guarda o mês mais distante já pedido NESTA sessão. Sem ele, ir e
 * voltar entre dois meses dispararia uma escrita a cada seta — idempotente, mas
 * uma escrita mesmo assim, e o SQLite tem UM escritor.
 */
export function useMaterializationWindow(anchor: string) {
  const client = useQueryClient();
  const requested = useRef<string>("");

  const extend = useMutation({
    mutationFn: (month: string) => extendMaterialization(month),
    onSuccess: (written) => {
      // Só invalida se algo nasceu. Invalidar a cada navegação refaria a query
      // do mês que acabou de chegar, e a resposta seria idêntica.
      if (written > 0) {
        void client.invalidateQueries({ queryKey: ["events"] });
        void client.invalidateQueries({ queryKey: ["conflicts"] });
      }
    },
    // Falhar em estender não pode virar um toast: o usuário não pediu isto, ele
    // só virou o mês. O mês aparece com o que já existe, e o erro vai para o
    // console — é um bug nosso, não uma ação dele que deu errado.
    onError: (e) => console.error("extensão da materialização falhou", e),
  });

  const horizon = useMemo(() => addMonths(anchor, LOOKAHEAD_MONTHS).slice(0, 7), [anchor]);

  const mutate = extend.mutate;
  useEffect(() => {
    if (horizon <= requested.current) return;
    requested.current = horizon;
    mutate(horizon);
  }, [horizon, mutate]);
}
