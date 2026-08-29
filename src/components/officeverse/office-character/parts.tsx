/**
 * Officeverse character — original stylised game-character parts.
 * Full body on a 300 x 440 grid. Big expressive head (~1:3.5 proportion),
 * bold silhouettes, rounded shapes, oversized hands & shoes, 3-tone shading,
 * one warm ink outline. SVG only — no images, no per-frame JS.
 */
import type { ReactElement } from "react";
import { INK, type ColorRamp } from "@/lib/officeverse/avatar";
import type {
  Accessory,
  Expression,
  FacialHair,
  Glasses,
  HairStyle,
  Headwear,
  Outfit,
  Presentation,
  ProcessCode,
} from "@/lib/officeverse/types";

export type Palette = {
  skin: ColorRamp;
  hair: ColorRamp;
  outfit: ColorRamp;
  /** Per-instance gradient fills (paint-server URLs) for volumetric shading. */
  grad: { skin: string; hair: string; outfit: string; pants: string };
};

const PANTS = { base: "#3B3B4C", shadow: "#2B2B39", light: "#4E4E62" };
const SHOE = { base: "#EFEEF2", shadow: "#C9C7D2", accent: "#1E1B26" };
const GLASS_TINT = "rgba(150,205,255,0.16)";

const line = {
  stroke: INK,
  strokeWidth: 4,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};
const thin = {
  stroke: INK,
  strokeWidth: 2.4,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

/* =============================== legs ================================= */

const HIP_SCALE: Record<Presentation, number> = {
  feminine: 0.9,
  neutral: 1,
  masculine: 1.06,
};

export function Legs({ p, pres = "neutral" }: { p: Palette; pres?: Presentation }) {
  const sx = HIP_SCALE[pres];
  return (
    <g className="ov-c-legs">
      <g transform={`translate(${150 * (1 - sx)} 0) scale(${sx} 1)`}>
        {/* thighs / shins — gradient-shaded volume */}
        <path d="M116 258 h34 v116 q-17 12 -34 0 Z" fill={p.grad.pants} {...line} />
        <path d="M150 258 h34 v116 q-17 12 -34 0 Z" fill={p.grad.pants} {...line} />
        <path d="M150 258 v116" stroke={PANTS.shadow} strokeWidth={6} opacity={0.5} />
        <path d="M126 268 v92" stroke="#FFFFFF" strokeWidth={3} opacity={0.12} />
        <path d="M118 306 q16 8 30 0" stroke={PANTS.shadow} strokeWidth={3} fill="none" />
        <path d="M152 306 q16 8 30 0" stroke={PANTS.shadow} strokeWidth={3} fill="none" />
        {/* shoes — oversized chunky sneakers */}
        <path
          d="M96 392 c0 -12 12 -20 30 -20 h22 c8 0 12 6 12 18 v8 c0 10 -8 16 -20 16 h-56 c-10 0 -14 -8 -14 -16 z"
          fill={SHOE.base}
          {...line}
        />
        <path
          d="M204 392 c0 -12 -12 -20 -30 -20 h-22 c-8 0 -12 6 -12 18 v8 c0 10 8 16 20 16 h56 c10 0 14 -8 14 -16 z"
          fill={SHOE.base}
          {...line}
        />
        <path
          d="M74 414 h78 M148 414 h78"
          stroke={SHOE.shadow}
          strokeWidth={8}
          strokeLinecap="round"
        />
        <path
          d="M118 380 l12 14 M182 380 l-12 14"
          stroke={SHOE.accent}
          strokeWidth={4}
          strokeLinecap="round"
        />
        {/* toe-cap gloss */}
        <path
          d="M104 384 q22 -7 40 1 M196 384 q-22 -7 -40 1"
          stroke="#FFFFFF"
          strokeWidth={4}
          opacity={0.5}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

/* =============================== arms ================================= */

export function Arm({ side, p, outfit }: { side: "l" | "r"; p: Palette; outfit: Outfit }) {
  const sleeveless = outfit === "tee" || outfit === "polo";
  // Geometry authored for the LEFT arm; the RIGHT arm is the same shapes mirrored
  // around x=150 on an INNER group, so CSS pose transforms on the outer
  // `.ov-c-arm-*` group (which rotates around the shoulder) never fight the flip.
  const mirror = side === "r" ? "translate(300 0) scale(-1 1)" : undefined;
  const sleeveFill = sleeveless ? p.grad.skin : p.grad.outfit;
  return (
    <g className={`ov-c-arm ov-c-arm-${side}`}>
      <g transform={mirror}>
        {/* whole arm silhouette: shoulder -> elbow -> wrist, one connected blob */}
        <path
          d="M100 176 c-20 2 -34 16 -40 42 c-6 26 -4 52 4 74 c4 12 16 18 30 14 c12 -4 18 -16 14 -30 c-6 -20 -8 -40 -4 -58 c4 -18 12 -30 22 -38 Z"
          fill={sleeveFill}
          {...line}
        />
        {/* form highlight down the outer arm */}
        <path
          d="M72 200 c-10 20 -12 46 -8 70"
          stroke="#FFFFFF"
          strokeWidth={6}
          opacity={0.16}
          fill="none"
          strokeLinecap="round"
        />
        {/* occlusion where the arm meets the torso */}
        <path
          d="M100 176 c-14 2 -24 10 -30 24 c10 -6 22 -10 34 -10 Z"
          fill={sleeveless ? p.skin.shadow : p.outfit.shadow}
          opacity={0.45}
        />
        {sleeveless ? (
          <path
            d="M64 232 c-4 22 -2 44 6 62 c4 12 16 18 30 14 c12 -4 18 -16 14 -30 c-6 -18 -8 -34 -6 -48 Z"
            fill={p.grad.skin}
            {...line}
          />
        ) : (
          <path
            d="M62 232 q22 10 44 -2"
            stroke={p.outfit.shadow}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        )}
        {/* oversized hand, overlapping the wrist */}
        <ellipse cx={92} cy={300} rx={19} ry={18} fill={p.grad.skin} {...line} />
        <path
          d="M78 296 q14 12 28 2"
          stroke={p.skin.shadow}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M92 282 q4 -6 10 -4"
          stroke={p.skin.shadow}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

/* ============================== torso ================================ */

const TORSO_D: Record<Presentation, string> = {
  neutral:
    "M78 176 c8 -10 30 -16 72 -16 c42 0 64 6 72 16 c8 34 6 70 -2 96 c-14 8 -40 12 -70 12 c-30 0 -56 -4 -70 -12 c-8 -26 -10 -62 -2 -96 Z",
  masculine:
    "M72 176 c9 -11 33 -17 78 -17 c45 0 69 6 78 17 c9 34 7 70 -3 96 c-15 8 -43 12 -75 12 c-32 0 -60 -4 -75 -12 c-9 -26 -11 -62 -3 -96 Z",
  feminine:
    "M88 176 c7 -10 26 -15 62 -15 c36 0 55 5 62 15 c5 20 3 37 -6 52 c-4 15 0 33 8 48 c-14 8 -36 12 -64 12 c-28 0 -50 -4 -64 -12 c8 -15 12 -33 8 -48 c-9 -15 -11 -32 -6 -52 Z",
};

export function Torso({
  p,
  outfit,
  pres = "neutral",
}: {
  p: Palette;
  outfit: Outfit;
  pres?: Presentation;
}) {
  return (
    <g className="ov-c-torso">
      <path d={TORSO_D[pres]} fill={p.grad.outfit} {...line} />
      {/* broad chest key-light */}
      <path
        d="M92 176 c14 -8 84 -10 116 -2 c4 22 2 44 -6 62 c-30 8 -74 8 -104 0 c-8 -18 -12 -40 -6 -60 Z"
        fill={p.outfit.light}
        opacity={0.28}
      />
      {/* core shadow down the right side */}
      <path
        d="M214 184 c10 28 8 60 0 84 c14 -6 20 -16 22 -34 c2 -22 -8 -42 -22 -50 Z"
        fill={p.outfit.shadow}
        opacity={0.62}
      />
      {/* soft occlusion beneath the collar */}
      <path d="M116 166 q34 16 68 0 l-3 12 q-31 12 -62 0 Z" fill={p.outfit.shadow} opacity={0.22} />
      {pres === "feminine" ? (
        <path
          d="M92 226 q58 20 116 0"
          stroke={p.outfit.shadow}
          strokeWidth={3}
          fill="none"
          opacity={0.5}
        />
      ) : null}
      {/* fabric sheen */}
      <path
        d="M104 186 q46 16 92 -2"
        stroke="#FFFFFF"
        strokeWidth={4}
        opacity={0.14}
        fill="none"
        strokeLinecap="round"
      />
      <Collar p={p} outfit={outfit} />
    </g>
  );
}

function Collar({ p, outfit }: { p: Palette; outfit: Outfit }) {
  const c = p.outfit;
  switch (outfit) {
    case "hoodie":
      return (
        <g {...thin}>
          <path d="M120 160 c-14 8 -20 26 -14 44 c10 -6 18 -18 22 -34 Z" fill={c.shadow} />
          <path d="M180 160 c14 8 20 26 14 44 c-10 -6 -18 -18 -22 -34 Z" fill={c.shadow} />
          <path d="M128 166 q22 18 44 0 l-6 26 q-16 12 -32 0 Z" fill={c.light} opacity={0.9} />
          <path
            d="M138 182 c-2 26 0 46 2 58 M162 182 c2 26 0 46 -2 58"
            stroke={INK}
            strokeWidth={3.4}
            fill="none"
          />
          <circle cx={140} cy={242} r={3} fill={INK} />
          <circle cx={160} cy={242} r={3} fill={INK} />
        </g>
      );
    case "tee":
      return (
        <path
          d="M122 160 q28 26 56 0"
          stroke={c.shadow}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
        />
      );
    case "polo":
      return (
        <g {...thin}>
          <path d="M132 160 l-14 26 l18 -12 Z" fill={c.light} />
          <path d="M168 160 l14 26 l-18 -12 Z" fill={c.light} />
          <path d="M150 168 v40" stroke={c.shadow} strokeWidth={3} />
          <circle cx={150} cy={182} r={2.6} fill={c.shadow} />
          <circle cx={150} cy={198} r={2.6} fill={c.shadow} />
        </g>
      );
    case "shirt":
      return (
        <g {...thin}>
          <path d="M134 160 l-16 30 l20 -14 Z" fill={c.light} />
          <path d="M166 160 l16 30 l-20 -14 Z" fill={c.light} />
          <path d="M150 162 v110" stroke={c.shadow} strokeWidth={2.6} />
          <circle cx={150} cy={196} r={2.4} fill={c.shadow} />
          <circle cx={150} cy={224} r={2.4} fill={c.shadow} />
        </g>
      );
    case "blazer":
      return (
        <g {...thin}>
          <path d="M138 160 l-30 96 l32 -56 Z" fill={c.shadow} />
          <path d="M162 160 l30 96 l-32 -56 Z" fill={c.shadow} />
          <path d="M138 164 q12 16 24 0 l-4 40 q-8 8 -16 0 Z" fill="#EBEBF0" />
        </g>
      );
    case "turtleneck":
      return (
        <g {...thin}>
          <path d="M122 150 q28 20 56 0 l0 30 q-28 22 -56 0 Z" fill={c.base} />
          <path d="M124 162 q26 16 52 0" stroke={c.shadow} strokeWidth={3} fill="none" />
        </g>
      );
    case "bomber":
      return (
        <g {...thin}>
          <path d="M120 158 h60 v18 q-30 12 -60 0 Z" fill={c.shadow} />
          <path d="M134 160 v14 M150 160 v16 M166 160 v14" stroke={c.base} strokeWidth={2.6} />
          <path d="M150 176 v96" stroke={INK} strokeWidth={3} />
        </g>
      );
    case "varsity":
      return (
        <g {...thin}>
          <path d="M118 158 h64 v16 q-32 12 -64 0 Z" fill="#EDEDF1" />
          <path d="M118 162 h64 M118 170 h64" stroke={c.shadow} strokeWidth={3} />
          <path d="M150 176 v96" stroke="#EDEDF1" strokeWidth={5} />
          <path d="M150 176 v96" stroke={INK} strokeWidth={2} />
        </g>
      );
    case "overshirt":
      return (
        <g {...thin}>
          <path d="M128 160 l-6 112 l16 0 l4 -96 Z" fill="#DBDBE2" />
          <path d="M172 160 l6 112 l-16 0 l-4 -96 Z" fill="#DBDBE2" />
          <path d="M128 160 c-14 10 -20 60 -22 112 l-22 0 c0 -52 6 -92 22 -104 Z" fill={c.base} />
          <path d="M172 160 c14 10 20 60 22 112 l22 0 c0 -52 -6 -92 -22 -104 Z" fill={c.base} />
        </g>
      );
    case "puffer":
      return (
        <g {...thin}>
          <path d="M122 158 q28 18 56 0 l0 20 q-28 16 -56 0 Z" fill={c.shadow} />
          <path
            d="M84 196 h132 M84 222 h132 M84 248 h132"
            stroke={c.shadow}
            strokeWidth={3.5}
            fill="none"
          />
          <path d="M150 172 v100" stroke={INK} strokeWidth={3} />
        </g>
      );
    case "denim":
      return (
        <g {...thin}>
          <path d="M134 160 l-16 28 l20 -12 Z" fill={c.light} />
          <path d="M166 160 l16 28 l-20 -12 Z" fill={c.light} />
          <path d="M150 164 v108" stroke={c.shadow} strokeWidth={2.4} strokeDasharray="5 4" />
          <rect x={128} y={210} width={20} height={22} rx={3} fill={c.shadow} />
          <rect x={152} y={210} width={20} height={22} rx={3} fill={c.shadow} />
        </g>
      );
    default:
      return null;
  }
}

/* ============================== head ================================ */

const HEAD_D: Record<Presentation, string> = {
  neutral:
    "M150 34 C 106 34 84 60 84 100 C 84 132 96 154 116 164 C 130 172 170 172 184 164 C 204 154 216 132 216 100 C 216 60 194 34 150 34 Z",
  masculine:
    "M150 32 C 104 32 82 58 82 100 C 82 128 92 150 112 162 C 128 172 172 172 188 162 C 208 150 218 128 218 100 C 218 58 196 32 150 32 Z",
  // narrower, softer jaw that tapers to a rounded chin
  feminine:
    "M150 36 C 112 36 90 60 90 98 C 90 122 100 142 116 156 C 128 166 172 166 184 156 C 200 142 210 122 210 98 C 210 60 188 36 150 36 Z",
};
const HEAD_SHADE_D: Record<Presentation, string> = {
  neutral:
    "M216 100 C 216 132 204 154 184 164 C 192 150 198 128 198 100 C 198 74 190 52 172 40 C 200 46 216 68 216 100 Z",
  masculine:
    "M218 100 C 218 128 208 150 188 162 C 196 148 202 126 202 100 C 202 74 194 50 176 38 C 204 44 218 68 218 100 Z",
  feminine:
    "M210 98 C 210 122 200 142 184 156 C 191 143 196 122 196 98 C 196 74 189 54 172 44 C 197 50 210 70 210 98 Z",
};

export function Head({ p, pres = "neutral" }: { p: Palette; pres?: Presentation }) {
  const s = p.skin;
  return (
    <g>
      {/* neck — lit front, occluded under the jaw */}
      <path d="M134 150 h32 v22 q-16 10 -32 0 Z" fill={p.grad.skin} {...thin} />
      <path d="M132 149 q18 12 36 0 v9 q-18 10 -36 0 Z" fill={s.shadow} opacity={0.6} />
      {/* ears */}
      <ellipse cx={84} cy={102} rx={10} ry={14} fill={p.grad.skin} {...line} />
      <ellipse cx={216} cy={102} rx={10} ry={14} fill={p.grad.skin} {...line} />
      <path d="M80 94 q7 8 0 16" stroke={s.shadow} strokeWidth={3} fill="none" />
      <path d="M220 94 q-7 8 0 16" stroke={s.shadow} strokeWidth={3} fill="none" />
      {/* head — gradient-shaded volume */}
      <path d={HEAD_D[pres]} fill={p.grad.skin} {...line} />
      {/* core shadow on the right / underside */}
      <path d={HEAD_SHADE_D[pres]} fill={s.shadow} opacity={0.5} />
      <path
        d="M150 150 C 128 150 112 140 108 122 C 128 136 172 136 192 122 C 188 140 172 150 150 150 Z"
        fill={s.shadow}
        opacity={0.32}
      />
      {/* key-light on the brow / left temple */}
      <path
        d="M108 46 C 92 60 84 82 86 104 C 84 80 92 56 112 44 C 118 40 116 46 108 46 Z"
        fill={s.light}
        opacity={0.75}
      />
      <ellipse cx={120} cy={70} rx={16} ry={20} fill="#FFFFFF" opacity={0.12} />
      {/* cheek roundness */}
      <ellipse cx={112} cy={118} rx={12} ry={9} fill={s.light} opacity={0.35} />
      <ellipse cx={188} cy={118} rx={11} ry={8} fill={s.light} opacity={0.22} />
      {/* nose with a tiny highlight */}
      <path d="M144 116 q6 9 12 0 q-2 7 -6 7 q-4 0 -6 -7 Z" fill={s.shadow} opacity={0.55} />
      <path d="M148 110 q3 -3 5 0" stroke="#FFFFFF" strokeWidth={2} opacity={0.4} fill="none" />
    </g>
  );
}

/* =========================== expressions =========================== */

const BROW: Record<Expression, string> = {
  neutral: "M108 74 q18 -10 36 -4 q-4 8 -16 8 q-14 0 -20 -4 Z",
  focused: "M108 70 q18 -4 36 6 q-6 8 -18 6 q-14 -2 -18 -12 Z",
  happy: "M106 68 q18 -12 38 -6 q-4 6 -16 6 q-14 2 -22 0 Z",
  excited: "M104 64 q20 -14 40 -6 q-4 4 -16 6 q-16 4 -24 0 Z",
  thinking: "M106 76 q16 -6 34 -2 q-4 6 -16 6 q-12 0 -18 -4 Z",
  concerned: "M108 66 q18 -6 36 4 q-6 6 -18 4 q-12 -2 -18 -12 Z",
};
const BROW_R_FLIP: Partial<Record<Expression, boolean>> = { thinking: true };

const MOUTH: Record<Exclude<Expression, "excited">, string> = {
  neutral: "M134 132 q16 10 32 0",
  focused: "M136 133 q14 4 28 0",
  happy: "M130 128 q20 20 40 0",
  thinking: "M140 133 q12 6 24 -2",
  concerned: "M134 136 q16 -8 32 0",
};

const PUPIL: Record<Expression, [number, number]> = {
  neutral: [0, 0],
  focused: [0, 1],
  happy: [0, 1],
  excited: [0, -1],
  thinking: [-3, -4],
  concerned: [0, 1],
};
const LID: Record<Expression, number> = {
  neutral: 0,
  focused: 6,
  happy: 4,
  excited: -3,
  thinking: 3,
  concerned: -1,
};

function Eye({
  cx,
  p,
  expr,
  fem = false,
}: {
  cx: number;
  p: Palette;
  expr: Expression;
  fem?: boolean;
}) {
  const [dx, dy] = PUPIL[expr];
  const lid = LID[expr];
  const smiling = expr === "happy";
  const out = cx < 150 ? -1 : 1;
  const ex = cx + dx;
  const ey = 98 + dy;
  return (
    <g>
      {/* eyeball with a soft top occlusion */}
      <ellipse cx={cx} cy={98} rx={15} ry={18} fill="#FCFBFE" {...thin} />
      <path
        d={`M${cx - 13} 85 Q ${cx} 92 ${cx + 13} 85 Q ${cx} 79 ${cx - 13} 85 Z`}
        fill="#0B0A12"
        opacity={0.1}
      />
      {/* iris + pupil */}
      <circle cx={ex} cy={ey} r={9} fill="#4A3320" />
      <circle cx={ex} cy={ey} r={5} fill={INK} />
      {/* catchlights */}
      <circle cx={ex - 3.5} cy={ey - 4} r={3.6} fill="#FFFFFF" />
      <circle cx={ex + 4} cy={ey + 4} r={1.6} fill="#FFFFFF" opacity={0.85} />
      {/* upper lid */}
      {lid > 0 ? (
        <path
          d={`M${cx - 17} ${92} Q ${cx} ${80 + lid * 1.6} ${cx + 17} ${92} L ${cx + 17} ${78} Q ${cx} ${72} ${cx - 17} 78 Z`}
          fill={p.skin.base}
        />
      ) : null}
      {/* smiling lower lid */}
      {smiling ? (
        <path
          d={`M${cx - 15} 110 Q ${cx} 100 ${cx + 15} 110`}
          stroke={INK}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      ) : null}
      <path
        d={`M${cx - 16} 82 Q ${cx} ${72 + lid} ${cx + 16} 82`}
        stroke={INK}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      {/* feminine: a few lashes at the outer corner */}
      {fem ? (
        <g stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none">
          <path d={`M${cx + out * 15} 84 q ${out * 6} -4 ${out * 11} -3`} />
          <path d={`M${cx + out * 14} 90 q ${out * 7} -1 ${out * 12} 2`} />
        </g>
      ) : null}
      {/* under-eye softness for depth */}
      <path
        d={`M${cx - 12} 116 Q ${cx} 122 ${cx + 12} 116`}
        stroke={p.skin.shadow}
        strokeWidth={3}
        opacity={0.35}
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

export function Face({
  p,
  expr,
  pres = "neutral",
}: {
  p: Palette;
  expr: Expression;
  pres?: Presentation;
}) {
  const fem = pres === "feminine";
  const warm = expr === "happy" || expr === "excited";
  const browR = BROW_R_FLIP[expr]
    ? "M156 70 q18 -12 38 -2 q-6 8 -18 8 q-14 0 -20 -6 Z"
    : BROW[expr];
  return (
    <g>
      {/* brows */}
      <path d={BROW[expr]} fill={p.hair.shadow} {...thin} />
      <g transform="translate(300 0) scale(-1 1)">
        <path d={BROW_R_FLIP[expr] ? BROW[expr] : browR} fill={p.hair.shadow} {...thin} />
      </g>
      {/* eyes */}
      <g className="ov-c-eyes">
        <Eye cx={126} p={p} expr={expr} fem={fem} />
        <Eye cx={174} p={p} expr={expr} fem={fem} />
      </g>
      {/* cheeks */}
      {warm || fem ? (
        <g fill="#F2887F" opacity={fem && !warm ? 0.2 : 0.28}>
          <ellipse cx={106} cy={122} rx={11} ry={7} />
          <ellipse cx={194} cy={122} rx={11} ry={7} />
        </g>
      ) : null}
      {/* mouth */}
      {expr === "excited" ? (
        <g strokeLinejoin="round">
          <path
            d="M128 128 q22 6 44 0 q-4 22 -22 24 q-18 -2 -22 -24 Z"
            fill="#7A2F3C"
            stroke={INK}
            strokeWidth={3}
          />
          <path d="M134 130 q16 4 32 0 l-3 8 q-13 4 -26 0 Z" fill="#FCFCFE" />
          <path d="M138 150 q12 6 24 0" fill="#C25563" />
        </g>
      ) : fem ? (
        <>
          <path
            d={MOUTH[expr]}
            stroke="#B85B70"
            strokeWidth={5.4}
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={MOUTH[expr]}
            stroke="#E38AA0"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
        </>
      ) : (
        <path d={MOUTH[expr]} stroke={INK} strokeWidth={4.4} fill="none" strokeLinecap="round" />
      )}
    </g>
  );
}

/* ============================== hair =============================== */

export function HairBack({ style, hair }: { style: HairStyle; hair: ColorRamp }) {
  switch (style) {
    case "long":
      return (
        <path
          d="M70 58 C 62 156 72 226 96 242 L 204 242 C 228 226 238 156 230 58 C 220 146 214 188 196 224 L 104 224 C 86 188 80 146 70 58 Z"
          fill={hair.shadow}
          {...line}
        />
      );
    case "ponytail":
      return (
        <g {...line}>
          <path
            d="M188 54 C 224 68 240 116 230 164 C 224 192 208 206 198 206 C 216 174 216 122 194 84 C 190 72 188 58 188 54 Z"
            fill={hair.base}
          />
          <rect x={178} y={52} width={18} height={12} rx={5} fill={hair.shadow} />
        </g>
      );
    case "bun":
      return (
        <g {...line}>
          <path d="M90 44 C 90 34 210 34 210 44 L 210 66 C 150 48 90 66 90 66 Z" fill={hair.base} />
          <ellipse cx={150} cy={30} rx={22} ry={17} fill={hair.base} />
          <path d="M132 26 q18 12 36 0" stroke={hair.shadow} strokeWidth={3} fill="none" />
        </g>
      );
    case "curly":
    case "coily":
    case "messy":
      return (
        <path
          d="M74 96 C 62 42 104 16 150 16 C 196 16 238 42 226 96 C 224 60 196 44 150 44 C 104 44 76 60 74 96 Z"
          fill={hair.shadow}
        />
      );
    default:
      return null;
  }
}

export function HairFront({ style, hair }: { style: HairStyle; hair: ColorRamp }) {
  const hi = (
    <path
      d="M104 52 Q140 34 176 44"
      stroke={hair.light}
      strokeWidth={5}
      fill="none"
      strokeLinecap="round"
    />
  );
  switch (style) {
    case "buzz":
      return (
        <path
          d="M86 96 C 84 54 108 38 150 38 C 192 38 216 54 214 96 C 210 74 200 62 150 60 C 100 62 90 74 86 96 Z"
          fill={hair.base}
          {...line}
        />
      );
    case "short":
      return (
        <g>
          <path
            d="M84 100 C 82 52 106 32 150 32 C 194 32 218 52 216 100 C 212 76 202 56 168 54 C 162 70 150 74 138 66 C 100 58 88 78 84 100 Z"
            fill={hair.base}
            {...line}
          />
          {hi}
        </g>
      );
    case "fade":
      return (
        <g>
          <path
            d="M92 84 C 92 44 118 32 150 32 C 182 32 208 44 208 84 C 200 60 186 54 150 54 C 114 54 100 60 92 84 Z"
            fill={hair.base}
            {...line}
          />
          <path
            d="M108 52 h84 M112 44 h76"
            stroke={hair.shadow}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </g>
      );
    case "sidePart":
      return (
        <g>
          <path
            d="M84 98 C 82 48 106 30 150 30 C 196 30 218 50 216 98 C 214 72 202 52 150 50 C 150 50 172 58 176 74 C 150 64 118 60 100 78 C 92 84 86 92 84 98 Z"
            fill={hair.base}
            {...line}
          />
          <path
            d="M150 32 C 138 46 128 62 120 82"
            stroke={hair.shadow}
            strokeWidth={3.5}
            fill="none"
          />
          {hi}
        </g>
      );
    case "spiky":
      return (
        <g {...line}>
          <path
            d="M84 98 L100 46 L116 78 L132 40 L150 74 L168 38 L186 78 L202 46 L216 98 C 210 74 200 60 150 58 C 100 60 90 74 84 98 Z"
            fill={hair.base}
          />
          <path
            d="M132 44 L142 66 M168 42 L160 64"
            stroke={hair.light}
            strokeWidth={3}
            fill="none"
          />
        </g>
      );
    case "messy":
      return (
        <g {...line}>
          <path
            d="M82 102 C 78 66 90 40 116 42 C 120 30 140 28 150 40 C 162 26 184 32 188 48 C 212 46 222 74 214 100 C 208 82 214 66 200 64 C 204 50 188 46 180 58 C 178 44 160 44 156 56 C 148 42 128 44 128 60 C 118 46 100 54 102 68 C 90 66 82 84 82 102 Z"
            fill={hair.base}
          />
          <path
            d="M96 44 l-6 -14 M150 34 l0 -14 M196 46 l8 -12"
            stroke={hair.base}
            strokeWidth={6}
            strokeLinecap="round"
          />
          {hi}
        </g>
      );
    case "wavy":
    case "waves":
      return (
        <g {...line}>
          <path
            d="M82 106 C 76 60 96 32 150 32 C 204 32 224 58 218 106 C 212 86 216 66 200 68 C 206 52 194 42 182 50 C 188 68 176 76 166 66 C 172 50 156 44 150 56 C 148 42 128 44 126 58 C 114 46 96 54 98 72 C 90 72 84 90 82 106 Z"
            fill={hair.base}
          />
          <path
            d="M104 54 q22 -14 42 -6 M150 44 q20 6 34 20"
            stroke={hair.light}
            strokeWidth={4}
            fill="none"
          />
        </g>
      );
    case "curly":
      return (
        <g {...line}>
          <path
            d="M78 98 C 68 78 76 54 96 48 C 98 34 120 28 134 40 C 148 26 174 30 182 46 C 204 46 220 70 212 92 C 214 72 198 60 186 66 C 190 50 172 44 164 56 C 168 38 144 34 138 50 C 132 34 108 40 110 56 C 92 52 78 70 86 90 C 82 92 78 94 78 98 Z"
            fill={hair.base}
          />
          {[
            [92, 58],
            [128, 40],
            [168, 42],
            [200, 66],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={7} fill={i % 2 ? hair.light : hair.shadow} />
          ))}
        </g>
      );
    case "coily":
      return (
        <g {...line}>
          <path
            d="M76 98 C 66 48 104 22 150 22 C 196 22 234 48 224 98 C 218 70 222 50 202 48 C 206 38 186 32 176 44 C 180 28 156 22 150 36 C 144 22 120 28 124 44 C 112 32 92 40 96 54 C 78 52 72 74 76 98 Z"
            fill={hair.base}
          />
          {[
            [86, 60],
            [116, 40],
            [150, 32],
            [184, 40],
            [214, 60],
            [86, 88],
            [214, 88],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={8} fill={i % 2 ? hair.shadow : hair.light} />
          ))}
        </g>
      );
    case "undercut":
      return (
        <g>
          <path
            d="M92 84 C 94 40 126 24 164 34 C 196 42 214 62 206 88 C 192 62 158 56 128 68 C 114 74 100 84 92 84 Z"
            fill={hair.base}
            {...line}
          />
          <path
            d="M110 50 Q150 30 188 48"
            stroke={hair.light}
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case "bun":
      return (
        <path
          d="M88 78 C 88 44 112 32 150 32 C 188 32 212 44 212 78 C 198 56 102 56 88 78 Z"
          fill={hair.base}
          {...line}
        />
      );
    case "ponytail":
      return (
        <path
          d="M88 80 C 88 44 112 30 150 30 C 188 30 212 44 212 80 C 198 58 102 58 88 80 Z"
          fill={hair.base}
          {...line}
        />
      );
    case "long":
      return (
        <g {...line}>
          <path
            d="M80 100 C 76 50 100 30 150 30 C 200 30 224 50 220 100 C 218 66 198 50 150 50 C 102 50 82 66 80 100 Z"
            fill={hair.base}
          />
          <path
            d="M80 94 C 74 148 78 200 92 230 L 116 230 C 106 188 106 122 110 88 C 98 84 86 86 80 94 Z"
            fill={hair.base}
          />
          <path
            d="M220 94 C 226 148 222 200 208 230 L 184 230 C 194 188 194 122 190 88 C 202 84 214 86 220 94 Z"
            fill={hair.base}
          />
          {hi}
        </g>
      );
    default:
      return null;
  }
}

/* =========================== facial hair ========================== */

export function FacialHairLayer({ kind, hair }: { kind: FacialHair; hair: ColorRamp }) {
  if (kind === "none") return null;
  const f = hair.base;
  switch (kind) {
    case "stubble":
      return (
        <g fill={f} opacity={0.24}>
          <path d="M104 118 C 104 150 124 166 150 166 C 176 166 196 150 196 118 C 190 138 178 146 150 146 C 122 146 110 138 104 118 Z" />
          <path d="M136 126 h28 v8 q-14 6 -28 0 Z" opacity={0.8} />
        </g>
      );
    case "moustache":
      return <path d="M136 128 q14 8 28 0 q-6 -6 -14 -4 q-8 -2 -14 4 Z" fill={f} {...thin} />;
    case "goatee":
      return (
        <g fill={f} {...thin}>
          <path d="M136 128 q14 8 28 0 q-6 -6 -14 -4 q-8 -2 -14 4 Z" />
          <path d="M140 146 q10 16 20 0 q-10 6 -20 0 Z" />
        </g>
      );
    case "shortBeard":
      return (
        <g fill={f} {...thin}>
          <path d="M102 114 C 102 152 124 168 150 168 C 176 168 198 152 198 114 C 190 138 176 148 150 148 C 124 148 110 138 102 114 Z" />
          <path d="M134 124 q16 8 32 0 q-6 -6 -16 -4 q-10 -2 -16 4 Z" stroke="none" />
        </g>
      );
    case "fullBeard":
      return (
        <g fill={f} {...thin}>
          <path d="M96 100 C 94 154 122 178 150 178 C 178 178 206 154 204 100 C 196 134 180 146 150 146 C 120 146 104 134 96 100 Z" />
          <path d="M132 122 q18 8 36 0 q-6 -6 -18 -4 q-12 -2 -18 4 Z" stroke="none" />
        </g>
      );
    default:
      return null;
  }
}

/* ============================= glasses ============================ */

export function GlassesLayer({ kind }: { kind: Glasses }) {
  if (kind === "none") return null;
  const F = "#2A2530";
  if (kind === "round") {
    return (
      <g stroke={F} strokeWidth={4.5} fill={GLASS_TINT} strokeLinecap="round">
        <circle cx={126} cy={98} r={19} />
        <circle cx={174} cy={98} r={19} />
        <path d="M145 96 h10" fill="none" />
        <path d="M107 94 l-14 -4 M193 94 l14 -4" fill="none" />
      </g>
    );
  }
  if (kind === "browline") {
    return (
      <g fill={GLASS_TINT}>
        <rect x={104} y={84} width={42} height={28} rx={8} stroke="#2A2530" strokeWidth={2} />
        <rect x={154} y={84} width={42} height={28} rx={8} stroke="#2A2530" strokeWidth={2} />
        <path
          d="M104 88 h42 M154 88 h42"
          stroke="#2A2530"
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M146 94 h8 M104 96 l-12 -4 M196 96 l12 -4"
          stroke="#2A2530"
          strokeWidth={4}
          fill="none"
        />
      </g>
    );
  }
  const sw = kind === "thin" ? 2.6 : 4.5;
  const col = kind === "thin" ? "#7C7C8A" : "#2A2530";
  return (
    <g stroke={col} strokeWidth={sw} fill={GLASS_TINT} strokeLinecap="round">
      <rect x={104} y={82} width={42} height={30} rx={9} />
      <rect x={154} y={82} width={42} height={30} rx={9} />
      <path d="M146 96 h8" fill="none" />
      <path d="M104 92 l-12 -4 M196 92 l12 -4" fill="none" />
    </g>
  );
}

/* ============================ headwear =========================== */

export function HeadwearLayer({ kind, p }: { kind: Headwear; p: Palette }) {
  if (kind === "none") return null;
  const c = p.outfit;
  switch (kind) {
    case "cap":
      return (
        <g {...line}>
          <path
            d="M84 84 C 84 46 110 30 150 30 C 190 30 216 48 214 84 C 180 68 120 68 84 84 Z"
            fill={c.base}
          />
          <path
            d="M150 30 v52 M120 34 l8 48 M180 34 l-8 48"
            stroke={c.shadow}
            strokeWidth={2.4}
            fill="none"
          />
          <circle cx={150} cy={32} r={3.4} fill={c.shadow} />
          <path
            d="M112 84 C 88 84 70 96 60 112 C 56 118 64 122 74 116 C 96 100 122 94 138 94 C 142 86 128 84 112 84 Z"
            fill={c.shadow}
          />
        </g>
      );
    case "capBack":
      return (
        <g {...line}>
          <path
            d="M84 84 C 84 46 110 30 150 30 C 190 30 216 48 214 84 C 180 68 120 68 84 84 Z"
            fill={c.base}
          />
          <path
            d="M188 84 C 212 84 230 96 240 112 C 244 118 236 122 226 116 C 204 100 178 94 162 94 C 158 86 172 84 188 84 Z"
            fill={c.shadow}
          />
          <rect x={140} y={80} width={20} height={10} rx={3} fill={c.light} />
        </g>
      );
    case "beanie":
      return (
        <g {...line}>
          <path
            d="M80 92 C 80 44 106 30 150 30 C 194 30 220 44 220 92 C 170 78 130 78 80 92 Z"
            fill={c.base}
          />
          <path d="M76 84 Q150 70 224 84 L224 102 Q150 88 76 102 Z" fill={c.shadow} />
          <path
            d="M108 80 V98 M150 78 V96 M192 80 V98"
            stroke={c.base}
            strokeWidth={3}
            fill="none"
          />
          <circle cx={150} cy={28} r={8} fill={c.light} />
        </g>
      );
    case "headphones":
      return (
        <g fill="none" strokeLinecap="round">
          <path d="M82 84 C 90 40 210 40 218 84" stroke={INK} strokeWidth={9} />
          <path d="M82 84 C 90 46 210 46 218 84" stroke={c.base} strokeWidth={4.5} />
          <rect x={64} y={88} width={22} height={38} rx={11} fill="#2A2530" {...line} />
          <rect x={214} y={88} width={22} height={38} rx={11} fill="#2A2530" {...line} />
          <rect x={70} y={96} width={10} height={22} rx={5} fill={c.base} />
          <rect x={220} y={96} width={10} height={22} rx={5} fill={c.base} />
        </g>
      );
    case "headset":
      return (
        <g fill="none" strokeLinecap="round">
          <path d="M82 84 C 90 40 210 40 218 84" stroke={INK} strokeWidth={9} />
          <path d="M82 84 C 90 46 210 46 218 84" stroke={c.base} strokeWidth={4.5} />
          <rect x={64} y={88} width={22} height={38} rx={11} fill="#2A2530" {...line} />
          <rect x={214} y={88} width={22} height={38} rx={11} fill="#2A2530" {...line} />
          <rect x={220} y={96} width={10} height={22} rx={5} fill={c.base} />
          <path d="M66 118 C 48 138 56 168 108 168" stroke="#2A2530" strokeWidth={4.5} />
          <rect x={100} y={160} width={16} height={12} rx={6} fill="#2A2530" />
        </g>
      );
    case "turban": {
      // A stylised dastaar: a solid wrapped dome over the whole crown, a front
      // peak, and diagonal wrap folds. Sits a little wider than the head and
      // pairs naturally with a beard. Colour follows the outfit colour.
      return (
        <g {...line}>
          {/* solid dome covering the crown */}
          <path
            d="M70 92 C 58 18 104 -6 150 -6 C 196 -6 242 18 230 92 C 208 66 92 66 70 92 Z"
            fill={c.base}
          />
          {/* raised highlight on the crown */}
          <path
            d="M84 60 C 88 16 118 -2 150 -2 C 182 -2 212 16 216 60 C 196 40 104 40 84 60 Z"
            fill={c.light}
            opacity={0.85}
          />
          {/* diagonal wrap folds */}
          <path
            d="M74 82 Q 150 44 226 82 M80 62 Q 150 26 220 62 M92 42 Q 150 14 208 42"
            stroke={c.shadow}
            strokeWidth={3.6}
            fill="none"
          />
          {/* front peak / larh */}
          <path d="M140 6 q10 -16 20 0 q-3 20 -10 26 q-7 -6 -10 -26 Z" fill={c.shadow} />
          {/* brow-line wrap that meets the temples */}
          <path
            d="M70 92 C 82 74 100 68 122 68 M230 92 C 218 74 200 68 178 68"
            stroke={c.shadow}
            strokeWidth={3.4}
            fill="none"
          />
        </g>
      );
    }
    default:
      return null;
  }
}

/* ==================== chest / hand accessories ==================== */

export function AccessoryChest({ kind, p }: { kind: Accessory; p: Palette }) {
  switch (kind) {
    case "lanyard":
      return (
        <g strokeLinecap="round">
          <path d="M128 168 L136 232" stroke="#2E2A38" strokeWidth={5} fill="none" />
          <path d="M172 168 L164 232" stroke="#2E2A38" strokeWidth={5} fill="none" />
          <rect
            x={132}
            y={226}
            width={36}
            height={44}
            rx={4}
            fill="#F3F1F6"
            stroke={INK}
            strokeWidth={2}
          />
          <rect x={132} y={226} width={36} height={12} rx={4} fill={p.outfit.shadow} />
          <rect x={139} y={244} width={16} height={12} rx={2} fill="#C9C7D2" />
          <path d="M139 262 h22" stroke="#B7B5C2" strokeWidth={2.4} />
        </g>
      );
    case "chain":
      return (
        <g>
          <path
            d="M122 166 Q150 190 178 166"
            stroke="#D9B15A"
            strokeWidth={3.4}
            fill="none"
            strokeLinecap="round"
          />
          <circle cx={150} cy={186} r={4} fill="#D9B15A" />
        </g>
      );
    case "scarf":
      return (
        <g stroke={INK} strokeWidth={2.4} strokeLinejoin="round">
          <path d="M116 158 Q150 182 184 158 L190 182 Q150 202 110 182 Z" fill={p.outfit.light} />
          <path d="M166 190 L176 240 L192 234 L182 184 Z" fill={p.outfit.base} />
        </g>
      );
    case "backpack":
      return (
        <g stroke={INK} strokeWidth={2.4} strokeLinejoin="round">
          <path d="M120 168 L108 262 L120 262 L132 176 Z" fill={p.outfit.shadow} />
          <path d="M180 168 L192 262 L180 262 L168 176 Z" fill={p.outfit.shadow} />
        </g>
      );
    default:
      return null;
  }
}

/** Small items pinned to the character's right hand / wrist zone. */
export function HandAccessory({ kind }: { kind: Accessory }) {
  if (kind === "coffee") {
    return (
      <g transform="translate(214 262)" stroke={INK} strokeWidth={2.4} strokeLinejoin="round">
        <path d="M-11 0 h22 l-3 26 q-8 4 -16 0 Z" fill="#EFEAE4" />
        <rect x={-12} y={-6} width={24} height={7} rx={2} fill="#C98A5A" />
        <path d="M-2 -6 q2 -8 6 -8" fill="none" />
      </g>
    );
  }
  if (kind === "smartwatch") {
    return (
      <g transform="translate(86 280)" stroke={INK} strokeWidth={2} strokeLinejoin="round">
        <rect x={-9} y={-11} width={18} height={22} rx={5} fill="#20202A" />
        <rect x={-6} y={-8} width={12} height={16} rx={2} fill="#3DA4E0" />
      </g>
    );
  }
  return null;
}

/* ========================= process band ========================= */

const BAND: Record<ProcessCode, ReactElement> = {
  IN: (
    <g>
      <rect x={-12} y={-8} width={24} height={16} rx={4} fill="#FF9933" />
      <rect x={-12} y={-2} width={24} height={4} fill="#F4F4F4" />
      <rect x={-12} y={2} width={24} height={6} rx={2} fill="#138808" />
      <circle cx={0} cy={0} r={1.6} fill="#06038D" />
    </g>
  ),
  US: (
    <g>
      <rect x={-12} y={-8} width={24} height={16} rx={4} fill="#B22234" />
      <rect x={-12} y={-8} width={11} height={8} fill="#3C3B6E" />
      <rect x={-1} y={-6} width={13} height={2.4} fill="#F4F4F4" />
      <rect x={-1} y={0} width={13} height={2.4} fill="#F4F4F4" />
      <rect x={-1} y={5} width={13} height={2.4} fill="#F4F4F4" />
    </g>
  ),
  UK: (
    <g>
      <rect x={-12} y={-8} width={24} height={16} rx={4} fill="#012169" />
      <rect x={-2} y={-8} width={4} height={16} fill="#F4F4F4" />
      <rect x={-12} y={-2} width={24} height={4} fill="#F4F4F4" />
      <rect x={-1} y={-8} width={2} height={16} fill="#C8102E" />
      <rect x={-12} y={-1} width={24} height={2} fill="#C8102E" />
    </g>
  ),
  AU: (
    <g>
      <rect x={-12} y={-8} width={24} height={16} rx={4} fill="#012169" />
      <rect x={-12} y={-8} width={10} height={8} fill="#00247D" />
      <path d="M-9 -6 l1 6 M-11 -4 h6" stroke="#F4F4F4" strokeWidth={1} />
      <circle cx={4} cy={2} r={2} fill="#F4F4F4" />
    </g>
  ),
};

export function ProcessBand({ process, uid }: { process?: ProcessCode | undefined; uid: string }) {
  if (!process) return null;
  const clip = `ovband-${uid}`;
  return (
    <g transform="translate(216 288) rotate(8)">
      <defs>
        <clipPath id={clip}>
          <rect x={-12} y={-8} width={24} height={16} rx={4} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>{BAND[process]}</g>
      <rect x={-12} y={-8} width={24} height={16} rx={4} fill="none" stroke={INK} strokeWidth={2} />
    </g>
  );
}

/* ============================ pose props ======================== */

export function LaptopProp({ p }: { p: Palette }) {
  return (
    <g transform="translate(150 258)" stroke={INK} strokeWidth={3.2} strokeLinejoin="round">
      <path d="M-52 20 h104 l11 22 h-126 Z" fill="#C9C7D2" />
      <rect x={-44} y={-22} width={88} height={44} rx={5} fill="#2A2530" />
      <rect x={-38} y={-17} width={76} height={34} rx={2} fill={p.outfit.light} />
      <path d="M-28 -8 h52 M-28 1 h38" stroke="#2A2530" strokeWidth={2.6} strokeLinecap="round" />
    </g>
  );
}
