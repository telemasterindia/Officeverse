import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { RoomKey } from "@/lib/officeverse/visual";

/**
 * The illustrated room behind the seated character — a fully coloured office
 * scene (walls, window, shelf, pinboard, plant, desk objects), themed per room.
 * Pure decorative SVG (aria-hidden). Lightweight: one per screen, only the
 * gentlest ambient motion (see .ov-scene-* in styles.css).
 */

const INK = "#2E2A38";

type Pal = {
  wallTop: string;
  wallBot: string;
  floor: string;
  skirting: string;
  wood: string;
  woodDark: string;
  a: string; // accent A — warm
  b: string; // accent B — cool
  c: string; // accent C — violet/pink
  sky: string;
  leaf: string;
  pot: string;
};

const PAL: Record<RoomKey, Pal> = {
  workspace: {
    wallTop: "#ECE4F5",
    wallBot: "#F6E2E7",
    floor: "#F1E0CB",
    skirting: "#DCC8BC",
    wood: "#E3B587",
    woodDark: "#C68A54",
    a: "#F5B94E",
    b: "#E98A6B",
    c: "#B79BEF",
    sky: "#F6D7C4",
    leaf: "#5FAE7C",
    pot: "#E07E58",
  },
  deal: {
    wallTop: "#FCE7DB",
    wallBot: "#F8DCEA",
    floor: "#EFD8C4",
    skirting: "#DEC3AC",
    wood: "#E2B584",
    woodDark: "#C88C54",
    a: "#F59E58",
    b: "#F0708A",
    c: "#B49BEF",
    sky: "#FBD7BE",
    leaf: "#54B07B",
    pot: "#D96A54",
  },
  command: {
    wallTop: "#ECE6FB",
    wallBot: "#DFF1EF",
    floor: "#E4DBF0",
    skirting: "#CDC5E2",
    wood: "#8A91A6",
    woodDark: "#6A7286",
    a: "#F5C64E",
    b: "#54C2B4",
    c: "#B39CF2",
    sky: "#D7CDF5",
    leaf: "#54B07B",
    pot: "#7E88C9",
  },
  people: {
    wallTop: "#E7F6EC",
    wallBot: "#FBF0D9",
    floor: "#ECE0C9",
    skirting: "#D7CBB1",
    wood: "#E2B584",
    woodDark: "#C88C54",
    a: "#7FCF98",
    b: "#F5C64E",
    c: "#F0708A",
    sky: "#CFEFD8",
    leaf: "#4FA972",
    pot: "#E68F5C",
  },
  generic: {
    wallTop: "#EDEAF8",
    wallBot: "#FCEBDD",
    floor: "#EEDDC7",
    skirting: "#D9CBB6",
    wood: "#E2B584",
    woodDark: "#C88C54",
    a: "#F5C64E",
    b: "#54C2B4",
    c: "#B49BEF",
    sky: "#D9E9F3",
    leaf: "#54B07B",
    pot: "#E68F5C",
  },
};

function Wall({ p }: { p: Pal }) {
  return (
    <>
      <rect x="0" y="0" width="360" height="150" fill={p.wallTop} />
      <rect x="0" y="118" width="360" height="44" fill={p.wallBot} />
      <rect x="0" y="158" width="360" height="6" fill={p.skirting} />
      <rect x="0" y="164" width="360" height="60" fill={p.floor} />
      {/* faint floorboards */}
      <g stroke={p.skirting} strokeWidth="2" opacity="0.5">
        <path d="M60 164 L20 224 M150 164 L128 224 M240 164 L262 224 M320 164 L344 224" />
      </g>
    </>
  );
}

function BigWindow({ p, x, y }: { p: Pal; x: number; y: number }) {
  const w = 104;
  const h = 74;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-6" y="-6" width={w + 12} height={h + 12} rx="8" fill={p.woodDark} />
      <rect x="0" y="0" width={w} height={h} rx="3" fill={p.sky} />
      <circle cx={w - 22} cy="20" r="11" fill="#FFE39C" />
      <path
        d={`M6 ${h - 14} q20 -20 40 -6 q18 12 44 -2 v22 h-84 z`}
        fill="#EAF6FB"
        opacity="0.75"
      />
      <line x1={w / 2} y1="0" x2={w / 2} y2={h} stroke={p.woodDark} strokeWidth="5" />
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke={p.woodDark} strokeWidth="5" />
    </g>
  );
}

function Shelf({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="22" width="76" height="7" rx="2" fill={p.wood} />
      <rect x="6" y="0" width="10" height="22" rx="2" fill={p.b} />
      <rect x="18" y="4" width="10" height="18" rx="2" fill={p.a} />
      <rect x="30" y="-2" width="10" height="24" rx="2" fill={p.c} />
      <path d="M50 22 v-14 a8 8 0 0 1 16 0 v14 z" fill={p.leaf} />
    </g>
  );
}

function Pinboard({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-4" y="-4" width="86" height="66" rx="5" fill={p.woodDark} />
      <rect x="0" y="0" width="78" height="58" rx="3" fill="#FFFDF4" />
      <rect x="8" y="8" width="24" height="24" rx="2" fill={p.a} transform="rotate(-5 20 20)" />
      <rect x="40" y="6" width="24" height="24" rx="2" fill={p.b} transform="rotate(4 52 18)" />
      <rect x="10" y="34" width="24" height="18" rx="2" fill={p.c} transform="rotate(3 22 43)" />
      <rect
        x="42"
        y="34"
        width="24"
        height="18"
        rx="2"
        fill="#F7A8C4"
        transform="rotate(-4 54 43)"
      />
    </g>
  );
}

function WallClock({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="0" cy="0" r="15" fill="#FFFDF4" stroke={p.b} strokeWidth="4" />
      <path d="M0 0V-8M0 0l6 4" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  );
}

function Plant({ p, x, y }: { p: Pal; x: number | string; y: number | string }) {
  return (
    <g transform={`translate(${x} ${y})`} className="ov-scene-sway">
      <path
        d="M0 2c-9-6-12-20-5-31M3 2c0-15 7-26 18-32M5 4c9-7 20-7 29-1"
        stroke={p.leaf}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M-9 2h22l-3 19a4 4 0 0 1-4 3h-8a4 4 0 0 1-4-3z" fill={p.pot} />
    </g>
  );
}

function DeskLamp({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="6" cy="6" r="22" fill="#FFE7A8" opacity="0.55" className="ov-scene-glow" />
      <path
        d="M0 40 h20 M10 40 v-22 l-6 -12"
        stroke={INK}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M-2 4 l16 -8 l6 12 l-16 8 z" fill={p.a} stroke={INK} strokeWidth="2" />
    </g>
  );
}

function Credenza({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="0" width="70" height="40" rx="4" fill={p.wood} />
      <rect
        x="0"
        y="0"
        width="70"
        height="40"
        rx="4"
        fill="none"
        stroke={p.woodDark}
        strokeWidth="2"
      />
      <line x1="35" y1="4" x2="35" y2="36" stroke={p.woodDark} strokeWidth="2" />
      <circle cx="24" cy="20" r="2.5" fill={p.woodDark} />
      <circle cx="46" cy="20" r="2.5" fill={p.woodDark} />
    </g>
  );
}

function Poster({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-3" y="-3" width="56" height="66" rx="4" fill={p.woodDark} />
      <rect x="0" y="0" width="50" height="60" rx="2" fill={p.c} />
      <rect x="8" y="12" width="34" height="7" rx="3" fill="#FFFDF4" />
      <rect x="8" y="24" width="24" height="7" rx="3" fill="#FFFDF4" opacity="0.85" />
      <rect x="8" y="36" width="30" height="7" rx="3" fill={p.a} />
      <rect x="8" y="48" width="18" height="5" rx="2.5" fill="#FFFDF4" opacity="0.7" />
    </g>
  );
}

function NeonBolt({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M8 -2 L-6 22 L3 22 L-3 44 L16 16 L6 16 Z"
        fill={p.a}
        stroke="#FFFDF4"
        strokeWidth="2"
        strokeLinejoin="round"
        className="ov-scene-glow"
      />
    </g>
  );
}

function Bridge({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity="0.5" stroke="#C56B4C" fill="none">
      <path d="M2 26 V4 M40 26 V4" strokeWidth="3" />
      <path d="M-8 26 Q 6 8 18 20 Q 30 32 50 12" strokeWidth="2" />
      <path d="M-8 26 H50" strokeWidth="2.5" />
    </g>
  );
}

/* ------------------------------ per-room extras ------------------------------ */

function DealBoard({ p, x, y }: { p: Pal; x: number; y: number }) {
  const cols = [p.b, p.a, p.leaf];
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-4" y="-4" width="150" height="92" rx="6" fill={p.woodDark} />
      <rect x="0" y="0" width="142" height="84" rx="3" fill="#FFFDF4" />
      {[6, 52, 98].map((cx, c) => (
        <g key={c} transform={`translate(${cx} 8)`}>
          {[0, 1, 2].map((r) => (
            <rect
              key={r}
              x="2"
              y={4 + r * 22}
              width="36"
              height="16"
              rx="3"
              fill={cols[(c + r) % 3]}
              opacity="0.9"
            />
          ))}
        </g>
      ))}
      <path d="M120 8 l4 9 l10 1 l-7 7 l2 10 l-9 -5 l-9 5 l2 -10 l-7 -7 l10 -1 z" fill={p.a} />
    </g>
  );
}

function ScreenWall({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${i * 74} 0)`}>
          <rect x="0" y="0" width="64" height="44" rx="4" fill="#20202E" />
          <rect x="4" y="4" width="56" height="36" rx="2" fill={[p.c, p.b, p.a][i]} opacity="0.5" />
          {[8, 18, 12, 24].map((h, j) => (
            <rect
              key={j}
              x={8 + j * 12}
              y={34 - h}
              width="7"
              height={h}
              rx="1.5"
              fill="#FFFDF4"
              opacity="0.85"
            />
          ))}
        </g>
      ))}
      <path
        d="M0 56 q18 -14 36 0 t36 0 t36 0 t36 0 t36 0"
        stroke={p.b}
        strokeWidth="3"
        fill="none"
      />
    </g>
  );
}

function OrgBoard({ p, x, y }: { p: Pal; x: number; y: number }) {
  const tints = [p.a, p.b, p.c, "#F7A8C4", p.leaf, p.a];
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-4" y="-4" width="150" height="92" rx="6" fill={p.woodDark} />
      <rect x="0" y="0" width="142" height="84" rx="3" fill="#FFFDF4" />
      {tints.map((t, i) => (
        <g key={i} transform={`translate(${8 + (i % 3) * 46} ${8 + Math.floor(i / 3) * 40})`}>
          <rect x="0" y="0" width="38" height="32" rx="4" fill={t} opacity="0.85" />
          <circle cx="19" cy="12" r="6" fill="#FFFDF4" />
          <rect x="8" y="20" width="22" height="6" rx="3" fill="#FFFDF4" opacity="0.8" />
        </g>
      ))}
    </g>
  );
}

function DeskCalendar({ p, x, y }: { p: Pal; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x="0"
        y="6"
        width="34"
        height="28"
        rx="3"
        fill="#FFFDF4"
        stroke={p.woodDark}
        strokeWidth="2"
      />
      <rect x="0" y="6" width="34" height="9" rx="3" fill={p.c} />
      <circle cx="9" cy="4" r="3" fill={p.woodDark} />
      <circle cx="25" cy="4" r="3" fill={p.woodDark} />
    </g>
  );
}

/* -------------------------------- scenes ---------------------------------- */

function Common({ p }: { p: Pal }) {
  return (
    <>
      <BigWindow p={p} x={20} y={22} />
      <Shelf p={p} x={148} y={26} />
      <Pinboard p={p} x={236} y={20} />
      <WallClock p={p} x={318} y={40} />
      <DeskLamp p={p} x={116} y={92} />
      <Credenza p={p} x={250} y={100} />
      <Plant p={p} x="308" y="150" />
    </>
  );
}

/** The agent's personal workstation — sunset window, shelf, motivational
 *  poster, wall clock, a little neon energy, plant. */
function WorkspaceScene({ p }: { p: Pal }) {
  return (
    <>
      <BigWindow p={p} x={16} y={24} />
      <Bridge x={40} y={62} />
      <Shelf p={p} x={150} y={20} />
      <Poster p={p} x={214} y={16} />
      <NeonBolt p={p} x={290} y={34} />
      <WallClock p={p} x={330} y={44} />
      <DeskLamp p={p} x={112} y={96} />
      <Plant p={p} x="308" y="150" />
    </>
  );
}

const SCENES: Record<RoomKey, (p: Pal) => ReactElement> = {
  workspace: (p) => <WorkspaceScene p={p} />,
  generic: (p) => <Common p={p} />,
  deal: (p) => (
    <>
      <BigWindow p={p} x={20} y={24} />
      <DealBoard p={p} x={150} y={16} />
      <WallClock p={p} x={324} y={40} />
      <DeskLamp p={p} x={116} y={96} />
      <Plant p={p} x="308" y="150" />
    </>
  ),
  command: (p) => (
    <>
      <ScreenWall p={p} x={40} y={20} />
      <Pinboard p={p} x={278} y={16} />
      <Credenza p={p} x={40} y={110} />
      <Plant p={p} x="312" y="150" />
    </>
  ),
  people: (p) => (
    <>
      <BigWindow p={p} x={18} y={24} />
      <OrgBoard p={p} x={150} y={16} />
      <DeskCalendar p={p} x={116} y={104} />
      <Plant p={p} x="96" y="150" />
      <Plant p={p} x="312" y="150" />
    </>
  ),
};

export function RoomScene({ room, className }: { room: RoomKey; className?: string }) {
  const p = PAL[room];
  return (
    <svg
      aria-hidden
      viewBox="0 0 360 220"
      preserveAspectRatio="xMidYMax meet"
      className={cn("ov-room-scene block", className)}
      data-room={room}
    >
      <g className="ov-room-scene-float">
        <Wall p={p} />
        {SCENES[room](p)}
      </g>
    </svg>
  );
}

/* ---------------------------- foreground desk ---------------------------- */

const DESK_PROP: Record<RoomKey, ReactElement> = {
  workspace: (
    <g transform="translate(150 82)">
      <rect x="-20" y="0" width="56" height="34" rx="4" fill="#26222E" />
      <rect x="-15" y="5" width="46" height="24" rx="2" fill="#7FD0E6" />
      <rect x="-9" y="10" width="30" height="4" rx="2" fill="#FFFFFF" opacity="0.85" />
      <rect x="-9" y="17" width="20" height="4" rx="2" fill="#FFFFFF" opacity="0.6" />
      <rect x="-30" y="32" width="78" height="7" rx="3" fill="#26222E" />
    </g>
  ),
  deal: (
    <g transform="translate(146 80)">
      <rect x="-18" y="0" width="50" height="32" rx="4" fill="#26222E" />
      <rect x="-13" y="5" width="40" height="22" rx="2" fill="#F5A15A" />
      <rect x="40" y="6" width="18" height="26" rx="3" fill="#26222E" />
      <rect x="43" y="10" width="12" height="7" rx="1.5" fill="#F0708A" />
    </g>
  ),
  command: (
    <g transform="translate(138 76)">
      <rect x="-16" y="0" width="46" height="28" rx="3" fill="#26222E" />
      <rect x="-11" y="4" width="36" height="20" rx="2" fill="#B39CF2" />
      <rect x="34" y="0" width="38" height="28" rx="3" fill="#26222E" />
      <rect x="39" y="4" width="28" height="20" rx="2" fill="#54C2B4" />
    </g>
  ),
  people: (
    <g transform="translate(150 84)">
      <rect x="-18" y="0" width="50" height="30" rx="3" fill="#26222E" />
      <rect x="-13" y="4" width="40" height="22" rx="2" fill="#7FCF98" />
      <rect x="34" y="10" width="20" height="20" rx="3" fill="#F5C64E" />
    </g>
  ),
  generic: (
    <g transform="translate(150 82)">
      <rect x="-20" y="0" width="56" height="34" rx="4" fill="#26222E" />
      <rect x="-15" y="5" width="46" height="24" rx="2" fill="#7FD0E6" />
    </g>
  ),
};

/**
 * Foreground desk the seated character works at — a warm wood surface with a
 * screen, a mug (steaming) and a room-specific object. Anchored to the bottom.
 */
export function DeskFront({ room, className }: { room: RoomKey; className?: string }) {
  const p = PAL[room];
  return (
    <svg
      aria-hidden
      viewBox="0 0 360 130"
      preserveAspectRatio="xMidYMax meet"
      className={cn("block", className)}
      data-room={room}
    >
      {/* desk surface — warm wood */}
      <path
        d="M6 128 C 6 76 30 58 74 58 h212 c44 0 68 18 68 70 v0 H6 Z"
        fill={p.wood}
        stroke={p.woodDark}
        strokeWidth="3"
      />
      <path d="M16 80 H344" stroke={p.woodDark} strokeWidth="3" opacity="0.55" />
      {/* mug + steam */}
      <g transform="translate(250 56)">
        <rect x="0" y="4" width="20" height="22" rx="4" fill="#F0708A" />
        <path d="M20 8c9 0 9 12 0 12" stroke="#F0708A" strokeWidth="4" fill="none" />
        <path
          d="M5 -4c-3-5 3-8 0-13M12 -4c-3-5 3-8 0-13"
          stroke="#C9B7B0"
          strokeWidth="2.5"
          fill="none"
          className="ov-scene-steam"
        />
      </g>
      {DESK_PROP[room]}
    </svg>
  );
}
