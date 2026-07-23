/**
 * A MARCA do NEXUS — o NÚCLEO ORBITAL (v1.3 COCKPIT, fase 10).
 *
 * A fase 9 desenhou o "SINAL-N", mas o uso reprovou: a letra lia como um logotipo
 * de banco, não como o emblema de um instrumento. A marca volta ao NÚCLEO ORBITAL
 * — duas elipses de órbita CRUZADAS, um núcleo central sólido e dois corpos
 * orbitando —, dentro de um squircle grafite com uma POEIRA ESTELAR quase
 * imperceptível atrás. É o "nexus" (o ponto onde tudo gira e se liga) dito na
 * própria forma, e rima com a borda infinita que corre atrás do app inteiro.
 *
 * A GRADE É O DESENHO: num quadro 240, tudo gira em torno do centro (120,120). A
 * geometria é a do mockup aprovado (viewBox 44 × 5.4545): elipses rx98/ry38 com o
 * traço em fósforo, o núcleo r24, dois corpos em (33,82) e (202,164). Os mesmos
 * números vivem no splash do `index.html` — dois desenhos, uma geometria só.
 *
 * A POEIRA (`dust`, ligada com o `plate`): ~12 estrelas minúsculas piscando de
 * leve atrás do núcleo — um respiro, não um céu. É a única exceção de rAF por
 * logo, e ela se comporta: com `prefers-reduced-motion` desenha UM quadro e para,
 * e pausa com a janela sem foco/minimizada. As instâncias pequenas (a rail, o
 * favicon) não a ligam — um logo de 24px não paga uma animação.
 *
 * Por que hex cru aqui, se "hex cru em componente é bug"? Porque um LOGO é um ativo
 * de marca com UMA identidade — não se tinge com o tema nem com a Esfera (ADR-0043).
 */

import { useEffect, useId, useRef } from "react";

import { backgroundMotionOn } from "../lib/motion";

/** O vocabulário fechado da marca. Fósforo para o núcleo; grafite para o fundo. */
const INK = {
  phos: "#33E1A0",
  plateTop: "#12181B",
  plateBottom: "#070A0B",
  plateEdge: "#2C4A40",
  glow: "#33E1A0",
};

/** O centro do quadro 240 — a órbita inteira gira em torno dele. */
const C = 120;

export function NexusMark({
  size = 28,
  plate = false,
  glow = false,
  dust,
  className,
}: {
  size?: number;
  /** O squircle grafite por trás — o look de ícone de app. */
  plate?: boolean;
  /** O halo suave atrás do squircle (a tela de bloqueio, o Sobre). */
  glow?: boolean;
  /** A poeira estelar atrás do núcleo. Por padrão acompanha o `plate` (as
   *  instâncias grandes e emblemáticas); pode ser forçada em qualquer sentido. */
  dust?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const bg = `plate-${uid}`;
  const halo = `glow-${uid}`;
  const showDust = dust ?? plate;

  const core = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      fill="none"
      role="img"
      aria-label="NEXUS"
      className={showDust ? undefined : className}
      style={showDust ? { position: "relative", zIndex: 2, display: "block" } : undefined}
    >
      <defs>
        {plate && (
          <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={INK.plateTop} />
            <stop offset="100%" stopColor={INK.plateBottom} />
          </linearGradient>
        )}
        {glow && (
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="30%" stopColor={INK.glow} stopOpacity={0.4} />
            <stop offset="66%" stopColor={INK.glow} stopOpacity={0.11} />
            <stop offset="100%" stopColor={INK.glow} stopOpacity={0} />
          </radialGradient>
        )}
      </defs>

      {/* O glow vem primeiro e ocupa a moldura inteira: existe para vazar por fora
          do squircle, então o squircle é inset o bastante para deixá-lo. */}
      {glow && <circle cx={C} cy={C} r="118" fill={`url(#${halo})`} />}

      {plate && (
        <>
          <rect x="16" y="16" width="208" height="208" rx="58" fill={`url(#${bg})`} />
          <rect
            x="16"
            y="16"
            width="208"
            height="208"
            rx="58"
            fill="none"
            stroke={INK.plateEdge}
            strokeWidth="1.5"
            opacity="0.8"
          />
        </>
      )}

      {/* As DUAS órbitas cruzadas — o traço fino em fósforo, uma clara e uma mais
          apagada, giradas em direções opostas para lerem como um cruzamento. */}
      <ellipse
        cx={C}
        cy={C}
        rx="98"
        ry="38"
        stroke={INK.phos}
        strokeWidth="7"
        opacity="0.5"
        transform={`rotate(-25 ${C} ${C})`}
      />
      <ellipse
        cx={C}
        cy={C}
        rx="98"
        ry="38"
        stroke={INK.phos}
        strokeWidth="7"
        opacity="0.3"
        transform={`rotate(35 ${C} ${C})`}
      />

      {/* O núcleo sólido no centro, e os dois corpos orbitando. */}
      <circle cx={C} cy={C} r="24" fill={INK.phos} />
      <circle cx="33" cy="82" r="10" fill={INK.phos} />
      <circle cx="202" cy="164" r="8" fill={INK.phos} opacity="0.75" />
    </svg>
  );

  if (!showDust) return core;

  // A poeira mora atrás do núcleo, num canvas do tamanho exato da marca.
  return (
    <span
      className={className}
      style={{ position: "relative", display: "inline-block", width: size, height: size, lineHeight: 0 }}
    >
      <Stardust size={size} plate={plate} />
      {core}
    </span>
  );
}

/**
 * A POEIRA — ~12 estrelas piscando de leve, quase imperceptíveis. Recortada ao
 * squircle quando há `plate`, para não vazar dos cantos. Um respiro; a §6 do design
 * system a vigia como qualquer rAF: quadro único em reduced-motion, pausa em idle.
 */
function Stardust({ size, plate }: { size: number; plate: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    cv.width = size;
    cv.height = size;

    // Estrelas em coordenadas normalizadas — sobrevivem ao tamanho.
    const stars = Array.from({ length: 12 }, (_, i) => ({
      x: pseudo(i * 2.13 + 0.7),
      y: pseudo(i * 3.71 + 1.9),
      r: 0.35 + pseudo(i * 1.27) * 0.9,
      o: 0.1 + pseudo(i * 2.61) * 0.25,
      p: pseudo(i * 4.03) * 7,
      sp: 0.6 + pseudo(i * 1.91),
    }));

    const draw = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      for (const s of stars) {
        const o = s.o * (0.5 + 0.5 * Math.sin(t * s.sp + s.p));
        ctx.beginPath();
        ctx.arc(s.x * size, s.y * size, s.r * (size / 64), 0, 7);
        ctx.fillStyle = `rgba(51,225,160,${o.toFixed(3)})`;
        ctx.fill();
      }
    };

    // A poeira segue a preferência "Movimento do fundo" (BUG B), não o SO.
    if (!backgroundMotionOn()) {
      draw(0.7);
      return;
    }

    let raf = 0;
    let t = 0;
    let running = true;
    const loop = () => {
      if (!running) return;
      t += 0.016;
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    const idle = () => document.hidden || !document.hasFocus();
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      if (running && raf) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => (idle() ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onVis);
    window.addEventListener("focus", onVis);
    if (idle()) draw(t);
    else raf = requestAnimationFrame(loop);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [size]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: size,
        height: size,
        // Recorta a poeira ao squircle da placa (o mesmo raio proporcional do
        // `rx=58` num quadro 240 ≈ 24%); sem placa, o quadrado inteiro.
        borderRadius: plate ? "24%" : 0,
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
  );
}

/** Ruído determinístico [0,1) — evita `Math.random` no corpo do módulo e mantém a
 *  poeira idêntica entre renders (nada de estrelas pulando a cada montagem). */
function pseudo(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
