/**
 * O TERMINAL DE APORTE (v1.3, fase 4) — a superfície onde se OPERA dinheiro.
 *
 * ===== Por que um Terminal, e não o modal de antes =====
 *
 * O gesto mais repetido da Esfera Finanças é *"botei X no banco Y em Z"*, e o
 * modal da v1.0 já o resolvia em cinco segundos. O que ele NÃO fazia era mostrar
 * o efeito: o usuário digitava um número, apertava Enter, o modal fechava, e ele
 * voltava para um painel que tinha mudado sem ele ver mudar. Lançar dinheiro é o
 * ato mais consequente do app e era o mais cego.
 *
 * O Terminal responde a isso com o **impacto ao vivo** à direita: enquanto se
 * digita, a barra da conta escolhida cresce e o patrimônio total mostra o número
 * de agora RISCADO e o de depois em fósforo, com a variação em %. Nada disso é
 * projeção nem estimativa — é aritmética sobre o que já está na tela, e some
 * inteiro quando o campo está vazio.
 *
 * ===== Uma implementação, duas superfícies =====
 *
 * Este componente é o MESMO na aba "Aportes" e dentro do modal que o Ctrl+K abre
 * (`AporteHost`). Duas implementações do mesmo formulário divergiriam no dia em
 * que só uma ganhasse um campo — é a lição que a fase 4 vinha repetindo em cada
 * esfera, e não faria sentido quebrá-la justo aqui.
 *
 * ===== A entrada é LIVRE, e os rápidos são atalho =====
 *
 * Os botões 100/500/1000 existem porque a maioria dos aportes é redonda. Mas o
 * campo continua sendo um `input` de texto comum: **R$ 99,90 se digita**, com
 * vírgula decimal, e o valor digitado nunca é arredondado para o rápido mais
 * próximo. Um teclado que só oferece três valores é um teclado que decide pelo
 * usuário quanto ele guardou.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Terminal as TerminalIcon } from "lucide-react";

import { BankTile, Chip, MonoLabel, SegBar, SegToggle, Terminal } from "../../design-system/instruments";
import { Button, cx } from "../../design-system/primitives";
import { formatMoney } from "../../lib/format";
import { useToasts } from "../../stores/toasts";
import { toDay } from "../calendar/grid";
import {
  addContribution,
  type Account,
  type AssetClass,
  type FinanceOverview,
} from "../../lib/ipc";
import { classColour, classLabel } from "./classes";
import { parseAporteAmount } from "./parseAporte";

/** As classes na ordem em que a maioria dos aportes cai. */
const CLASSES: AssetClass[] = [
  "renda_fixa",
  "acoes",
  "fiis",
  "etf_exterior",
  "cripto",
  "reserva",
  "outros",
];

/** Os valores redondos que cobrem a maior parte dos lançamentos, em centavos. */
const QUICK = [10_000, 50_000, 100_000];

type Mode = "aporte" | "resgate";

export function AporteTerminal({
  accounts,
  overview,
  defaults,
  onSaved,
  onCancel,
  autoFocus = true,
}: {
  accounts: Account[];
  /** O painel de agora — a base do impacto ao vivo. Sem ele, o painel some. */
  overview?: FinanceOverview;
  defaults?: { amountCents?: number; accountId?: string };
  onSaved: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [mode, setMode] = useState<Mode>("aporte");
  const [amount, setAmount] = useState(
    defaults?.amountCents ? String(defaults.amountCents / 100).replace(".", ",") : "",
  );
  const [accountId, setAccountId] = useState<string | null>(defaults?.accountId ?? null);
  const [assetClass, setAssetClass] = useState<AssetClass>("renda_fixa");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  /* A conta padrão só pode ser escolhida QUANDO as contas chegam.
     A primeira versão fazia `useState(accounts[0]?.id ?? null)` — e `useState`
     só lê o inicial no primeiro render, quando a query ainda devolvia `[]`.
     Resultado visto na dirigida: nenhum banco selecionado, o painel de impacto
     mudo por mais que se digitasse, e o botão de registrar travado sem dizer
     por quê. O `useState` com valor de uma prop assíncrona é sempre esta
     armadilha.

     Só preenche o VAZIO: se o usuário já escolheu (ou o Ctrl+K mandou uma
     conta), nada aqui o sobrescreve. */
  useEffect(() => {
    if (accountId === null && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const cents = parseAporteAmount(amount);
  const signed = cents === null ? null : mode === "resgate" ? -cents : cents;
  const valid = cents !== null && accountId !== null;

  const save = useMutation({
    mutationFn: () =>
      addContribution({
        accountId: accountId!,
        assetClass,
        amountCents: signed!,
        happenedOn: toDay(new Date()),
      }),
    onSuccess: () => {
      push("success", mode === "resgate" ? "Resgate registrado" : "Aporte registrado");
      setAmount("");
      void qc.invalidateQueries({ queryKey: ["finance"] });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      onSaved();
    },
    onError: pushError,
  });

  const submit = () => {
    if (!valid || save.isPending) return;
    save.mutate();
  };

  const tone = mode === "resgate" ? "red" : "sphere";

  return (
    <Terminal
      title={mode === "resgate" ? "Resgate" : "Aporte"}
      icon={TerminalIcon}
      tone={tone}
      right={
        <SegToggle<Mode>
          size="sm"
          tone={tone}
          value={mode}
          onChange={setMode}
          options={[
            { value: "aporte", label: "Aporte", icon: ArrowUpRight },
            { value: "resgate", label: "Resgate", icon: ArrowDownRight },
          ]}
        />
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ===== a operação ===== */}
        <div className="flex flex-col gap-4">
          <div>
            <MonoLabel>Valor</MonoLabel>
            <div
              className={cx(
                "mt-1.5 flex items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-base)] px-3",
                "focus-within:border-[color-mix(in_srgb,var(--op)_70%,transparent)]",
                "border-[var(--border-subtle)]",
              )}
              style={{ "--op": mode === "resgate" ? "var(--danger)" : "var(--sphere)" } as React.CSSProperties}
            >
              <span className="font-mono text-[22px] text-[var(--text-tertiary)]">R$</span>
              <input
                ref={input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape" && onCancel) onCancel();
                }}
                inputMode="decimal"
                placeholder="0,00"
                aria-label="Valor do lançamento"
                className="tabular h-16 w-full bg-transparent text-[32px] font-bold tracking-[-0.02em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              />
            </div>

            {/* Os rápidos SOMAM ao que já está lá — "500 e mais 100" é um gesto,
                não uma correção. Digitar por cima continua livre. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {QUICK.map((q) => (
                <Chip
                  key={q}
                  onClick={() => setAmount(centsToInput((cents ?? 0) + q))}
                >
                  +{formatMoney(q).replace(/,00$/, "")}
                </Chip>
              ))}
              {cents !== null && (
                <button
                  onClick={() => setAmount("")}
                  className="text-[11px] text-[var(--text-tertiary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
                >
                  limpar
                </button>
              )}
            </div>
          </div>

          <div>
            <MonoLabel>Conta</MonoLabel>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {accounts.map((a) => (
                <BankTile
                  key={a.id}
                  name={a.name}
                  selected={accountId === a.id}
                  onClick={() => setAccountId(a.id)}
                  balance={
                    overview
                      ? formatMoney(
                          overview.byAccount.find((b) => b.key === a.id)?.cents ?? 0,
                        )
                      : undefined
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <MonoLabel>Classe</MonoLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {/* O quadradinho de cor é o MESMO do extrato e das fatias do
                  donut: a classe se identifica pela cor em três telas, e trocar
                  o código de cor numa delas seria ensinar duas linguagens. */}
              {CLASSES.map((c) => (
                <Chip key={c} active={assetClass === c} onClick={() => setAssetClass(c)}>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: classColour(c) }}
                  />
                  {classLabel(c)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="mr-auto text-[11px] text-[var(--text-tertiary)]">Enter salva</span>
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                Cancelar
              </Button>
            )}
            <Button
              variant={mode === "resgate" ? "danger" : "primary"}
              onClick={submit}
              disabled={!valid || save.isPending}
            >
              {save.isPending
                ? "Registrando…"
                : mode === "resgate"
                  ? "Registrar resgate"
                  : "Registrar aporte"}
            </Button>
          </div>
        </div>

        {/* ===== o impacto ao vivo ===== */}
        <Impact
          overview={overview}
          accounts={accounts}
          accountId={accountId}
          delta={signed}
        />
      </div>
    </Terminal>
  );
}

/**
 * O que este lançamento faz com o seu dinheiro — enquanto ele ainda é um número
 * sendo digitado.
 *
 * **Só aritmética, e só sobre o que já está na tela.** O total de agora, mais o
 * delta, é o total de depois; a barra da conta cresce na mesma proporção. Nada
 * aqui é projeção — e é por isso que o painel inteiro SOME quando o campo está
 * vazio, em vez de mostrar "+0,00" e um gráfico parado fingindo informação.
 *
 * O que ele mostra é o **total aportado**, e nunca o patrimônio informado à mão:
 * um aporte muda o quanto você pôs, não o quanto o mercado diz que você tem. Foi
 * a mesma linha que o "Saldo por conta" já tinha traçado (§ do painel).
 */
function Impact({
  overview,
  accounts,
  accountId,
  delta,
}: {
  overview: FinanceOverview | undefined;
  accounts: Account[];
  accountId: string | null;
  delta: number | null;
}) {
  const account = accounts.find((a) => a.id === accountId);

  const view = useMemo(() => {
    if (!overview || !account || delta === null || delta === 0) return null;

    const totalNow = overview.totalContributedCents;
    const totalAfter = totalNow + delta;
    const accountNow = overview.byAccount.find((b) => b.key === account.id)?.cents ?? 0;
    const accountAfter = accountNow + delta;

    // A escala das barras é o MAIOR entre o antes e o depois de todas as contas:
    // sem isso, a barra da conta escolhida estouraria o trilho ao passar a maior.
    const peak = Math.max(
      ...overview.byAccount.map((b) => b.cents),
      accountAfter,
      1,
    );

    // A variação percentual precisa de uma base: sobre zero, "subiu ∞%" é uma
    // frase que os dados não sustentam, e ela some.
    const pct = totalNow > 0 ? (delta / totalNow) * 100 : null;

    return { totalNow, totalAfter, accountNow, accountAfter, peak, pct };
  }, [overview, account, delta]);

  if (!overview) return null;

  return (
    <aside className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
      <MonoLabel>Impacto</MonoLabel>

      {!view ? (
        <p className="text-[12px] leading-[18px] text-[var(--text-tertiary)]">
          Digite um valor e o efeito dele aparece aqui — a conta escolhida e o
          total aportado, antes e depois.
        </p>
      ) : (
        <>
          <div>
            <span className="text-[11px] text-[var(--text-tertiary)]">Total aportado</span>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <span className="tabular text-[13px] text-[var(--text-tertiary)] line-through">
                {formatMoney(view.totalNow)}
              </span>
              <span
                className="tabular text-[20px] font-bold tracking-[-0.02em]"
                style={{ color: delta! < 0 ? "var(--danger)" : "var(--sphere)" }}
              >
                {formatMoney(view.totalAfter)}
              </span>
              {view.pct !== null && (
                <span
                  className="tabular text-[12px] font-semibold"
                  style={{ color: delta! < 0 ? "var(--danger)" : "var(--sphere)" }}
                >
                  {delta! < 0 ? "" : "+"}
                  {view.pct.toFixed(1).replace(".", ",")}%
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[12px] text-[var(--text-secondary)]">
                {account!.name}
              </span>
              <span className="tabular text-[12px] font-semibold text-[var(--text-primary)]">
                {formatMoney(view.accountAfter)}
              </span>
            </div>
            {/* A barra some quando o saldo fica NEGATIVO, e isso não é detalhe:
                uma SegBar em zero ao lado de "−R$ 1.200,00" é uma barra que não
                representa o número que ela acompanha — o mesmo defeito que a
                dirigida da Saúde pegou no tile de streak (ADR-0083). Resgatar
                mais do que se aportou numa conta é possível e o app não impede;
                o que ele não faz é desenhar uma proporção que não existe. */}
            {view.accountAfter >= 0 ? (
              <div className="relative mt-2">
                <SegBar
                  value={view.accountAfter / view.peak}
                  segments={24}
                  color={delta! < 0 ? "var(--danger)" : "var(--sphere)"}
                  height={10}
                />
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-[16px] text-[var(--danger)]">
                Este resgate tira mais do que foi aportado nesta conta — o líquido
                dela fica negativo.
              </p>
            )}
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="tabular text-[10px] text-[var(--text-tertiary)]">
                era {formatMoney(view.accountNow)}
              </span>
              <span
                className="tabular text-[10px] font-semibold"
                style={{ color: delta! < 0 ? "var(--danger)" : "var(--sphere)" }}
              >
                {delta! < 0 ? "−" : "+"}
                {formatMoney(Math.abs(delta!))}
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

/** Centavos → o texto que o campo aceita de volta ("1234,56"). */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
