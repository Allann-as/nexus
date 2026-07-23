/**
 * O PRIMEIRO ACESSO — o onboarding (fase 9 §3).
 *
 * Sem senha cadastrada (`lock_status.configured === false`), o app NÃO abre num
 * bloqueio genérico: abre aqui, no mesmo idioma visual da tela de bloqueio, e o
 * usuário CRIA a própria senha e diz como quer ser chamado. Antes da fase 9 o app
 * semeava um PIN de fábrica; agora o primeiro acesso é do dono.
 *
 * Dois passos, tudo 100% local:
 *   1. CRIAR a senha — seis dígitos, com CONFIRMAÇÃO (digitar de novo). Se não
 *      bater, avisa e recomeça. Nada sai do dispositivo; o backend guarda só um
 *      hash com salt (nunca o PIN em claro — ver `security.rs`).
 *   2. O NOME — "como você gostaria de ser chamado?". É a MESMA fonte que a
 *      saudação de retorno lê (`settings.json`, ADR-0075), editável depois em
 *      Configurações.
 *
 * Respeita `prefers-reduced-motion` pela mesma via das outras telas (o `Starfield`
 * desenha um quadro estático; nada aqui datilografa).
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { setDisplayName, setPin, toNexusError } from "../../lib/ipc";
import { DEFAULT_DISPLAY_NAME } from "../../lib/greeting";
import { NexusMark } from "../../design-system/NexusMark";
import { Starfield } from "../../design-system/Starfield";
import { cx } from "../../design-system/primitives";
import { NumPad, PinDots } from "./pinpad";

const PIN_LEN = 6;

type Phase = "create" | "confirm" | "name";

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("create");
  const [first, setFirst] = useState("");
  const [entry, setEntry] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPin = phase === "create" || phase === "confirm";

  const commit = useCallback(
    async (pin: string, chosenName: string) => {
      setBusy(true);
      setErr(null);
      try {
        // A senha primeiro (sem `current`: não há PIN atual — é o primeiro), e só
        // então o nome. As duas são preferências de chrome, fora do banco.
        await setPin(null, pin);
        await setDisplayName(chosenName.trim());
        onDone();
      } catch (e) {
        setErr(toNexusError(e).message);
        setBusy(false);
      }
    },
    [onDone],
  );

  const pushDigit = useCallback(
    (d: string) => {
      if (!onPin || busy) return;
      setMismatch(false);
      setEntry((cur) => {
        if (cur.length >= PIN_LEN) return cur;
        const next = cur + d;
        if (next.length === PIN_LEN) {
          if (phase === "create") {
            // Guarda o primeiro e passa à confirmação.
            setFirst(next);
            window.setTimeout(() => {
              setPhase("confirm");
              setEntry("");
            }, 180);
          } else {
            // Confirmação: bateu → nome; não bateu → recomeça, avisando.
            if (next === first) {
              window.setTimeout(() => {
                setPhase("name");
                setEntry("");
              }, 180);
            } else {
              setMismatch(true);
              window.setTimeout(() => {
                setPhase("create");
                setFirst("");
                setEntry("");
              }, 600);
            }
          }
        }
        return next;
      });
    },
    [onPin, busy, phase, first],
  );

  const backspace = useCallback(() => {
    if (!onPin || busy) return;
    setEntry((c) => c.slice(0, -1));
  }, [onPin, busy]);

  // Teclado físico nas fases de PIN.
  useEffect(() => {
    if (!onPin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        pushDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPin, pushDigit, backspace]);

  return (
    <div className="nx-lock fixed inset-0 z-[100] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0">
        <Starfield color="var(--accent)" />
      </div>

      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-10">
        <NexusMark size={68} plate glow />

        {onPin ? (
          <>
            <div className="text-center">
              <p className="font-mono text-[9.5px] font-semibold tracking-[0.2em] text-[var(--accent)] uppercase">
                Passo 1 de 2
              </p>
              <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[var(--text-primary)]">
                {phase === "create" ? "Crie sua senha" : "Confirme sua senha"}
              </h1>
              <p className="mx-auto mt-2 max-w-[360px] text-[12.5px] leading-[1.55] text-[var(--text-secondary)]">
                {phase === "create"
                  ? "6 dígitos que só você conhece. Ficam guardados apenas neste computador, cifrados. Sem e-mail, sem nuvem."
                  : "Digite os mesmos 6 dígitos de novo para confirmar."}
              </p>
            </div>

            <PinDots length={PIN_LEN} filled={entry.length} error={mismatch} />

            <p
              className={cx(
                "h-4 font-mono text-[11px] tracking-[0.04em]",
                mismatch ? "text-[var(--danger)]" : "text-[var(--text-tertiary)]",
              )}
            >
              {mismatch
                ? "os PINs não bateram — vamos de novo"
                : phase === "create"
                  ? "definindo nova senha…"
                  : "confirmando…"}
            </p>

            <div className="mt-1">
              <NumPad
                onKey={pushDigit}
                onBackspace={backspace}
                onOk={() => {}}
                disabled={busy}
                okDisabled
              />
            </div>
          </>
        ) : (
          <NameStep
            name={name}
            setName={setName}
            busy={busy}
            err={err}
            onSubmit={() => {
              if (name.trim().length === 0 || busy) return;
              void commit(first, name);
            }}
          />
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 left-6 z-20 flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-tertiary)] md:left-14">
        <span className="size-[5px] rounded-full bg-[var(--success)]" />
        100% local · nada sai deste computador
      </div>
    </div>
  );
}

function NameStep({
  name,
  setName,
  busy,
  err,
  onSubmit,
}: {
  name: string;
  setName: (v: string) => void;
  busy: boolean;
  err: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center">
        <p className="font-mono text-[9.5px] font-semibold tracking-[0.2em] text-[var(--accent)] uppercase">
          Passo 2 de 2
        </p>
        <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-[var(--text-primary)]">
          Como você gostaria de ser chamado?
        </h1>
        <p className="mx-auto mt-2 max-w-[360px] text-[12.5px] leading-[1.55] text-[var(--text-secondary)]">
          Só pra deixar o NEXUS com a sua cara. Você pode mudar depois em Configurações.
        </p>
      </div>

      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        maxLength={40}
        placeholder={DEFAULT_DISPLAY_NAME}
        aria-label="Como você gostaria de ser chamado"
        data-selectable
        className="h-12 w-[300px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_70%,transparent)] px-4 text-center font-mono text-[15px] text-[var(--text-primary)] outline-none backdrop-blur-[3px] transition-colors focus:border-[var(--accent)] placeholder:text-[var(--text-tertiary)]"
      />

      <button
        type="button"
        onClick={onSubmit}
        disabled={name.trim().length === 0 || busy}
        className={cx(
          "mt-1 flex h-11 items-center gap-2 rounded-full border px-6 font-mono text-[13px] tracking-[0.06em] transition-colors duration-[var(--dur-fast)]",
          "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]",
          "hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        {busy ? "Entrando…" : "Entrar no NEXUS"}
        <ArrowRight size={16} />
      </button>

      {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}
    </div>
  );
}
