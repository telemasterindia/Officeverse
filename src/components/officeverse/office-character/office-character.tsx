import { useId } from "react";
import { HAIR, OUTFIT_COLOR, SKIN } from "@/lib/officeverse/avatar";
import type { AvatarConfig, CharacterPose, Expression, ProcessCode } from "@/lib/officeverse/types";
import { cn } from "@/lib/utils";
import {
  AccessoryChest,
  Arm,
  Face,
  FacialHairLayer,
  GlassesLayer,
  HairBack,
  HairFront,
  HandAccessory,
  Head,
  HeadwearLayer,
  LaptopProp,
  Legs,
  ProcessBand,
  Torso,
  type Palette,
} from "./parts";

/**
 * OfficeCharacter — the original full-body Officeverse character.
 * One canonical renderer. Layered inline SVG from `parts.tsx`; `pose` + `expression`
 * are visual props. Used everywhere the current user's identity appears
 * (AvatarDisplay for small spots, CharacterStage for hero spots).
 */
export function OfficeCharacter({
  config,
  process,
  pose = "idle",
  expression,
  frame = "full",
  animated = true,
  title,
  className,
}: {
  config: AvatarConfig;
  process?: ProcessCode | undefined;
  pose?: CharacterPose;
  expression?: Expression | undefined;
  frame?: "full" | "bust";
  animated?: boolean;
  title?: string | undefined;
  className?: string | undefined;
}) {
  const uid = useId().replace(/:/g, "");
  const skin = SKIN[config.skin];
  const hair = HAIR[config.hairColor];
  const outfit = OUTFIT_COLOR[config.outfitColor];
  const PANTS = { base: "#3B3B4C", shadow: "#2B2B39", light: "#4E4E62" };
  const g = {
    skin: `url(#ovg-sk-${uid})`,
    hair: `url(#ovg-hr-${uid})`,
    outfit: `url(#ovg-of-${uid})`,
    pants: `url(#ovg-pt-${uid})`,
  };
  const p: Palette = { skin, hair, outfit, grad: g };
  const expr: Expression = expression ?? config.expression;
  const pres = config.presentation ?? "neutral";
  const wrapped = config.headwear === "turban";

  return (
    <svg
      viewBox={frame === "bust" ? "66 4 168 168" : "0 0 300 440"}
      preserveAspectRatio={frame === "bust" ? "xMidYMid meet" : "xMidYMax meet"}
      className={cn("ov-char block h-full w-full", animated && "ov-char--animated", className)}
      data-pose={pose}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        {/* Per-instance volumetric fills — warm key light from the upper-left. */}
        <radialGradient id={`ovg-sk-${uid}`} cx="0.34" cy="0.28" r="0.95">
          <stop offset="0" stopColor={skin.light} />
          <stop offset="0.55" stopColor={skin.base} />
          <stop offset="1" stopColor={skin.shadow} />
        </radialGradient>
        <radialGradient id={`ovg-hr-${uid}`} cx="0.34" cy="0.22" r="0.95">
          <stop offset="0" stopColor={hair.light} />
          <stop offset="0.5" stopColor={hair.base} />
          <stop offset="1" stopColor={hair.shadow} />
        </radialGradient>
        <linearGradient id={`ovg-of-${uid}`} x1="0.18" y1="0" x2="0.82" y2="1">
          <stop offset="0" stopColor={outfit.light} />
          <stop offset="0.5" stopColor={outfit.base} />
          <stop offset="1" stopColor={outfit.shadow} />
        </linearGradient>
        <linearGradient id={`ovg-pt-${uid}`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={PANTS.light} />
          <stop offset="0.55" stopColor={PANTS.base} />
          <stop offset="1" stopColor={PANTS.shadow} />
        </linearGradient>
        <radialGradient id={`ovg-gnd-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#0B0A12" stopOpacity="0.32" />
          <stop offset="1" stopColor="#0B0A12" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* grounding contact shadow */}
      <ellipse cx={150} cy={430} rx={96} ry={16} fill={`url(#ovg-gnd-${uid})`} />

      <Legs p={p} pres={pres} />
      {pose === "working" ? <LaptopProp p={p} /> : null}

      <g className="ov-c-body">
        {!wrapped ? <HairBack style={config.hair} hair={p.hair} /> : null}
        <Torso p={p} outfit={config.outfit} pres={pres} />
        <Arm side="l" p={p} outfit={config.outfit} />
        <Arm side="r" p={p} outfit={config.outfit} />
        <AccessoryChest kind={config.accessory} p={p} />
        <HandAccessory kind={config.accessory} />
        <ProcessBand process={process} uid={uid} />

        <g className="ov-c-head">
          <Head p={p} pres={pres} />
          <FacialHairLayer kind={config.facialHair} hair={p.hair} />
          <Face p={p} expr={expr} pres={pres} />
          {!wrapped ? <HairFront style={config.hair} hair={p.hair} /> : null}
          {!wrapped ? (
            <path
              d="M100 46 Q150 22 200 46"
              stroke="#FFFFFF"
              strokeWidth={7}
              opacity={0.16}
              fill="none"
              strokeLinecap="round"
            />
          ) : null}
          <GlassesLayer kind={config.glasses} />
          <HeadwearLayer kind={config.headwear} p={p} />
        </g>
      </g>
    </svg>
  );
}
