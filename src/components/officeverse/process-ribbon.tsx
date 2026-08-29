import { useId } from "react";
import type { ProcessCode } from "@/lib/officeverse/types";
import { cn } from "@/lib/utils";

/**
 * TeleMaster India — the India → USA atmosphere.
 *
 * A large, cinematic silk ribbon flowing across the upper background: the Indian
 * flag (saffron / white / green) physically merging into the United States flag
 * (navy / white / red) like painted light. Recognisable landmarks — the Taj
 * Mahal on the India side, the Statue of Liberty (with a faint New York skyline)
 * on the USA side — sit softly lit inside the environment. Light-trail splashes
 * bleed the flag colours into the surrounding page.
 *
 * Purely decorative (aria-hidden), SVG/CSS only. The employee avatar and the
 * CRM cards stay the focus; this is the story behind the product.
 */

type Key = "IN" | "US" | "NEUTRAL";

/* left → right silk gradient. IN weights the India colours across the width;
   US carries the full India → USA merge. */
const SILK: Record<Key, { o: number; c: string }[]> = {
  US: [
    { o: 0, c: "#FF9933" }, // saffron
    { o: 0.12, c: "#FFC98A" },
    { o: 0.22, c: "#FFF4E4" }, // white
    { o: 0.34, c: "#7EC79A" },
    { o: 0.43, c: "#0E8A3E" }, // India green
    { o: 0.53, c: "#DCE8EF" }, // transition light
    { o: 0.62, c: "#3355A6" }, // chakra / royal blue
    { o: 0.74, c: "#16306E" },
    { o: 0.84, c: "#0B1C4A" }, // deep navy
    { o: 0.92, c: "#F2F3F7" }, // white
    { o: 1, c: "#B22234" }, // US red
  ],
  IN: [
    { o: 0, c: "#FF9933" },
    { o: 0.22, c: "#FFD8A6" },
    { o: 0.42, c: "#FFF4E4" },
    { o: 0.6, c: "#8ECFA1" },
    { o: 0.74, c: "#0E8A3E" },
    { o: 0.88, c: "#CFE0EA" },
    { o: 1, c: "#33509E" },
  ],
  NEUTRAL: [
    { o: 0, c: "#FFB25E" },
    { o: 0.3, c: "#FFF1DF" },
    { o: 0.6, c: "#BFD3E4" },
    { o: 1, c: "#25407E" },
  ],
};

const TRAILS: { x: number; y: number; c: string; r: number }[] = [
  { x: 120, y: 244, c: "#FF9E3D", r: -13 },
  { x: 300, y: 176, c: "#FFB964", r: -18 },
  { x: 470, y: 286, c: "#159D45", r: -10 },
  { x: 620, y: 206, c: "#2FA85E", r: -16 },
  { x: 760, y: 250, c: "#3A5BB0", r: -12 },
  { x: 900, y: 178, c: "#2E4FA0", r: -19 },
  { x: 1040, y: 262, c: "#16306E", r: -11 },
  { x: 1190, y: 202, c: "#C43141", r: -17 },
  { x: 1330, y: 250, c: "#B22234", r: -12 },
];

function TajMahal({ className }: { className?: string }) {
  const minarets = [52, 84, 196, 228];
  return (
    <svg viewBox="0 0 280 200" className={className} fill="none" aria-hidden>
      <defs>
        <radialGradient id="taj-glow" cx="50%" cy="60%" r="60%">
          <stop offset="0" stopColor="#FFE7B8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFE7B8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="140" cy="132" rx="150" ry="84" fill="url(#taj-glow)" />
      <g fill="currentColor" opacity="0.74">
        <rect x="0" y="190" width="280" height="8" opacity="0.3" />
        <rect x="38" y="152" width="204" height="34" opacity="0.8" />
        {minarets.map((x) => (
          <g key={x}>
            <rect x={x - 4} y="78" width="8" height="76" opacity="0.78" />
            <path
              d={`M${x} 62 C ${x - 7} 66 ${x - 7} 78 ${x} 78 C ${x + 7} 78 ${x + 7} 66 ${x} 62 Z`}
              opacity="0.85"
            />
            <rect x={x - 1} y="50" width="2" height="12" opacity="0.8" />
          </g>
        ))}
        <rect x="96" y="98" width="88" height="56" opacity="0.88" />
        {[106, 174].map((x) => (
          <path key={x} d={`M${x - 8} 100 c0 -12 16 -12 16 0 Z`} opacity="0.85" />
        ))}
        <rect x="124" y="82" width="32" height="18" opacity="0.9" />
        <path d="M140 38 C 163 44 165 74 156 94 H124 C 115 74 117 44 140 38 Z" opacity="0.95" />
        <path d="M124 94 q16 9 32 0 v5 q-16 9 -32 0 Z" opacity="0.9" />
        <rect x="138" y="22" width="4" height="18" opacity="0.85" />
      </g>
      {/* arch openings lit from within */}
      <g fill="#FFE7B8">
        <path d="M126 154 V126 a14 14 0 0 1 28 0 V154 Z" opacity="0.5" />
        <path d="M104 154 V140 a6 6 0 0 1 12 0 V154 Z" opacity="0.4" />
        <path d="M164 154 V140 a6 6 0 0 1 12 0 V154 Z" opacity="0.4" />
      </g>
    </svg>
  );
}

function Liberty({ className }: { className?: string }) {
  const spikes = [-70, -46, -23, 0, 23, 46, 70];
  const skyline: [number, number][] = [
    [4, 152],
    [22, 118],
    [40, 162],
    [150, 140],
    [168, 108],
    [186, 150],
  ];
  return (
    <svg viewBox="0 0 200 244" className={className} fill="none" aria-hidden>
      <defs>
        <radialGradient id="lib-glow" cx="50%" cy="55%" r="60%">
          <stop offset="0" stopColor="#BFE0FF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#BFE0FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="100" cy="150" rx="130" ry="96" fill="url(#lib-glow)" />
      <g fill="#172C5C" opacity="0.24">
        {skyline.map(([x, top], i) => (
          <rect key={i} x={x} y={top} width="14" height={244 - top} />
        ))}
      </g>
      <g fill="currentColor" opacity="0.76">
        <path d="M58 236 l12 -16 h60 l12 16 Z" opacity="0.65" />
        <rect x="74" y="198" width="52" height="24" opacity="0.9" />
        <rect x="66" y="184" width="68" height="16" opacity="0.85" />
        <path d="M88 106 C 82 132 80 162 86 186 H114 C 120 162 118 132 112 106 Z" opacity="0.95" />
        <path d="M90 114 L76 130" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <rect
          x="64"
          y="120"
          width="16"
          height="22"
          rx="1.5"
          opacity="0.9"
          transform="rotate(-16 72 131)"
        />
        <circle cx="100" cy="92" r="9" />
        {spikes.map((a) => {
          const r = (a * Math.PI) / 180;
          return (
            <path
              key={a}
              d={`M${100 + Math.sin(r) * 9} ${92 - Math.cos(r) * 9} L ${100 + Math.sin(r) * 21} ${92 - Math.cos(r) * 21}`}
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          );
        })}
        <path d="M110 100 L131 56" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <rect x="124" y="42" width="14" height="8" rx="1" />
      </g>
      <path d="M131 42 l-7 -16 h14 z" fill="#FFD98A" opacity="0.9" />
      <circle cx="131" cy="24" r="7" fill="#FFE7A8" opacity="0.6" />
    </svg>
  );
}

export function ProcessRibbon({
  process,
  className,
}: {
  process: ProcessCode;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const key: Key = process === "IN" ? "IN" : process === "US" ? "US" : "NEUTRAL";
  const stops = SILK[key];

  return (
    <div
      aria-hidden
      data-process={process}
      className={cn(
        "pointer-events-none relative overflow-hidden opacity-[0.42] dark:opacity-[0.36]",
        className,
      )}
    >
      <svg
        viewBox="0 0 1440 440"
        preserveAspectRatio="none"
        className="h-full w-full"
        role="presentation"
      >
        <defs>
          <linearGradient id={`silk-${uid}`} x1="0" y1="0.1" x2="1" y2="0.4">
            {stops.map((s) => (
              <stop key={s.o} offset={s.o} stopColor={s.c} />
            ))}
          </linearGradient>
          {/* vertical fade so the band dissolves at both edges */}
          <linearGradient id={`fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.28" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.72" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`bandmask-${uid}`}>
            <rect x="0" y="0" width="1440" height="440" fill={`url(#fade-${uid})`} />
          </mask>
          <filter id={`soft-${uid}`} x="-20%" y="-60%" width="140%" height="240%">
            <feGaussianBlur stdDeviation="40" />
          </filter>
          <filter id={`mid-${uid}`} x="-20%" y="-60%" width="140%" height="240%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id={`trail-${uid}`} x="-80%" y="-200%" width="260%" height="500%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
        </defs>

        <g mask={`url(#bandmask-${uid})`}>
          {/* back silk — very soft, wide, blurred */}
          <path
            d="M-40 30 C 320 -30 620 110 940 40 C 1180 -12 1360 90 1480 30 L 1480 300 C 1160 400 860 200 560 300 C 320 380 120 240 -40 320 Z"
            fill={`url(#silk-${uid})`}
            opacity="0.55"
            filter={`url(#soft-${uid})`}
          />
          {/* light-trail splashes bleeding into the page */}
          <g filter={`url(#trail-${uid})`}>
            {TRAILS.map((t, i) => (
              <ellipse
                key={i}
                cx={t.x}
                cy={t.y}
                rx="84"
                ry="16"
                fill={t.c}
                opacity="0.24"
                transform={`rotate(${t.r} ${t.x} ${t.y})`}
              />
            ))}
          </g>
          {/* main silk band — flowing, both edges curved */}
          <path
            d="M-40 44 C 300 -16 600 96 900 34 C 1150 -14 1360 74 1480 26 L 1480 214 C 1160 322 900 132 620 240 C 380 332 180 156 -40 250 Z"
            fill={`url(#silk-${uid})`}
            opacity="0.9"
            filter={`url(#mid-${uid})`}
          />
          {/* soft sheen along the crest */}
          <path
            d="M-40 40 C 320 -12 620 84 940 30 C 1180 -8 1360 62 1480 22 L 1480 96 C 1160 150 900 60 620 130 C 380 190 180 70 -40 140 Z"
            fill="#FFFFFF"
            opacity="0.12"
            filter={`url(#mid-${uid})`}
          />
        </g>
      </svg>

      {key !== "US" ? (
        <TajMahal className="absolute bottom-3 left-4 hidden h-[30%] w-[26%] max-w-[300px] text-[#CDA173] sm:block" />
      ) : (
        <>
          <TajMahal className="absolute bottom-3 left-4 hidden h-[32%] w-[26%] max-w-[320px] text-[#CDA173] sm:block" />
          <Liberty className="absolute bottom-3 right-5 hidden h-[38%] w-[20%] max-w-[240px] text-[#74B8B0] sm:block" />
        </>
      )}
      {key === "IN" ? (
        <Liberty className="absolute bottom-3 right-6 hidden h-[24%] w-[16%] max-w-[180px] text-[#74B8B0] opacity-60 lg:block" />
      ) : null}
    </div>
  );
}
