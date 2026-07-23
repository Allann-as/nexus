/**
 * A tela de bloqueio por PIN — layout C-HUD com identidade progressiva (fase 9).
 *
 * Privacidade de TELA: impede que alguém que pega o computador desbloqueado abra
 * o NEXUS e leia a sua vida. NÃO é cifra de disco — o banco segue legível para
 * quem tem acesso à máquina (ADR-0054). O PIN nunca viaja nem é guardado em
 * claro: o backend só devolve um veredito.
 *
 * A COMPOSIÇÃO (fase 9): três faixas sobre a POEIRA ESTELAR (`Starfield`), que
 * preenche a tela de ponta a ponta.
 *
 *   1. A BARRA HUD no topo — telemetria LOCAL digitada ao vivo: a data por
 *      extenso, o "ping" (latência local medida, nunca rede), o último backup, a
 *      versão, e um relógio vivo. Ver `boot_telemetry`.
 *   2. À ESQUERDA, a IDENTIDADE — o SINAL-N, NEXUS, uma saudação GENÉRICA por hora
 *      SEM NOME, e o terminal de boot.
 *   3. À DIREITA, a FUNÇÃO — as seis bolinhas e o teclado.
 *
 * IDENTIDADE PROGRESSIVA — o ponto central. Enquanto ninguém digitou a senha,
 * NENHUM nome aparece: a saudação é só "Boa noite.". Quando o PIN correto entra,
 * ABAIXO de "aguardando operador" brotam, digitando, "operador identificado" (com
 * um Check) e "Seja bem-vindo de volta, {NOME}." — e só então, lida a saudação,
 * o app destrava. O nome vem das Configurações (`settings.json`), nunca cravado, e
 * é lido apenas no instante em que a saudação aparece: um PIN errado não vaza nada.
 *
 * Tudo respeita `prefers-reduced-motion`: sem datilografia, sem estrela cadente,
 * sem deriva — o estado final aparece de imediato (ver `prefersReducedMotion` e o
 * `Starfield`, que desenha um quadro estático).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";

import { bootTelemetry, verifyPin } from "../../lib/ipc";
import { greeting, useDisplayName } from "../../lib/greeting";
import { prefersReducedMotion } from "../../lib/motion";
import { useLock } from "../../stores/lock";
import { useUi } from "../../stores/ui";
import { NexusMark } from "../../design-system/NexusMark";
import { Starfield } from "../../design-system/Starfield";
import { cx } from "../../design-system/primitives";
import { NumPad, PinDots } from "./pinpad";

const PIN_LEN = 6;

/**
 * Quanto tempo o PIN errado fica VISÍVEL: o tremor das bolinhas, o vermelho delas
 * e o aro vermelho do bisel. Um número só para os três.
 */
const ERROR_MS = 450;

/** O respiro depois da saudação personalizada, antes de a cortina subir. */
const REVEAL_HOLD_MS = 850;

export function LockScreen() {
  const unlockStore = useLock((s) => s.unlock);
  const name = useDisplayName();
  const bgMotion = useUi((s) => s.backgroundMotion) === "on";

  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [coolUntilMs, setCoolUntilMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // O terminal de boot + a identidade progressiva. `reveal`/`fail` são estáveis;
  // `lines` muda a cada caractere digitado — por isso o handle é desestruturado,
  // para o listener de teclado não re-assinar a cada quadro da datilografia.
  const { lines: termLines, reveal: termReveal, fail: termFail } = useBootTerminal();

  const cooling = coolUntilMs > now;
  const coolLeft = cooling ? Math.ceil((coolUntilMs - now) / 1000) : 0;

  useEffect(() => {
    if (!cooling) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [cooling]);

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
          // Não destrava na hora: a identidade progressiva ROLA primeiro. O
          // terminal revela "operador identificado" + a saudação e, quando ela
          // termina, chama de volta para a cortina subir.
          setAuthed(true);
          termReveal(name, () => {
            window.setTimeout(() => {
              setUnlocking(true);
              window.setTimeout(() => unlockStore(), 420);
            }, REVEAL_HOLD_MS);
          });
          return;
        }
        setAttempts((a) => {
          const next = a + 1;
          if (next >= 3) setCoolUntilMs(Date.now() + (next - 2) * 1000);
          return next;
        });
        setError(true);
        setEntry("");
        termFail();
        window.setTimeout(() => setError(false), ERROR_MS);
      } finally {
        checking.current = false;
      }
    },
    [unlockStore, termReveal, termFail, name],
  );

  const locked = cooling || unlocking || authed;

  const push = useCallback(
    (digit: string) => {
      if (locked || checking.current) return;
      setEntry((cur) => {
        if (cur.length >= PIN_LEN) return cur;
        const next = cur + digit;
        if (next.length === PIN_LEN) void submit(next);
        return next;
      });
    },
    [locked, submit],
  );

  const backspace = useCallback(() => {
    if (locked) return;
    setEntry((c) => c.slice(0, -1));
  }, [locked]);

  const confirm = useCallback(() => {
    if (locked || checking.current) return;
    if (entry.length === 0) return;
    void submit(entry);
  }, [locked, entry, submit]);

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

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={cx(
        "nx-lock fixed inset-0 z-[100] overflow-hidden outline-none",
        "transition-opacity duration-[400ms] ease-[var(--ease)]",
        unlocking ? "opacity-0" : "opacity-100",
      )}
    >
      {/* A poeira estelar, em fósforo, preenchendo tudo atrás. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <Starfield color="var(--accent)" motion={bgMotion} />
      </div>

      <HudBar />

      <div className="relative z-10 grid h-full grid-cols-1 overflow-y-auto pt-[38px] md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Identity lines={termLines} />

        {/* ===== a coluna da FUNÇÃO ===== */}
        <section className="relative flex flex-col items-center justify-center px-6 py-10 md:border-l md:border-[color-mix(in_srgb,var(--border-strong)_60%,transparent)]">
          <div className="relative flex flex-col items-center">
            <PinDots length={PIN_LEN} filled={entry.length} error={error} success={authed} />

            <div className="mt-9">
              <NumPad
                onKey={push}
                onBackspace={backspace}
                onOk={confirm}
                disabled={locked}
                okDisabled={entry.length === 0}
              />
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

      {/* O reforço do offline — o dono gosta da mensagem. */}
      <div className="pointer-events-none absolute bottom-4 left-6 z-20 flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.1em] text-[var(--text-tertiary)] md:left-14">
        <span className="size-[5px] rounded-full bg-[var(--success)]" />
        100% local · autenticação no dispositivo
      </div>
    </div>
  );
}

/* ============================================================
   A BARRA HUD — telemetria local, digitada ao vivo
   ============================================================ */

function HudBar() {
  const { data } = useQuery({ queryKey: ["boot-telemetry"], queryFn: bootTelemetry });
  const clock = useLiveClock();

  const line = useMemo(() => {
    const now = new Date();
    const date = capitalize(
      now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }),
    );
    const short = now.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    if (!data) return `> ${date}  ·  ${short}`;
    const ping = pingText(data.pingMs);
    const backup = data.lastBackupMs ? `último backup ${agoText(data.lastBackupMs)}` : "sem backup ainda";
    return `> ${date}  ·  ${ping}  ·  ${backup}  ·  v${data.appVersion}  ·  ${short}`;
    // `data` só muda quando a telemetria chega — reconstruir a linha aí é o certo.
  }, [data]);

  const typed = useTypewriter(line);
  const done = typed.length >= line.length;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-[38px] items-center gap-3 border-b border-[color-mix(in_srgb,var(--border-subtle)_60%,transparent)] bg-[color-mix(in_srgb,var(--bg-base)_45%,transparent)] px-5 font-mono text-[10.5px] tracking-[0.06em] whitespace-nowrap text-[var(--text-tertiary)] backdrop-blur-[3px]">
      <span className="min-w-0 truncate">
        {typed}
        {done ? <Caret /> : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="size-[5px] rounded-full bg-[var(--accent)] shadow-[0_0_8px_var(--accent)]" />
        <span className="tabular">{clock}</span>
      </span>
    </div>
  );
}

/* ============================================================
   A IDENTIDADE — marca, saudação sem nome, terminal
   ============================================================ */

function Identity({ lines }: { lines: TLine[] }) {
  // A saudação por hora, SEM NOME: o nome só chega no terminal, depois do PIN.
  const hello = useMemo(() => greeting(), []);

  return (
    <section className="flex flex-col justify-center px-8 py-10 md:px-14 lg:px-20">
      <NexusMark size={76} plate glow />
      <h1 className="mt-7 text-[26px] font-bold tracking-[0.28em] text-[var(--text-primary)]">
        NEXUS
      </h1>
      <p className="mt-2 text-[14px] text-[var(--text-secondary)]">{hello}.</p>

      <BootTerminal lines={lines} />
    </section>
  );
}

/** O terminal renderiza as linhas que o driver produz — a lógica está no hook. */
function BootTerminal({ lines }: { lines: TLine[] }) {
  return (
    <div
      className="mt-9 flex min-h-[120px] flex-col gap-1.5 border-t border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)] pt-6 font-mono text-[12px] leading-[20px]"
      role="status"
      aria-live="polite"
    >
      {lines.map((l, i) => {
        const isLast = i === lines.length - 1;
        const text = l.text.slice(0, l.shown);
        const complete = l.shown >= l.text.length;

        if (l.tone === "greet") {
          // A saudação personalizada: maior/mais clara, com o nome em fósforo.
          return (
            <p key={l.id} className="nx-section-enter mt-1.5 text-[14px] font-semibold text-[var(--text-primary)]">
              {complete ? <GreetingText text={l.text} name={l.name ?? ""} /> : text}
              {isLast && complete && <Caret />}
            </p>
          );
        }

        const color =
          l.tone === "error"
            ? "text-[var(--danger)]"
            : l.tone === "wait"
              ? "text-[var(--text-secondary)]"
              : "text-[var(--text-tertiary)]";

        return (
          <p key={l.id} className="nx-section-enter flex items-center gap-2">
            <span className="text-[var(--accent)] opacity-70">&gt;</span>
            <span className={color}>{text}</span>
            {complete && l.badge && (
              <span className="flex items-center gap-1 text-[var(--text-tertiary)]">
                {" "}
                ..........{" "}
                {l.badge === "check" ? (
                  <Check size={13} strokeWidth={2.4} className="text-[var(--accent)]" />
                ) : (
                  <span className="text-[var(--accent)]">{l.badge}</span>
                )}
              </span>
            )}
            {isLast && l.tone === "wait" && complete && <Caret />}
          </p>
        );
      })}
    </div>
  );
}

/** "Seja bem-vindo de volta, Allan." com o nome em fósforo. */
function GreetingText({ text, name }: { text: string; name: string }) {
  const idx = name ? text.lastIndexOf(name) : -1;
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <b className="text-[var(--accent)]">{name}</b>
      {text.slice(idx + name.length)}
    </>
  );
}

/* ============================================================
   O DRIVER do terminal — datilografia com fila
   ------------------------------------------------------------
   As linhas entram numa FILA e são reveladas uma a uma, caractere a caractere.
   Eventos externos (PIN certo/errado) empurram linhas novas — que, por
   construção, entram SEMPRE ABAIXO das anteriores (o terminal cresce para
   baixo, como o print pede). Com o movimento desligado, cada linha aparece
   inteira de imediato.
   ============================================================ */

export interface TLine {
  id: number;
  text: string;
  shown: number;
  tone: "log" | "wait" | "greet" | "error";
  badge?: "OK" | "check";
  name?: string;
}

interface Spec {
  text: string;
  tone: TLine["tone"];
  badge?: "OK" | "check";
  name?: string;
  onDone?: () => void;
}

function useBootTerminal() {
  const [lines, setLines] = useState<TLine[]>([]);
  const queue = useRef<Spec[]>([]);
  const busy = useRef(false);
  const idc = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const started = useRef(false);

  const pump = useCallback(() => {
    if (busy.current) return;
    const spec = queue.current.shift();
    if (!spec) return;
    busy.current = true;
    const id = ++idc.current;
    const line: TLine = {
      id,
      text: spec.text,
      shown: 0,
      tone: spec.tone,
      badge: spec.badge,
      name: spec.name,
    };
    setLines((ls) => [...ls, line]);

    const finish = () => {
      busy.current = false;
      spec.onDone?.();
      pump();
    };

    if (prefersReducedMotion()) {
      setLines((ls) => ls.map((l) => (l.id === id ? { ...l, shown: l.text.length } : l)));
      window.setTimeout(finish, 0);
      return;
    }

    const step = () => {
      setLines((ls) => {
        const cur = ls.find((l) => l.id === id);
        if (!cur) return ls;
        const nextShown = cur.shown + 1;
        return ls.map((l) => (l.id === id ? { ...l, shown: nextShown } : l));
      });
    };

    let shown = 0;
    const tick = () => {
      shown += 1;
      step();
      if (shown < spec.text.length) {
        timer.current = window.setTimeout(tick, 24 + Math.random() * 24);
      } else {
        // Um respiro depois do selo (OK/Check) antes da próxima linha.
        timer.current = window.setTimeout(finish, spec.badge ? 240 : 120);
      }
    };
    timer.current = window.setTimeout(tick, 24 + Math.random() * 24);
  }, []);

  const enqueue = useCallback(
    (spec: Spec) => {
      queue.current.push(spec);
      pump();
    },
    [pump],
  );

  // A sequência de boot: dispara UMA vez. "ledger íntegro" só entra se a
  // telemetria voltou (a leitura ao núcleo funcionou) — a regra do ADR-0109:
  // uma linha por dado, nunca teatro. "aguardando operador" é sempre verdade.
  const boot = useQuery({ queryKey: ["boot-telemetry"], queryFn: bootTelemetry });
  useEffect(() => {
    if (started.current) return;
    if (boot.isPending) return; // espera a query ASSENTAR (dado ou erro)
    started.current = true;
    if (boot.data) enqueue({ text: "ledger íntegro", tone: "log", badge: "OK" });
    enqueue({ text: "aguardando operador", tone: "wait" });
  }, [boot.isPending, boot.data, enqueue]);

  const reveal = useCallback(
    (name: string, onComplete: () => void) => {
      enqueue({ text: "operador identificado", tone: "log", badge: "check" });
      enqueue({
        text: `Seja bem-vindo de volta, ${name}.`,
        tone: "greet",
        name,
        onDone: onComplete,
      });
    },
    [enqueue],
  );

  const fail = useCallback(() => {
    enqueue({ text: "senha incorreta", tone: "error" });
    window.setTimeout(() => {
      setLines((ls) => ls.filter((l) => l.tone !== "error"));
    }, ERROR_MS + 200);
  }, [enqueue]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { lines, reveal, fail };
}

/* ============================================================
   Peças pequenas
   ============================================================ */

/** Datilografa um texto; com o movimento desligado, entrega-o inteiro. */
function useTypewriter(text: string): string {
  const [shown, setShown] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!text) {
      setShown(0);
      return;
    }
    if (prefersReducedMotion()) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setShown(i);
      if (i < text.length) timer.current = window.setTimeout(tick, 18 + Math.random() * 22);
    };
    timer.current = window.setTimeout(tick, 18 + Math.random() * 22);
    return () => window.clearTimeout(timer.current);
  }, [text]);

  return text.slice(0, shown);
}

/** O relógio HH:MM:SS local, vivo. */
function useLiveClock(): string {
  const [s, setS] = useState(() => clockText());
  useEffect(() => {
    const t = window.setInterval(() => setS(clockText()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return s;
}

function clockText(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "ping 3ms" — a latência local, arredondada com honestidade sob 1ms. */
function pingText(ms: number): string {
  if (ms < 1) return "ping <1ms";
  return `ping ${Math.round(ms)}ms`;
}

/** "há 2h", "há 15min", "há 3 dias" — o tempo desde o último backup. */
function agoText(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

function Caret() {
  return (
    <span
      aria-hidden
      className="nx-loop ml-0.5 inline-block h-[13px] w-[7px] bg-[var(--accent)] align-middle"
      style={{ animation: "nexus-caret 1.06s steps(2, jump-none) infinite" }}
    />
  );
}
