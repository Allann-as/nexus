/**
 * A meta anual de leitura: a matemática do ritmo e o atalho de definir a meta.
 *
 * O ritmo é determinístico (constituição §2, zero IA): compara a fração do ano
 * já vivida com a fração da meta já cumprida. Adiantado, atrasado ou no ritmo —
 * a mesma conta que a Biblioteca e o Painel mostram.
 */

import { useState } from "react";
import { Target } from "lucide-react";

import { Button } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { setReadingGoal } from "../../lib/ipc";

/** O dia do ano (1..366) de uma data. */
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  const now = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((now - start) / 86_400_000);
}

export interface Pace {
  /** Livros acima (>0) ou abaixo (<0) do esperado para o ponto do ano. */
  ahead: number;
  tone: "success" | "warning" | "sphere";
  label: string;
}

/**
 * O ritmo da meta. `expected` é a meta vezes a fração do ano decorrida; `ahead`
 * é o que já foi lido menos isso. Meio livro de folga em cada lado é o ruído —
 * abaixo dele, "no ritmo".
 */
export function computePace(finished: number, goal: number): Pace {
  const elapsed = dayOfYear(new Date()) / 365;
  const expected = goal * elapsed;
  const ahead = finished - expected;
  const n = Math.round(Math.abs(ahead));

  // "5 livros atrasado" não concorda — quem está atrasado é a pessoa, e o número
  // é a distância. "atrasado em 5 livros" diz a mesma coisa e se lê.
  if (ahead > 0.5) {
    return {
      ahead,
      tone: "success",
      label: `adiantado em ${n} ${n === 1 ? "livro" : "livros"}`,
    };
  }
  if (ahead < -0.5) {
    return {
      ahead,
      tone: "warning",
      label: `atrasado em ${n} ${n === 1 ? "livro" : "livros"}`,
    };
  }
  return { ahead, tone: "sphere", label: "no ritmo" };
}

/**
 * O atalho de definir a meta anual quando ainda não há uma. Compacto, inline —
 * digita o número e confirma, sem modal.
 */
export function SetGoalInline({ onSaved }: { onSaved: () => void }) {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || saving) return;
    setSaving(true);
    try {
      await setReadingGoal(Math.round(n));
      push("success", "Meta definida");
      onSaved();
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
        <Target size={15} style={{ color: "var(--sphere)" }} />
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        inputMode="numeric"
        placeholder="ex.: 24"
        className="tabular h-9 w-20 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
      />
      <Button variant="secondary" size="sm" onClick={submit} disabled={!value || saving}>
        Definir meta
      </Button>
    </div>
  );
}
