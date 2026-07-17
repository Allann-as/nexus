/**
 * O anfitrião global do modal de aporte.
 *
 * Vive no Shell, acima de toda rota, para o Ctrl+K ("aportar 500 no btg") abrir
 * o aporte de qualquer lugar do app (ver `stores/aporte`). Quando fechado, não
 * custa nada — nem carrega as contas — porque o modal só monta com o store
 * aberto.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAporte } from "../../stores/aporte";
import { listAccounts } from "../../lib/ipc";
import { AporteModal } from "./AporteModal";

export function AporteHost() {
  const { open, defaults, close } = useAporte();
  const client = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
    // Só busca quando o modal vai abrir: no idle o host é de graça.
    enabled: open,
  });

  if (!open) return null;

  return (
    <AporteModal
      accounts={accounts}
      defaults={defaults}
      onClose={close}
      onSaved={() => {
        void client.invalidateQueries({ queryKey: ["finance"] });
        close();
      }}
    />
  );
}
