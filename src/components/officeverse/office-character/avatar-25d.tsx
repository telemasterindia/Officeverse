import { useEffect, useId, useRef } from "react";
import { HAIR, OUTFIT_COLOR, SKIN } from "@/lib/officeverse/avatar";
import type { AvatarConfig, CharacterPose, Expression } from "@/lib/officeverse/types";
import { cn } from "@/lib/utils";

/**
 * TeleMaster India — 2.5D employee avatar.
 *
 * A single reusable, mature stylised character built from layered SVG with
 * gradient form-shading, occlusion, key + rim light and a parallax tilt so the
 * figure reads as physically present in the room. Masculine / feminine /
 * neutral / Sikh (turban) presentations all share one visual language.
 *
 * Identity comes straight from the existing AvatarConfig. Pose + expression
 * drive held CSS poses over a continuous idle. Nothing here touches identity
 * logic, persistence, the process system or routing.
 */

type Pres = "feminine" | "masculine" | "neutral";

const HAIR_BUCKET = (h: string): "short" | "textured" | "long" => {
  if (h === "long" || h === "ponytail" || h === "bun") return "long";
  if (h === "messy" || h === "wavy" || h === "curly" || h === "coily") return "textured";
  return "short";
};
const SLEEVELESS = (o: string) => o === "tee" || o === "polo";

/* ------------------------------- the figure ------------------------------- */

function Figure({
  config,
  pose,
  expression,
  uid,
}: {
  config: AvatarConfig;
  pose: CharacterPose;
  expression: Expression;
  uid: string;
}) {
  const pres: Pres =
    config.presentation === "feminine" || config.presentation === "masculine"
      ? config.presentation
      : "neutral";
  const fem = pres === "feminine";
  const masc = pres === "masculine";
  const sk = SKIN[config.skin];
  const hr = HAIR[config.hairColor];
  const of = OUTFIT_COLOR[config.outfitColor];
  const isSikh = config.headwear === "turban";
  const hairKind = HAIR_BUCKET(config.hair);
  const sleeveless = SLEEVELESS(config.outfit);
  const beard =
    isSikh ||
    config.facialHair === "fullBeard" ||
    config.facialHair === "shortBeard" ||
    config.facialHair === "goatee";
  const stubble = config.facialHair === "stubble";
  const moustache =
    isSikh || config.facialHair === "moustache" || config.facialHair === "fullBeard";

  const grad = (n: string) => `url(#a25-${n}-${uid})`;
  const INK = "#2b2230";

  // presentation deltas — a genuine young adult: compact oval face, soft jaw,
  // youthful cheeks. Torso proportions unchanged.
  const S = fem ? 96 : masc ? 124 : 110; // shoulder half-width
  const W = fem ? 78 : masc ? 84 : 81; // waist half-width
  const jaw = fem ? 0.82 : masc ? 0.96 : 0.88; // jaw taper (soft, not square)
  const chinY = fem ? 138 : masc ? 143 : 140; // compact lower face
  const lip = fem ? "#d98f98" : "#cd8a7d"; // warm, healthy lip

  // expression — a friendly, confident baseline. Even "neutral" holds a subtle
  // genuine smile and a relaxed brow; no state ever returns to stern.
  const smiling = expression === "happy" || expression === "excited";
  const open = expression === "excited";
  const worried = expression === "concerned";
  const thinking = expression === "thinking";
  const focus = expression === "focused" || thinking;
  // small brow tilt only — negative lifts the inner corner (open / welcoming)
  const browTiltL = worried ? -3 : thinking ? -5 : focus ? 1 : -2;
  const browTiltR = worried ? -3 : thinking ? 0 : focus ? 1 : -2;
  const browY = (worried ? 72 : 74) - (fem ? 2 : 0); // relaxed, a touch higher/finer for fem
  const browOpacity = fem ? 0.72 : 0.82;
  // corner lift of the mouth — the smile strength (px the corners sit above centre)
  const smile = open ? 3 : smiling ? 6 : worried ? -3 : 3.5;
  const lowerLip = open ? 13 : 7;
  const mouthY = chinY - 25;
  const mouthL = 164;
  const mouthR = 196;
  const eyeSquint = focus ? 2.5 : 0; // gentle lid drop when focused
  const eyeOpen = open ? 2 : 0;

  // arm anchor
  const shX = S - 6; // shoulder joint x offset from centre
  const elbowX = S + 4;
  const wristX = S - 44;

  const armPath = (dir: 1 | -1) =>
    `M${180 + dir * (shX - 18)} 196
     C ${180 + dir * (shX + 10)} 202 ${180 + dir * (elbowX + 2)} 250 ${180 + dir * elbowX} 300
     C ${180 + dir * (elbowX - 2)} 320 ${180 + dir * (elbowX - 14)} 330 ${180 + dir * (elbowX - 30)} 330
     C ${180 + dir * (elbowX - 40)} 300 ${180 + dir * (elbowX - 44)} 250 ${180 + dir * (shX - 30)} 206 Z`;

  const forePath = (dir: 1 | -1) =>
    `M${180 + dir * (elbowX - 2)} 300
     C ${180 + dir * (elbowX - 6)} 330 ${180 + dir * (wristX + 26)} 372 ${180 + dir * wristX} 396
     l ${dir * -20} -22
     C ${180 + dir * (wristX + 20)} 350 ${180 + dir * (elbowX - 28)} 314 ${180 + dir * (elbowX - 34)} 296 Z`;

  return (
    <svg
      viewBox="0 0 360 440"
      className="ov25 block h-full w-full"
      data-pose={pose}
      role="presentation"
      aria-hidden
    >
      <defs>
        <radialGradient id={`a25-skin-${uid}`} cx="0.34" cy="0.24" r="1">
          <stop offset="0" stopColor={sk.light} />
          <stop offset="0.5" stopColor={sk.base} />
          <stop offset="1" stopColor={sk.shadow} />
        </radialGradient>
        {/* soft cinematic key light from the upper-left */}
        <radialGradient id={`a25-key-${uid}`} cx="0.3" cy="0.18" r="0.85">
          <stop offset="0" stopColor="#ffe7c9" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#ffe7c9" stopOpacity="0" />
        </radialGradient>
        {/* cool rim on the shadow side */}
        <linearGradient id={`a25-rim-${uid}`} x1="1" y1="0.2" x2="0" y2="0.8">
          <stop offset="0" stopColor="#cfe0ff" stopOpacity="0.4" />
          <stop offset="0.35" stopColor="#cfe0ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`a25-neck-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sk.shadow} />
          <stop offset="1" stopColor={sk.base} />
        </linearGradient>
        <linearGradient id={`a25-hair-${uid}`} x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor={hr.light} />
          <stop offset="0.5" stopColor={hr.base} />
          <stop offset="1" stopColor={hr.shadow} />
        </linearGradient>
        <linearGradient id={`a25-outfit-${uid}`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={of.light} />
          <stop offset="0.5" stopColor={of.base} />
          <stop offset="1" stopColor={of.shadow} />
        </linearGradient>
        <radialGradient id={`a25-iris-${uid}`} cx="0.5" cy="0.4" r="0.62">
          <stop offset="0" stopColor="#8a6a49" />
          <stop offset="0.6" stopColor="#573a24" />
          <stop offset="1" stopColor="#2a1a10" />
        </radialGradient>
        <linearGradient id={`a25-turban-${uid}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={of.light} />
          <stop offset="0.55" stopColor={of.base} />
          <stop offset="1" stopColor={of.shadow} />
        </linearGradient>
      </defs>

      <ellipse cx="180" cy="432" rx="150" ry="16" fill="#1a1424" opacity="0.14" />

      <g className="ov25-body">
        {/* long hair mass behind the shoulders */}
        {!isSikh && hairKind === "long" ? (
          <path
            d="M126 96 C 104 160 100 260 116 344 L 150 344 C 138 262 140 164 152 100 Z
               M234 96 C 256 160 260 260 244 344 L 210 344 C 222 262 220 164 208 100 Z"
            fill={grad("hair")}
            opacity="0.95"
          />
        ) : null}

        {/* ---- torso ---- */}
        <path
          d={`M${180 - 26} 168
              C ${180 - 46} 170 ${180 - S + 8} 182 ${180 - S} 198
              C ${180 - S - 4} 248 ${180 - W - 6} 300 ${180 - W} 336
              C ${180 - W - 4} 380 ${180 - W - 8} 412 ${180 - W - 6} 440
              L ${180 + W + 6} 440
              C ${180 + W + 8} 412 ${180 + W + 4} 380 ${180 + W} 336
              C ${180 + S + 6} 300 ${180 + S + 4} 248 ${180 + S} 198
              C ${180 + S - 8} 182 ${180 + 46} 170 ${180 + 26} 168
              C ${180 + 10} 176 ${180 - 10} 176 ${180 - 26} 168 Z`}
          fill={grad("outfit")}
        />
        {/* core shadow (right) + fill shadow (left) */}
        <path
          d={`M${180 + W - 6} 200 C ${180 + S + 2} 250 ${180 + W + 2} 320 ${180 + W} 440 L ${180 + W + 6} 440 C ${180 + W + 12} 330 ${180 + S + 8} 250 ${180 + S} 200 Z`}
          fill={of.shadow}
          opacity="0.5"
        />
        <path
          d={`M${180 - S} 200 C ${180 - S - 8} 250 ${180 - W - 10} 330 ${180 - W - 8} 440 L ${180 - W - 2} 440 C ${180 - W} 320 ${180 - S + 4} 248 ${180 - S + 6} 200 Z`}
          fill={of.shadow}
          opacity="0.28"
        />
        {/* chest planes + placket */}
        <path
          d={`M${180 - W + 10} 220 C ${180 - 34} 280 ${180 - 30} 360 ${180 - 28} 440`}
          stroke={of.shadow}
          strokeWidth="9"
          opacity="0.24"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M${180 + W - 10} 220 C ${180 + 34} 280 ${180 + 30} 360 ${180 + 28} 440`}
          stroke={of.shadow}
          strokeWidth="9"
          opacity="0.24"
          fill="none"
          strokeLinecap="round"
        />
        <path d="M180 190 L180 440" stroke={of.shadow} strokeWidth="2.4" opacity="0.5" />
        <path
          d="M148 196 C 152 260 152 350 150 440 M212 196 C 208 260 208 350 210 440"
          stroke={of.light}
          strokeWidth="3"
          opacity="0.3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d={`M${180 - S + 20} 200 C ${180 - 44} 178 ${180 + 44} 178 ${180 + S - 20} 200`}
          stroke="#ffffff"
          strokeWidth="6"
          opacity="0.14"
          fill="none"
          strokeLinecap="round"
        />

        {/* collar */}
        {!sleeveless ? (
          <g>
            <path d="M160 172 q20 18 40 0 l-4 16 q-16 14 -32 0 Z" fill={sk.shadow} opacity="0.4" />
            <path d="M162 172 q18 16 36 0 l-3 13 q-15 12 -30 0 Z" fill="#edecf1" opacity="0.9" />
            <path d="M150 170 q30 -16 60 0 l-5 12 q-25 -12 -50 0 Z" fill={of.shadow} />
            <path
              d="M158 176 L144 214 L172 188 L173 176 Z"
              fill={grad("outfit")}
              stroke={of.shadow}
              strokeWidth="1.4"
            />
            <path
              d="M202 176 L216 214 L188 188 L187 176 Z"
              fill={grad("outfit")}
              stroke={of.shadow}
              strokeWidth="1.4"
            />
            <path d="M158 176 L144 214 L154 202 L164 180 Z" fill={of.shadow} opacity="0.5" />
            <circle cx="180" cy="240" r="3.2" fill={of.shadow} />
            <circle cx="180" cy="286" r="3.2" fill={of.shadow} />
            <circle cx="180" cy="332" r="3.2" fill={of.shadow} />
          </g>
        ) : (
          <path d="M156 172 q24 22 48 0 l-4 15 q-20 18 -40 0 Z" fill={of.shadow} opacity="0.7" />
        )}

        {config.accessory === "lanyard" ? (
          <g opacity="0.92">
            <path
              d="M168 178 C 165 200 163 214 165 226"
              stroke="#39354222"
              strokeWidth="4"
              fill="none"
            />
            <path
              d="M192 178 C 195 200 197 214 195 226"
              stroke="#393542"
              strokeWidth="4"
              fill="none"
              opacity="0.5"
            />
            <rect
              x="170"
              y="222"
              width="24"
              height="30"
              rx="3.5"
              fill="#f2f0f6"
              stroke="#c7c4d0"
              strokeWidth="1.4"
            />
            <rect x="170" y="222" width="24" height="9" rx="3.5" fill={of.shadow} />
            <rect x="176" y="236" width="12" height="8" rx="2" fill="#c7c4d0" />
          </g>
        ) : null}

        {/* ---- arms ---- */}
        <g className="ov25-arm ov25-arm-l">
          <path d={armPath(-1)} fill={grad("outfit")} />
          <path
            d={`M${180 - elbowX + 2} 250 C ${180 - elbowX - 4} 276 ${180 - elbowX} 296 ${180 - elbowX + 8} 306`}
            stroke={of.shadow}
            strokeWidth="6"
            opacity="0.4"
            fill="none"
            strokeLinecap="round"
          />
          <g className="ov25-fore ov25-fore-l">
            <path d={forePath(-1)} fill={sleeveless ? grad("skin") : grad("outfit")} />
            {!sleeveless ? (
              <path
                d={`M${180 - wristX - 4} 372 l 22 18 -7 13 -23 -16 Z`}
                fill={of.light}
                opacity="0.4"
              />
            ) : null}
            <path
              d={`M${180 - wristX + 20} 376
                  c 14 -4 26 2 30 14 c 3 12 -4 24 -18 28 c -16 4 -32 -2 -38 -14
                  c -4 -10 2 -22 12 -26 c 4 -8 10 -12 12 -14 Z`}
              fill={grad("skin")}
            />
            <path
              d={`M${180 - wristX + 6} 404 q 20 9 40 -2`}
              stroke={sk.shadow}
              strokeWidth="2.6"
              opacity="0.45"
              fill="none"
            />
            <path
              d={`M${180 - wristX + 34} 380 q 7 -5 12 -2`}
              stroke={sk.shadow}
              strokeWidth="3"
              opacity="0.45"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        </g>
        <g className="ov25-arm ov25-arm-r">
          <path d={armPath(1)} fill={grad("outfit")} />
          <path
            d={`M${180 + elbowX - 2} 250 C ${180 + elbowX + 4} 276 ${180 + elbowX} 296 ${180 + elbowX - 8} 306`}
            stroke={of.shadow}
            strokeWidth="6"
            opacity="0.45"
            fill="none"
            strokeLinecap="round"
          />
          <g className="ov25-fore ov25-fore-r">
            <path d={forePath(1)} fill={sleeveless ? grad("skin") : grad("outfit")} />
            {!sleeveless ? (
              <path
                d={`M${180 + wristX + 4} 372 l -22 18 7 13 23 -16 Z`}
                fill={of.light}
                opacity="0.4"
              />
            ) : null}
            <g className="ov25-hand-r">
              <path
                d={`M${180 + wristX - 20} 376
                    c -14 -4 -26 2 -30 14 c -3 12 4 24 18 28 c 16 4 32 -2 38 -14
                    c 4 -10 -2 -22 -12 -26 c -4 -8 -10 -12 -12 -14 Z`}
                fill={grad("skin")}
              />
              <path
                d={`M${180 + wristX - 6} 404 q -20 9 -40 -2`}
                stroke={sk.shadow}
                strokeWidth="2.6"
                opacity="0.45"
                fill="none"
              />
            </g>
          </g>
        </g>

        {/* ---- neck ---- */}
        <path d="M160 130 h40 v42 q-20 14 -40 0 Z" fill={grad("neck")} />
        <path d="M158 128 q22 20 44 0 v10 q-22 18 -44 0 Z" fill={sk.shadow} opacity="0.6" />

        {/* ---- head ---- */}
        <g className="ov25-head">
          {/* ears */}
          <path d="M139 86 c-9 -1 -13 8 -10 18 c2 8 10 12 16 8 Z" fill={grad("skin")} />
          <path d="M221 86 c9 -1 13 8 10 18 c-2 8 -10 12 -16 8 Z" fill={grad("skin")} />
          <path
            d="M136 92 q4 6 2 14 M224 92 q-4 6 -2 14"
            stroke={sk.shadow}
            strokeWidth="2"
            opacity="0.4"
            fill="none"
            strokeLinecap="round"
          />

          {/* head — soft youthful oval with a gentle jaw */}
          {(() => {
            const head = `M180 30
              C 152 30 138 46 136 68
              C 134 90 136 104 144 120
              C 150 134 ${180 - 30 * jaw} ${chinY - 3} 180 ${chinY + 4}
              C ${180 + 30 * jaw} ${chinY - 3} 210 134 216 120
              C 224 104 226 90 224 68
              C 222 46 208 30 180 30 Z`;
            return (
              <>
                <path d={head} fill={grad("skin")} />
                {/* single soft core shadow on the right */}
                <path
                  d={`M210 62 C 216 88 210 114 ${180 + 26 * jaw} ${chinY - 4}
                      C ${180 + 12} ${chinY} ${180 + 8} ${chinY - 8} ${180 + 10} ${chinY - 16}
                      C ${180 + 22} 114 ${180 + 24} 90 ${180 + 22} 64 Z`}
                  fill={sk.shadow}
                  opacity="0.22"
                />
                {/* warm key light + cool rim wrap the whole head */}
                <path d={head} fill={`url(#a25-key-${uid})`} />
                <path d={head} fill={`url(#a25-rim-${uid})`} />
              </>
            );
          })()}

          {/* under-jaw / neck occlusion */}
          <path
            d={`M${180 - 22} ${chinY - 3} Q 180 ${chinY + 11} ${180 + 22} ${chinY - 3} Q 180 ${chinY + 3} ${180 - 22} ${chinY - 3} Z`}
            fill={sk.shadow}
            opacity="0.24"
          />

          {/* cheekbone light + subtle warm blush */}
          <ellipse cx="151" cy={chinY - 52} rx="11" ry="7" fill={sk.light} opacity="0.38" />
          <ellipse cx="157" cy={chinY - 46} rx="11" ry="7" fill="#e8927a" opacity="0.11" />
          <ellipse cx="204" cy={chinY - 46} rx="11" ry="7" fill="#e8927a" opacity="0.09" />

          {/* nose — minimal: faint bridge, soft tip, nostril hints */}
          <path
            d="M182 82 Q 185 94 184 103"
            stroke={sk.shadow}
            strokeWidth="2"
            opacity="0.13"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse cx="180" cy="103" rx="4.2" ry="3" fill={sk.light} opacity="0.45" />
          <path
            d="M175 105 q-2 3 0 5 q3 2 6 1 M185 105 q2 3 0 5 q-3 2 -6 1"
            stroke={sk.shadow}
            strokeWidth="1.5"
            opacity="0.22"
            fill="none"
            strokeLinecap="round"
          />

          {/* brows — groomed, thin, softly arched, relaxed */}
          <path
            d={`M145 ${browY + 2.5} Q 156 ${browY - 3} 162 ${browY - 2} Q 169 ${browY - 1} 175 ${browY + 1} Q 172 ${browY + 2.5} 162 ${browY + 1.5} Q 152 ${browY + 3} 145 ${browY + 2.5} Z`}
            fill={hr.base}
            opacity={browOpacity}
            transform={`rotate(${browTiltL} 175 ${browY})`}
          />
          <path
            d={`M215 ${browY + 2.5} Q 204 ${browY - 3} 198 ${browY - 2} Q 191 ${browY - 1} 185 ${browY + 1} Q 188 ${browY + 2.5} 198 ${browY + 1.5} Q 208 ${browY + 3} 215 ${browY + 2.5} Z`}
            fill={hr.base}
            opacity={browOpacity}
            transform={`rotate(${-browTiltR} 185 ${browY})`}
          />

          {/* eyes — appealing youthful almond; iris fills the aperture (engaged) */}
          <g className="ov25-eyes">
            {[-1, 1].map((s) => {
              const cx = 180 + s * 18;
              const cy = 84;
              const lidH = 13 + eyeOpen - eyeSquint;
              return (
                <g key={s} transform={`rotate(${s * -1} ${cx} ${cy})`}>
                  <ellipse cx={cx} cy={cy - 2} rx="17" ry="7" fill={sk.shadow} opacity="0.06" />
                  <path d={`M${cx - 16} ${cy} q16 -${lidH} 32 0 q-16 9 -32 0 Z`} fill="#faf8f5" />
                  <circle cx={cx} cy={cy + 1.5} r="7.4" fill={grad("iris")} />
                  <circle
                    cx={cx}
                    cy={cy + 1.5}
                    r="7.4"
                    fill="none"
                    stroke="#3a2416"
                    strokeWidth="0.9"
                    strokeOpacity="0.35"
                  />
                  <circle cx={cx} cy={cy + 1.5} r="2.9" fill="#241610" />
                  <circle cx={cx - 2.6} cy={cy - 1.4} r="2.6" fill="#fff" opacity="0.97" />
                  <circle cx={cx + 2.6} cy={cy + 3.4} r="1" fill="#fff" opacity="0.55" />
                  {/* upper lid line — soft warm brown */}
                  <path
                    d={`M${cx - 16} ${cy} q16 -${lidH} 32 0`}
                    stroke="#4a3630"
                    strokeWidth="1.7"
                    fill="none"
                    strokeLinecap="round"
                  />
                  <path
                    d={`M${cx + 11} ${cy - 5} q5 0 7 2.5`}
                    stroke="#4a3630"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                    opacity="0.65"
                  />
                  {/* lower lid — barely there */}
                  <path
                    d={`M${cx - 12} ${cy + 2} q12 3 24 -1`}
                    stroke={sk.shadow}
                    strokeWidth="1.2"
                    opacity="0.18"
                    fill="none"
                    strokeLinecap="round"
                  />
                  {fem ? (
                    <path
                      d={`M${cx + 14} ${cy - 2.5} q5 -1 9 -3.5`}
                      stroke={INK}
                      strokeWidth="1.7"
                      opacity="0.6"
                      fill="none"
                      strokeLinecap="round"
                    />
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* mouth — warm, relaxed, upturned smile */}
          {(() => {
            const mY = mouthY;
            const L = mouthL;
            const R = mouthR;
            return (
              <>
                <ellipse
                  cx={L - 3}
                  cy={mY - smile - 1}
                  rx="5"
                  ry="4"
                  fill={sk.light}
                  opacity="0.3"
                />
                <ellipse
                  cx={R + 3}
                  cy={mY - smile - 1}
                  rx="5"
                  ry="4"
                  fill={sk.light}
                  opacity="0.3"
                />
                {open ? (
                  <>
                    <path
                      d={`M${L} ${mY - smile} Q 180 ${mY - smile - 4} ${R} ${mY - smile} Q 180 ${mY + lowerLip} ${L} ${mY - smile} Z`}
                      fill="#7a3f44"
                    />
                    <path
                      d={`M${L + 3} ${mY - smile + 1} q13 4 24 0 l-2 5 q-10 3 -20 0 Z`}
                      fill="#f6ece7"
                    />
                  </>
                ) : (
                  <>
                    <path
                      d={`M${L + 2} ${mY} Q 180 ${mY + lowerLip} ${R - 2} ${mY} Q 180 ${mY + 2} ${L + 2} ${mY} Z`}
                      fill={lip}
                      opacity="0.9"
                    />
                    <path
                      d={`M${L} ${mY - smile} Q 172 ${mY - smile + 1} 178 ${mY + 0.5} Q 180 ${mY - 1} 182 ${mY + 0.5} Q 188 ${mY - smile + 1} ${R} ${mY - smile} Q 180 ${mY + 2} ${L} ${mY - smile} Z`}
                      fill={lip}
                      opacity="0.6"
                    />
                    <path
                      d={`M${L} ${mY - smile} Q 180 ${mY + 1.5} ${R} ${mY - smile}`}
                      stroke="#8a4b48"
                      strokeWidth="1.6"
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d={`M172 ${mY + 3} q8 2 16 0`}
                      stroke="#fff"
                      strokeWidth="1.4"
                      opacity="0.25"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </>
                )}
              </>
            );
          })()}
          <ellipse cx="180" cy={chinY - 6} rx="8" ry="5" fill={sk.light} opacity="0.3" />

          {/* facial hair */}
          {stubble ? (
            <path
              d={`M144 100 C 146 128 158 ${chinY} 180 ${chinY} C 202 ${chinY} 214 128 216 100 C 210 118 198 130 180 130 C 162 130 150 118 144 100 Z`}
              fill={hr.base}
              opacity="0.14"
            />
          ) : null}
          {beard ? (
            <g>
              <path
                d={`M140 96
                    C 138 130 150 ${chinY + (isSikh ? 26 : 10)} 180 ${chinY + (isSikh ? 32 : 14)}
                    C 210 ${chinY + (isSikh ? 26 : 10)} 222 130 220 96
                    C 214 118 202 136 180 136 C 158 136 146 118 140 96 Z`}
                fill={grad("hair")}
              />
              <path
                d={`M156 112 C 160 134 170 ${chinY} 180 ${chinY + 2} C 190 ${chinY} 200 134 204 112`}
                stroke={hr.shadow}
                strokeWidth="2.4"
                opacity="0.45"
                fill="none"
              />
              <path
                d="M150 100 q30 12 60 0"
                stroke={hr.light}
                strokeWidth="2.4"
                opacity="0.35"
                fill="none"
              />
            </g>
          ) : null}
          {moustache ? (
            <path
              d={`M166 ${mouthY - smile - 6} q14 6 28 0 q-6 -6 -14 -4 q-8 -2 -14 4 Z`}
              fill={grad("hair")}
            />
          ) : null}
          {/* a clear, friendly smile stays visible through a beard */}
          {beard ? (
            <g>
              <path
                d={`M${mouthL - 1} ${mouthY - smile - 2}
                    Q 180 ${mouthY - smile - 5} ${mouthR + 1} ${mouthY - smile - 2}
                    Q 180 ${mouthY + lowerLip + 3} ${mouthL - 1} ${mouthY - smile - 2} Z`}
                fill={grad("skin")}
              />
              {/* upper lip */}
              <path
                d={`M${mouthL} ${mouthY - smile} Q 180 ${mouthY - smile + 3} ${mouthR} ${mouthY - smile}`}
                stroke={lip}
                strokeWidth="2.4"
                fill="none"
                strokeLinecap="round"
                opacity="0.85"
              />
              {/* smiling teeth — a bright upturned sliver */}
              <path
                d={`M${mouthL + 3} ${mouthY - smile + 1}
                    Q 180 ${mouthY - 1} ${mouthR - 3} ${mouthY - smile + 1}
                    Q 180 ${mouthY + 4} ${mouthL + 3} ${mouthY - smile + 1} Z`}
                fill="#f4ebe4"
              />
              {/* fuller lower lip */}
              <path
                d={`M${mouthL + 2} ${mouthY + 3} Q 180 ${mouthY + lowerLip + 2} ${mouthR - 2} ${mouthY + 3}`}
                stroke={lip}
                strokeWidth="3.4"
                fill="none"
                strokeLinecap="round"
                opacity="0.9"
              />
            </g>
          ) : null}

          {/* hair / turban */}
          {isSikh ? (
            <g>
              {/* full dastaar dome */}
              <path
                d="M112 68 C 106 4 148 -14 180 -14 C 212 -14 254 4 248 68
                   C 244 34 218 22 180 22 C 142 22 116 34 112 68 Z"
                fill={grad("turban")}
              />
              <path
                d="M116 60 C 140 30 220 30 244 60"
                stroke={of.shadow}
                strokeWidth="5"
                fill="none"
                opacity="0.6"
              />
              <path
                d="M120 42 C 145 12 215 12 240 42"
                stroke={of.shadow}
                strokeWidth="4.5"
                fill="none"
                opacity="0.5"
              />
              <path
                d="M126 24 C 148 -2 212 -2 234 24"
                stroke={of.light}
                strokeWidth="4"
                fill="none"
                opacity="0.45"
              />
              <path d="M172 -10 q8 -12 16 0 q-3 18 -8 24 q-5 -6 -8 -24 Z" fill={of.shadow} />
              <path
                d="M112 68 q4 -18 24 -24 M248 68 q-4 -18 -24 -24"
                stroke={of.shadow}
                strokeWidth="3.5"
                fill="none"
                opacity="0.5"
              />
              <path
                d="M126 20 C 150 4 210 4 234 20"
                stroke="#fff"
                strokeWidth="4"
                opacity="0.15"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          ) : hairKind === "long" ? (
            <g>
              {/* crown + soft centre-parted front framing */}
              <path
                d="M122 78 C 116 38 146 10 180 10 C 214 10 244 38 238 78
                   C 236 52 220 42 200 44
                   C 202 40 194 38 188 44
                   C 186 40 180 38 178 46
                   C 172 40 158 42 156 52
                   C 150 46 138 50 130 60
                   C 126 66 123 70 122 78 Z"
                fill={grad("hair")}
              />
              <path
                d="M126 56 C 116 100 116 154 126 186 C 120 150 122 100 132 64 Z"
                fill={grad("hair")}
              />
              <path
                d="M234 56 C 244 100 244 154 234 186 C 240 150 238 100 228 64 Z"
                fill={grad("hair")}
              />
              <path
                d="M138 28 C 160 12 200 12 222 28"
                stroke={hr.light}
                strokeWidth="3.5"
                opacity="0.38"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M150 44 q30 -12 60 0"
                stroke={hr.shadow}
                strokeWidth="2.4"
                opacity="0.4"
                fill="none"
              />
            </g>
          ) : hairKind === "textured" ? (
            <g>
              {/* dark under-layer for depth */}
              <path
                d="M120 90 C 112 42 122 8 158 6 C 164 -2 178 -4 190 6 C 226 6 248 30 242 88
                   C 240 66 232 56 220 58 C 217 68 212 62 206 52 C 202 62 195 68 190 56
                   C 186 66 183 60 180 50 C 177 60 174 66 170 56 C 165 66 158 62 154 52
                   C 149 62 143 68 134 58 C 124 62 122 70 120 90 Z"
                fill={hr.shadow}
              />
              {/* main mass with a naturally wavy, textured hairline (one shape) */}
              <path
                d="M126 86 C 120 46 128 14 158 12 C 164 4 178 2 188 12 C 220 12 238 34 234 84
                   C 232 66 226 58 216 58
                   C 214 66 210 62 206 54
                   C 202 62 196 66 192 56
                   C 188 64 184 60 180 52
                   C 176 60 172 64 168 56
                   C 164 64 158 62 154 54
                   C 150 62 144 66 136 58
                   C 128 62 126 68 126 86 Z"
                fill={grad("hair")}
              />
              {/* soft interior shadow under the hairline */}
              <path
                d="M150 52 C 168 44 200 46 214 56 C 200 50 168 50 150 58 Z"
                fill={hr.shadow}
                opacity="0.3"
              />
              {/* crown highlights */}
              <path
                d="M136 40 C 158 22 202 22 226 40"
                stroke={hr.light}
                strokeWidth="3"
                opacity="0.38"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M150 24 q14 -8 28 -4 M190 22 q14 -2 22 9"
                stroke={hr.light}
                strokeWidth="2"
                opacity="0.32"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          ) : (
            <g>
              {/* modern textured crop — layered mass, low soft hairline */}
              <path
                d="M120 92 C 114 44 128 12 180 10 C 232 12 242 44 242 92
                   C 238 64 226 54 206 54 C 208 48 200 46 194 50
                   C 191 43 184 42 180 49 C 176 42 169 43 166 50
                   C 160 46 150 50 145 58 C 136 56 126 68 120 92 Z"
                fill={hr.shadow}
              />
              <path
                d="M124 90 C 120 48 134 18 180 16 C 226 18 238 48 236 90
                   C 232 66 220 56 202 56 C 204 50 197 48 192 52
                   C 189 45 183 44 180 50 C 177 44 171 45 168 52
                   C 163 48 154 52 149 60 C 140 58 128 70 124 90 Z"
                fill={grad("hair")}
              />
              <path
                d="M150 58 C 168 49 200 51 214 60 C 200 54 168 54 150 62 Z"
                fill={hr.shadow}
                opacity="0.35"
              />
              <path
                d="M140 34 C 160 20 200 20 222 34"
                stroke={hr.light}
                strokeWidth="2.6"
                opacity="0.32"
                fill="none"
                strokeLinecap="round"
              />
              <path d="M128 68 q-3 18 3 30 l7 -3 q-5 -13 -3 -25 Z" fill={grad("hair")} />
              <path d="M232 68 q3 18 -3 30 l-7 -3 q5 -13 3 -25 Z" fill={grad("hair")} />
            </g>
          )}

          {config.glasses !== "none" ? (
            <g
              stroke={INK}
              strokeWidth={config.glasses === "thin" ? 1.5 : 2}
              fill="rgba(200,225,255,0.08)"
              strokeOpacity="0.85"
            >
              {/* modern lightweight frame — keeps the eyes clearly visible */}
              <rect x="148" y="75" width="31" height="18" rx={config.glasses === "round" ? 9 : 6} />
              <rect x="181" y="75" width="31" height="18" rx={config.glasses === "round" ? 9 : 6} />
              <path d="M179 79 h2" fill="none" />
              <path d="M148 78 l-9 -3 M212 78 l9 -3" fill="none" strokeLinecap="round" />
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  );
}

/* --------------------------- parallax wrapper --------------------------- */

export function Avatar25D({
  config,
  pose = "idle",
  expression,
  className,
}: {
  config: AvatarConfig;
  pose?: CharacterPose;
  expression?: Expression | undefined;
  className?: string | undefined;
}) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const expr: Expression = expression ?? config.expression;

  useEffect(() => {
    const wrap = wrapRef.current;
    const tilt = tiltRef.current;
    if (!wrap || !tilt) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (reduce || coarse) return;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = wrap.getBoundingClientRect();
        const dx = Math.max(
          -1,
          Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.9)),
        );
        const dy = Math.max(
          -1,
          Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 0.9)),
        );
        tilt.style.transform = `rotateX(${(-dy * 4.5).toFixed(2)}deg) rotateY(${(dx * 6.5).toFixed(2)}deg)`;
      });
    };
    const onLeave = () => {
      tilt.style.transform = "rotateX(0deg) rotateY(0deg)";
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div ref={wrapRef} className={cn("ov25-wrap relative", className)}>
      <div ref={tiltRef} className="ov25-tilt h-full w-full">
        <Figure config={config} pose={pose} expression={expr} uid={uid} />
      </div>
    </div>
  );
}
