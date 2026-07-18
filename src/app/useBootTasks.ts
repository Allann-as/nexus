/**
 * As tarefas de abertura do app — a dívida declarada do M4.5.
 *
 * Ao subir, o NEXUS congela o Nexus Score dos dias fechados (ADR-0039) e
 * sincroniza conquistas e temporadas (ADR-0038): assim o histórico e a galeria
 * ficam corretos independente de qual tela o usuário abrir primeiro, e a
 * celebração do que caiu acontece na hora certa — não só quando ele entra em
 * Conquistas.
 *
 * Tudo é best-effort: uma falha aqui nunca derruba a UI (o boot não pode
 * depender do BI). Roda UMA vez por sessão.
 */

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { autoBackup, freezeDailyScores, syncAchievements, syncChallenges } from "../lib/ipc";
import { useToasts } from "../stores/toasts";

export function useBootTasks() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        await freezeDailyScores();
        const [unlocked, completed] = await Promise.all([
          syncAchievements(),
          syncChallenges(),
        ]);

        // Celebração de tom adulto: um toast sóbrio por evento, sem confete.
        for (const a of unlocked ?? []) {
          push("success", `Conquista desbloqueada — ${a.title}`);
        }
        for (const c of completed ?? []) {
          push("success", `Temporada vencida — ${c.title}`);
        }

        qc.invalidateQueries({ queryKey: ["gamification"] });
        qc.invalidateQueries({ queryKey: ["challenges"] });
        qc.invalidateQueries({ queryKey: ["score-history"] });
      } catch {
        // Boot best-effort: o BI atualiza na próxima abertura de tela.
      }

      // O auto-backup diário (M5): cria no máximo um snapshot por dia, na
      // primeira abertura. Separado do try acima de propósito — uma falha do BI
      // não pode cancelar o backup, e vice-versa. Silencioso quando não há nada a
      // fazer; um toast sóbrio quando de fato guarda o dia.
      try {
        const made = await autoBackup();
        if (made) {
          push("success", "Backup do dia criado");
          qc.invalidateQueries({ queryKey: ["backup-status"] });
        }
      } catch {
        // Best-effort: a próxima abertura tenta de novo.
      }
    })();
  }, [qc, push]);
}
