/**
 * O anfitrião global do aporte.
 *
 * Vive no Shell, acima de toda rota, para o Ctrl+K ("aportar 500 no btg") abrir
 * o aporte de qualquer lugar do app (ver `stores/aporte`). Quando fechado, não
 * custa nada — nem carrega as contas — porque nada monta com o store fechado.
 *
 * O que ele mostra é o MESMO `AporteTerminal` da aba "Aportes", dentro de um
 * modal (v1.3, fase 4). Antes eram dois formulários: um modal enxuto aqui e o
 * da tela. Dois formulários para a mesma operação divergem no dia em que só um
 * ganha um campo — e o que o modal não tinha era justamente o impacto ao vivo,
 * ou seja, o Ctrl+K era o caminho CEGO de lançar dinheiro.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Modal } from "../../design-system/Modal";
import { useAporte } from "../../stores/aporte";
import { financeOverview, listAccounts } from "../../lib/ipc";
import { AporteTerminal } from "./AporteTerminal";

export function AporteHost() {
  const { open, defaults, close } = useAporte();
  const client = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
    // Só busca quando o modal vai abrir: no idle o host é de graça.
    enabled: open,
  });
  const { data: overview } = useQuery({
    queryKey: ["finance", "overview"],
    queryFn: financeOverview,
    enabled: open,
  });

  if (!open) return null;

  return (
    <Modal onClose={close}>
      <AporteTerminal
        accounts={accounts}
        overview={overview}
        defaults={defaults}
        onCancel={close}
        onSaved={() => {
          void client.invalidateQueries({ queryKey: ["finance"] });
          // Vindo do Ctrl+K, o gesto é "lançar e voltar ao que eu fazia": o
          // modal fecha. Na aba de Aportes o Terminal fica, porque ali lançar
          // em sequência é o trabalho.
          close();
        }}
      />
    </Modal>
  );
}
