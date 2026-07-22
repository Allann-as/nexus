/**
 * A tela de bloqueio por PIN (M5.5 §3.5 — recomposta na v1.2, refeita na v1.3).
 *
 * Privacidade de TELA: impede que alguém que pega o computador desbloqueado abra
 * o NEXUS e leia a sua vida. NÃO é cifra de disco — o banco segue legível para
 * quem tem acesso à máquina (ADR-0054). O PIN nunca viaja nem é guardado em
 * claro: o backend só devolve um veredito.
 *
 * A COMPOSIÇÃO (v1.3 COCKPIT): a v1.2 era uma COLUNA centrada — marca, nome,
 * bolinhas, teclado, versão — copiada da tela de bloqueio de um app de banco.
 * Ela resolveu o problema da v1.1 (poluição), mas resolveu virando genérica: sem
 * a marca, aquela tela é a de qualquer app com PIN. O Cockpit pede o oposto — que
 * a primeira tela do app já seja o painel ligando.
 *
 * Então: SPLIT ASSIMÉTRICO. À esquerda, a IDENTIDADE — o SINAL-N, NEXUS, a
 * saudação por hora com o nome de quem está na frente, e o LOG DE BOOT em
 * terminal, uma linha por vez. À direita, a FUNÇÃO — as seis bolinhas e o teclado
 * circular, com os aros finos atrás fazendo de bisel do instrumento. Uma
 * divisória fina separa as duas: quem sou eu à esquerda, o que você faz à
 * direita.
 *
 * O LOG DE BOOT NÃO É CENÁRIO. Ele lê `system_info` — o MESMO comando da aba
 * Sobre — e diz a versão, o esquema do banco e o tamanho do ledger. Escrever
 * "núcleo OK · ledger íntegro" à mão teria sido teatro: quatro linhas afirmando
 * o que ninguém verificou, na tela onde a afirmação nunca seria contestada. As
 * linhas com dado só aparecem QUANDO o dado chega; se a leitura falha, elas não
 * aparecem — o log fica com a única linha que é verdade sempre ("aguardando
 * operador"). Ver ADR-0109.
 *
 * Tudo CSS/SVG estático — zero canvas. A única animação em idle é o cursor do
 * terminal, marcado `nx-loop` (congela com a janela sem foco) e neutralizado por
 * `prefers-reduced-motion`.
 *
 * Teclado físico E teclado numérico na tela; do 3º erro, 1s de atraso por
 * tentativa esfria o brute force manual.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Delete } from "lucide-react";

import { systemInfo, verifyPin } from "../../lib/ipc";
import { greeting, useDisplayName } from "../../lib/greeting";
import { useLock } from "../../stores/lock";
import { NexusMark } from "../../design-system/NexusMark";
import { cx } from "../../design-system/primitives";

const PIN_LEN = 6;

/** O intervalo entre uma linha do log e a seguinte. */
const BOOT_STEP_MS = 130;

/**
 * Quanto tempo o PIN errado fica VISÍVEL: o tremor das bolinhas, o vermelho
 * delas e o aro vermelho do bisel. Um número só para os três — a v1.2 tinha o
 * `450` do `setTimeout` e o `450ms` da classe do tremor escritos separados, e
 * duas cópias de uma duração divergem no dia em que só uma é ajustada.
 */
const ERROR_MS = 450;

export function LockScreen() {
  const unlockStore = useLock((s) => s.unlock);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [coolUntilMs, setCoolUntilMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const cooling = coolUntilMs > now;
  const coolLeft = cooling ? Math.ceil((coolUntilMs - now) / 1000) : 0;

  useEffect(() => {
    if (!cooling) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [cooling]);

  /* O foco entra na coluna ao montar: o listener de teclado é da janela, mas sem
     isto o primeiro Tab começaria fora da tela de bloqueio. */
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (pin: string) => {
      if (checking.current) return;
      checking.current = true;
      try {
        const ok = await verifyPin(pin);
        if (ok) {
          // O gesto de acerto: a tela dissolve, e só então o app aparece — a
          // transição é a recompensa de entrar.
          setUnlocking(true);
          window.setTimeout(() => unlockStore(), 420);
          return;
        }
        setAttempts((a) => {
          const next = a + 1;
          if (next >= 3) setCoolUntilMs(Date.now() + (next - 2) * 1000);
          return next;
        });
        setError(true);
        setEntry("");
        window.setTimeout(() => setError(false), ERROR_MS);
      } finally {
        checking.current = false;
      }
    },
    [unlockStore],
  );

  const push = useCallback(
    (digit: string) => {
      if (cooling || checking.current || unlocking) return;
      setEntry((cur) => {
        if (cur.length >= PIN_LEN) return cur;
        const next = cur + digit;
        if (next.length === PIN_LEN) void submit(next);
        return next;
      });
    },
    [cooling, unlocking, submit],
  );

  const backspace = useCallback(() => setEntry((c) => c.slice(0, -1)), []);

  /* O OK confirma o que já está digitado. Com 6 dígitos o envio é automático, de
     modo que ele serve para quem digitou menos e quer o veredito assim mesmo. */
  const confirm = useCallback(() => {
    if (cooling || checking.current || unlocking) return;
    if (entry.length === 0) return;
    void submit(entry);
  }, [cooling, unlocking, entry, submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        push(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, backspace, confirm]);

  const locked = cooling || unlocking;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={cx(
        "nx-lock fixed inset-0 z-[100] grid grid-cols-1 overflow-y-auto outline-none",
        "md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]",
        "transition-opacity duration-[400ms] ease-[var(--ease)]",
        unlocking ? "opacity-0" : "opacity-100",
      )}
    >
      <Identity />

      {/* ===== a coluna da FUNÇÃO ===== */}
      {/* `--border-strong`, e não `--border-subtle`: a dirigida no tema CLARO mediu
          a divisória em #D7DEE0 sobre um fundo #D9DEE0 — dois pontos de diferença
          num canal, ou seja, invisível. A única linha que estrutura o split
          sumia, e o que sobrava eram dois blocos flutuando. No escuro a subtle
          aparecia, que é como o defeito passou despercebido. */}
      <section className="relative flex flex-col items-center justify-center px-6 py-10 md:border-l md:border-[var(--border-strong)]">
        <BezelRings error={error} />

        <div className="relative flex flex-col items-center">
          {/* ===== as seis bolinhas ===== */}
          <div
            className="flex items-center gap-4"
            style={
              error ? { animation: `nexus-shake ${ERROR_MS}ms var(--ease)` } : undefined
            }
            role="status"
            aria-label={`${entry.length} de ${PIN_LEN} dígitos`}
          >
            {Array.from({ length: PIN_LEN }).map((_, i) => {
              const filled = i < entry.length;
              return (
                <span
                  key={i}
                  className={cx(
                    "size-3 rounded-full border transition-[background-color,border-color,transform] duration-[var(--dur-fast)]",
                    error
                      ? "border-[var(--danger)] bg-[var(--danger)]"
                      : filled
                        ? "scale-100 border-[var(--text-primary)] bg-[var(--text-primary)]"
                        : "scale-90 border-[var(--border-strong)] bg-transparent",
                  )}
                  style={
                    filled && !error
                      ? { animation: "nexus-pulse 180ms var(--ease) both" }
                      : undefined
                  }
                />
              );
            })}
          </div>

          {/* ===== o teclado numérico ===== */}
          <div className="mt-9 grid grid-cols-3 gap-4">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <PadKey key={d} onClick={() => push(d)} disabled={locked}>
                {d}
              </PadKey>
            ))}
            <PadKey onClick={backspace} disabled={locked} aria-label="Apagar">
              <Delete size={20} strokeWidth={1.8} />
            </PadKey>
            <PadKey onClick={() => push("0")} disabled={locked}>
              0
            </PadKey>
            <PadKey
              onClick={confirm}
              disabled={locked || entry.length === 0}
              aria-label="Confirmar"
              accent
            >
              <span className="text-[15px] font-semibold tracking-[0.06em]">OK</span>
            </PadKey>
          </div>

          <p
            className={cx(
              "mt-6 h-4 text-[12px]",
              attempts > 0 ? "text-[var(--danger)]" : "text-[var(--text-tertiary)]",
            )}
            role="status"
          >
            {cooling
              ? `Aguarde ${coolLeft}s antes de tentar de novo`
              : attempts > 0
                ? "PIN incorreto. Tente novamente."
                : "Digite seu PIN para desbloquear"}
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * A coluna da esquerda: quem é o app, e para quem ele está abrindo.
 *
 * A saudação usa a MESMA fonte do Hub (`greeting` + `useDisplayName`) — o nome
 * vem do `settings.json`, nunca cravado (ADR-0075). Ela é lida no momento em que
 * a cortina sobe, que é quando ela importa.
 */
function Identity() {
  const name = useDisplayName();
  const hello = useMemo(() => greeting(), []);

  return (
    <section className="flex flex-col justify-center px-8 py-10 md:px-14 lg:px-20">
      <NexusMark size={76} plate glow />

      <h1 className="mt-7 text-[26px] font-bold tracking-[0.28em] text-[var(--text-primary)]">
        NEXUS
      </h1>
      <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
        {hello}, {name}.
      </p>

      <BootLog />
    </section>
  );
}

/**
 * O log de boot — quatro linhas de terminal, uma por vez.
 *
 * A regra que ele obedece: **só entra na lista a linha que tem um dado por
 * trás**. As três primeiras vêm de `system_info`; se a chamada ainda não voltou,
 * ou falhou, elas simplesmente não existem — e a revelação começa direto na
 * última, que não depende de leitura nenhuma. É por isso que a sequência só
 * dispara quando a query ASSENTA (dado ou erro): sem isso, "aguardando operador"
 * apareceria primeiro e as linhas de dado brotariam ACIMA dele, que é o inverso
 * de um log.
 */
function BootLog() {
  const { data, isPending } = useQuery({ queryKey: ["system-info"], queryFn: systemInfo });

  const lines = useMemo(() => {
    const out: string[] = [];
    if (data) {
      out.push(`NEXUS OS v${data.appVersion}`);
      out.push(`núcleo · esquema v${data.schemaVersion}`);
      out.push(
        `ledger · ${data.ledgerCount.toLocaleString("pt-BR")} registros · ` +
          `${data.nodeCount.toLocaleString("pt-BR")} nodes`,
      );
      /* A mesma advertência que a aba "Seus dados" dá — aqui ela chega ANTES de
         qualquer clique, que é onde ela evita confundir uma dirigida com o app
         real (ADR-0048). */
      if (data.isCustomDataDir) out.push("dados de TESTE (NEXUS_DATA_DIR)");
    }
    out.push("aguardando operador");
    return out;
  }, [data]);

  const [shown, setShown] = useState(0);

  /* A dependência é a QUANTIDADE de linhas, não o array: `system_info` é
     revalidado em background pelo react-query, e depender da identidade do array
     faria o log inteiro rebobinar do zero a cada refetch. O número de linhas só
     muda quando a leitura chega (ou quando o modo dev entra) — que é exatamente
     quando rebobinar é o certo. */
  const total = lines.length;

  useEffect(() => {
    if (isPending) return;
    setShown(0);
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= total) window.clearInterval(t);
    }, BOOT_STEP_MS);
    return () => window.clearInterval(t);
  }, [isPending, total]);

  return (
    <div
      className="mt-9 flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-6 font-mono text-[12px] leading-[18px]"
      role="status"
      aria-live="polite"
    >
      {lines.slice(0, shown).map((line, i) => {
        const last = i === lines.length - 1;
        return (
          <p key={line} className="nx-section-enter flex items-center gap-2">
            <span className="text-[var(--accent)] opacity-70">&gt;</span>
            <span className={last ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}>
              {line}
            </span>
            {last && <Caret />}
          </p>
        );
      })}
    </div>
  );
}

/**
 * O cursor do terminal. Um bloco DESENHADO, não o caractere `U+258C`: o glifo de
 * meio-bloco depende da fonte ter a faixa de Block Elements e da métrica dela
 * bater com a linha, e o que sobra quando não bate é um retângulo desalinhado. Um
 * `span` com fundo é a mesma leitura em qualquer fonte.
 *
 * `nx-loop` porque ele pisca em IDLE: com a janela sem foco, o compositor para
 * (ver §A6 dos tokens). `steps(2)` termina o ciclo ACESO, então o congelamento por
 * reduced-motion deixa um cursor visível, e não um espaço vazio.
 */
function Caret() {
  return (
    <span
      aria-hidden
      className="nx-loop inline-block h-[13px] w-[7px] bg-[var(--accent)] align-middle"
      style={{ animation: "nexus-caret 1.06s steps(2, jump-none) infinite" }}
    />
  );
}

/**
 * O BISEL: três aros finos centrados atrás do teclado. Não gira, não pulsa, não
 * reage — é geometria parada, e é isso que a deixa calma. Na v1.2 eles ficavam
 * atrás da coluna inteira; aqui emolduram só o teclado, que é o que transforma
 * uma grade de botões num mostrador.
 *
 * A ÚNICA vez que eles reagem é o PIN errado: o aro fica VERMELHO por 450ms, o
 * mesmo flag que sacode as bolinhas. O erro tem que ser visível na periferia,
 * porque o olho de quem digita está no teclado, não nas bolinhas.
 *
 * O TAMANHO É RELATIVO À COLUNA, não fixo — e isso foi a dirigida que decidiu. Com
 * `640px` cravados, o aro externo era mais largo que a coluna que ele emoldura
 * (569px na janela de 1296, e 427px na largura MÍNIMA da janela): ele cruzava a
 * divisória para dentro da coluna da identidade de um lado e era cortado pela
 * borda da janela do outro — um círculo cortado lê como falha de render, não como
 * sangria. Pior: a raiz é `overflow-y-auto`, e o CSS promove o eixo X junto, de
 * modo que a sobra virava ÁREA ROLÁVEL horizontal (a armadilha do ADR-0080, já
 * documentada no `.nx-page`). `min(100%, 520px)` fecha os dois: o aro nunca é
 * maior que a coluna, e o `overflow-x: clip` da `.nx-lock` é o cinto do
 * suspensório.
 */
function BezelRings({ error }: { error: boolean }) {
  return (
    <svg
      className={cx(
        "pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(100%,520px)]",
        "-translate-x-1/2 -translate-y-1/2",
        "transition-[stroke] duration-[var(--dur-fast)] ease-[var(--ease)]",
      )}
      viewBox="0 0 600 600"
      fill="none"
      stroke={error ? "var(--danger)" : "var(--accent)"}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="300" cy="300" r="280" strokeWidth="1.4" opacity={error ? 0.5 : 0.16} />
      <circle cx="300" cy="300" r="210" strokeWidth="1.2" opacity={error ? 0.34 : 0.11} />
      <circle cx="300" cy="300" r="140" strokeWidth="1" opacity={error ? 0.22 : 0.07} />
    </svg>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  accent,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** O OK — a única tecla que se anuncia como ação. */
  accent?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "tabular grid size-16 place-items-center rounded-full border text-[22px] font-medium",
        "transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "active:scale-[0.94] disabled:pointer-events-none disabled:opacity-30",
        accent
          ? "border-transparent bg-[var(--accent)] text-white hover:bg-[var(--accent-bright)]"
          : cx(
              "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_55%,transparent)] text-[var(--text-primary)]",
              "hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)]",
            ),
      )}
    >
      {children}
    </button>
  );
}
