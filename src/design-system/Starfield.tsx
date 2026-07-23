/**
 * A POEIRA ESTELAR — o fundo vivo do Cockpit (v1.3, fase 9).
 *
 * Um único `<canvas>` que preenche o que estiver atrás dele de ponta a ponta:
 * a "borda infinita". Ele serve a DOIS lugares — a tela de bloqueio/onboarding e
 * o app inteiro — e por isso mora no design system, não numa feature.
 *
 * O desenho é a referência do mockup `nexus-fluxo-final.html` (a fonte da verdade
 * visual), com TRÊS camadas em fósforo/na cor da seção:
 *   B3 · constelação viva  — estrelas com twinkle + linhas ligando as próximas.
 *   B2 · estrela cadente    — um risco cruzando de tempos em tempos.
 *   B4 · névoa viva         — um glow radial que respira + leve deriva das estrelas.
 *
 * A COR vem de fora (`color`, um "r,g,b"): a Saúde tinge tudo de verde, as
 * Finanças de ciano, e a troca de seção INTERPOLA suave (não pula). Uma variável,
 * e o ambiente inteiro muda de tom.
 *
 * CUSTO / A6 — a higiene de segundo plano é levada a sério aqui, porque é a única
 * animação em rAF do app:
 *   - A constelação é O(n²); por isso o número de estrelas é DENSIDADE × área com
 *     um TETO duro — um fundo não paga 300 estrelas.
 *   - O loop PARA quando a janela perde o foco/some (o mesmo sinal do `.nx-loop`)
 *     e quando `prefers-reduced-motion`/a preferência explícita estão ligadas —
 *     nesses casos desenha UM quadro estático e encerra. Nada anima parado.
 *   - Renderiza em pixels de CSS (DPR 1): um fundo suave não precisa de retina, e
 *     dobrar a contagem de pixels dobraria o custo à toa.
 */

import { useEffect, useRef } from "react";

import { backgroundMotionOn } from "../lib/motion";

/** Uma estrela — posição normalizada [0,1], para sobreviver ao resize. */
interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  p: number;
  sp: number;
  z: number;
}

interface Shooting {
  x: number;
  y: number;
}

/** Densidade e teto: o fundo cita a constelação, não a recria inteira. */
const DENSITY = 11000; // 1 estrela a cada ~11k px²
const MAX_STARS = 150; // teto duro — n² fica em ~11k pares/quadro no pior caso
const MIN_STARS = 34;
const LINK_DIST = 88; // px: abaixo disto, duas estrelas se ligam
const STAR_RADII = [0.6, 1, 1.5, 1.9];

/** "51,225,160" → [51,225,160]. Aceita também "#33e1a0". */
function parseRgb(input: string): [number, number, number] {
  const s = input.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const parts = s.split(",").map((n) => parseInt(n, 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  return [51, 225, 160]; // fósforo, o padrão honesto
}

export function Starfield({
  color,
  className,
  nebula = true,
  motion,
}: {
  /** A cor da tinta — "r,g,b" ou "#hex". A troca interpola suave. */
  color: string;
  className?: string;
  /** A névoa + deriva. Ligada por padrão. */
  nebula?: boolean;
  /**
   * O fundo anima? (fase 10, BUG B) Vem da preferência "Movimento do fundo", NÃO do
   * `prefers-reduced-motion` do SO — a galáxia é identidade, não efeito chamativo.
   * `undefined` cai no default LIGADO (lido de `data-bg-motion`). Reativa: trocar a
   * preferência re-roda o efeito e liga/para o loop na hora.
   */
  motion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** A cor-ALVO (muda quando a seção troca); a atual persegue-a por interpolação. */
  const target = useRef<[number, number, number]>(parseRgb(color));

  useEffect(() => {
    target.current = parseRgb(color);
  }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // O fundo anima pela PREFERÊNCIA (BUG B), não pelo reduced-motion do SO.
    const animate = motion ?? backgroundMotionOn();

    let stars: Star[] = [];
    const cur: [number, number, number] = [...target.current];

    const fit = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      const n = Math.max(
        MIN_STARS,
        Math.min(MAX_STARS, Math.round((w * h) / DENSITY)),
      );
      stars = Array.from({ length: n }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: STAR_RADII[Math.floor(Math.random() * STAR_RADII.length)],
        o: 0.12 + Math.random() * 0.4,
        p: Math.random() * 7,
        sp: 0.4 + Math.random() * 1.1,
        z: Math.random(),
      }));
    };
    fit();

    /** Desenha UM quadro. `t` é o relógio da animação; parado, congela vivo. */
    const draw = (t: number) => {
      const W = canvas.width;
      const H = canvas.height;
      // Persegue a cor-alvo: ~0.06/quadro converge em ~400ms a 60fps — a troca
      // de seção "escorre" para o novo tom em vez de piscar.
      for (let i = 0; i < 3; i++) cur[i] += (target.current[i] - cur[i]) * 0.06;
      const rgb = `${Math.round(cur[0])},${Math.round(cur[1])},${Math.round(cur[2])}`;

      ctx.clearRect(0, 0, W, H);

      if (nebula) {
        const pl = 0.5 + 0.5 * Math.sin(t * 0.33);
        const g = ctx.createRadialGradient(
          W * 0.82,
          H * 0.2,
          10,
          W * 0.82,
          H * 0.2,
          Math.max(W, H) * 0.6,
        );
        g.addColorStop(0, `rgba(${rgb},${(0.05 * pl + 0.015).toFixed(3)})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // B3 — as linhas da constelação. O(n²), mas n tem teto.
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const a = stars[i];
          const b = stars[j];
          const dx = (a.x - b.x) * W;
          const dy = (a.y - b.y) * H;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DIST) {
            const pl = (Math.sin(t * 0.45 + i + j) + 1) / 2;
            const o = (1 - d / LINK_DIST) * 0.13 * pl;
            if (o > 0.004) {
              ctx.strokeStyle = `rgba(${rgb},${o.toFixed(3)})`;
              ctx.lineWidth = 0.6;
              ctx.beginPath();
              ctx.moveTo(a.x * W, a.y * H);
              ctx.lineTo(b.x * W, b.y * H);
              ctx.stroke();
            }
          }
        }
      }

      // As estrelas (com a deriva lenta da névoa).
      for (const s of stars) {
        if (nebula) {
          s.x -= 0.00006 * (0.4 + s.z);
          if (s.x < 0) s.x = 1;
        }
        const o = s.o * (0.58 + 0.42 * Math.sin(t * s.sp + s.p));
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, 7);
        ctx.fillStyle = `rgba(${rgb},${o.toFixed(3)})`;
        ctx.fill();
      }

      return rgb;
    };

    // ===== o loop, com a higiene de segundo plano =====
    if (!animate) {
      // Movimento do fundo REDUZIDO: UM quadro estático, e nada de rAF. Cor direta.
      cur[0] = target.current[0];
      cur[1] = target.current[1];
      cur[2] = target.current[2];
      draw(0);
      const onResizeStatic = () => {
        fit();
        draw(0);
      };
      window.addEventListener("resize", onResizeStatic);
      return () => window.removeEventListener("resize", onResizeStatic);
    }

    let raf = 0;
    let t = 0;
    let sh: Shooting | null = null;
    let next = 90;
    let running = true;

    const loop = () => {
      if (!running) return;
      t += 0.016;
      const rgb = draw(t);

      // B2 — a estrela cadente, esparsa. `next` conta quadros até a próxima.
      const W = canvas.width;
      const H = canvas.height;
      if (!sh && --next < 0) {
        sh = { x: W * 0.15 + Math.random() * W * 0.55, y: -14 };
      }
      if (sh) {
        const len = Math.min(90, W * 0.14);
        sh.x += 6.5;
        sh.y += 3.9;
        const g = ctx.createLinearGradient(sh.x, sh.y, sh.x - len, sh.y - len * 0.6);
        g.addColorStop(0, `rgba(${rgb},.75)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(sh.x - len, sh.y - len * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, 1.5, 0, 7);
        ctx.fillStyle = `rgba(${rgb},.9)`;
        ctx.fill();
        if (sh.y > H + 24) {
          sh = null;
          next = 300 + Math.random() * 220;
        }
      }

      raf = requestAnimationFrame(loop);
    };

    // Pausa com a janela sem foco/minimizada — a mesma regra do `.nx-loop`.
    const idle = () => document.hidden || !document.hasFocus();
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      if (running && raf) return;
      if (!animate) {
        draw(t);
        return;
      }
      running = true;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => (idle() ? stop() : start());
    const onResize = () => {
      fit();
      if (!running || !animate) draw(t);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("resize", onResize);

    if (idle()) draw(t);
    else raf = requestAnimationFrame(loop);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [nebula, motion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      // O tamanho é dado pelo container (inset-0). O canvas não participa do
      // fluxo nem recebe eventos — é chão.
      style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
