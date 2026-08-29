/**
 * Contract for the rigged 3D avatar (.glb) that replaces the SVG character in
 * hero spots. Tune these once the model is in place — nothing else needs to change.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HOW TO WIRE UP YOUR MODEL                                                │
 * │ 1. Put the file at:  public/avatars/officeverse-character.glb            │
 * │    (served at the URL below). glTF binary, +Y up, metres, ~1.7 tall.    │
 * │ 2. Set HAS_MODEL = true.                                                 │
 * │ 3. If your animation clips are named differently, edit CLIP_FOR_POSE.    │
 * │ 4. For per-employee colour, name the model's materials so they contain   │
 * │    "skin" / "hair" / "outfit" (or edit MATERIAL_TARGETS). Leave as-is    │
 * │    to render the model exactly as authored.                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 */
import type { CharacterPose } from "@/lib/officeverse/types";

/** Flip to true once the .glb is at MODEL_URL. While false, the SVG character renders (zero 3D cost). */
export const HAS_MODEL = false;

export const MODEL_URL = "/avatars/officeverse-character.glb";

/** Transform applied to the loaded model so it sits naturally in the frame. */
export const MODEL_TRANSFORM = {
  scale: 1,
  /** metres — raise/lower so the feet/hips land where the SVG desk occludes. */
  positionY: -1.5,
  /** radians — face slightly toward camera-left for a 3/4 view. */
  rotationY: 0.35,
};

/** Camera for the seated/workstation framing. */
export const CAMERA = {
  position: [0.15, 0.15, 3.1] as [number, number, number],
  fov: 32,
  /** look-at target height (metres). */
  targetY: -0.15,
};

/**
 * pose → candidate clip names, tried in order. First match wins; if none match,
 * falls back to the first clip named like "idle", else the model's first clip.
 * Names here cover common Mixamo / Ready Player Me / Blender exports.
 */
export const CLIP_FOR_POSE: Record<CharacterPose, string[]> = {
  idle: ["Idle", "idle", "Breathing Idle", "Armature|Idle"],
  working: ["Typing", "Type", "Working", "Idle"],
  focused: ["Typing", "Focus", "Idle"],
  happy: ["Happy", "Nod", "Idle"],
  celebrating: ["Celebrate", "Cheer", "Jump", "Happy", "Idle"],
  thinking: ["Thinking", "Think", "Idle"],
  concerned: ["Concerned", "SadIdle", "Sad Idle", "Idle"],
  tired: ["Tired", "Yawn", "Idle"],
  attention: ["Alert", "StandUp", "Idle"],
  wave: ["Wave", "Waving", "Hello", "Idle"],
};

/** Cross-fade duration between clips, seconds. */
export const CLIP_FADE = 0.35;

/**
 * Material-name substrings (case-insensitive) to tint from the employee's
 * deterministic palette. Empty arrays = don't tint that channel.
 */
export const MATERIAL_TARGETS: { skin: string[]; hair: string[]; outfit: string[] } = {
  skin: ["skin", "body", "face", "head"],
  hair: ["hair"],
  outfit: ["outfit", "shirt", "hoodie", "top", "cloth", "jacket"],
};

/** Idle pointer-parallax: how far the model turns to follow the cursor (radians). */
export const PARALLAX = { yaw: 0.22, pitch: 0.1, ease: 0.5 };

/* -------------------------------------------------------------------------
 * Ready Player Me — proof-of-concept hero avatar.
 *
 * RPM serves a rigged, textured glTF-binary avatar at
 *   https://models.readyplayer.me/<avatarId>.glb
 * with query params for pose / LOD / morph targets. No SDK or new dependency
 * is needed — the existing @react-three/drei useGLTF loader handles it.
 *
 * SWAPPING IN YOUR AVATAR
 * A) Create it at readyplayer.me → set RPM_ENABLED = true and paste the id
 *    into RPM_AVATAR_ID below. (Requires network access to readyplayer.me.)
 * B) OR download the .glb and overwrite  public/avatars/officeverse-character.glb
 *    — no other change needed; it loads from the same origin.
 *
 * The hero currently renders (B): a bundled RIGGED placeholder character, so the
 * 3D pipeline (lighting / shadows / seated pose / idle / parallax) is visible
 * now. The face/hair/outfit are placeholder — your RPM avatar replaces them.
 * ------------------------------------------------------------------------ */
export const RPM_ENABLED = false;

/** POC avatar id — used only when RPM_ENABLED is true. */
const RPM_AVATAR_ID = "6185a4acfb622cf1cdc49348";

export const RPM_AVATAR_URL =
  `https://models.readyplayer.me/${RPM_AVATAR_ID}.glb` +
  "?quality=high&pose=A&morphTargets=ARKit&textureAtlas=1024&lod=0";

/** Bundled placeholder / your downloaded avatar, served from /public. */
export const LOCAL_MODEL_URL = "/avatars/officeverse-character.glb";

/** The GLB the hero actually loads. */
export const MODEL_SRC = RPM_ENABLED ? RPM_AVATAR_URL : LOCAL_MODEL_URL;
/** Draco decode only needed for RPM's compressed GLB. */
export const MODEL_DRACO = RPM_ENABLED;

/** Seated-posture bone rotations (radians), applied once on load.
 *  Both RPM (bare names) and Mixamo/three.js (mixamorig* names) are covered so
 *  the same config works whichever GLB is in place; only the matching keys hit. */
export const SEATED_POSE: Record<string, [number, number, number]> = {
  // Ready Player Me
  Spine: [0.05, 0, 0],
  Spine1: [0.04, 0, 0],
  Neck: [0.04, 0, 0],
  Head: [0.04, 0, 0],
  LeftArm: [-0.2, 0, 0.55],
  RightArm: [-0.2, 0, -0.55],
  LeftForeArm: [-0.1, -0.5, 0],
  RightForeArm: [-0.1, 0.5, 0],
  LeftUpLeg: [-1.5, 0, 0.06],
  RightUpLeg: [-1.5, 0, -0.06],
  LeftLeg: [1.5, 0, 0],
  RightLeg: [1.5, 0, 0],
  // Mixamo / three.js Xbot
  mixamorigSpine: [0.05, 0, 0],
  mixamorigSpine1: [0.04, 0, 0],
  mixamorigNeck: [0.04, 0, 0],
  mixamorigHead: [0.04, 0, 0],
  mixamorigLeftArm: [0.35, 0, 0.7],
  mixamorigRightArm: [0.35, 0, -0.7],
  mixamorigLeftForeArm: [0, 0, 0.55],
  mixamorigRightForeArm: [0, 0, -0.55],
  mixamorigLeftUpLeg: [-1.5, 0, 0.05],
  mixamorigRightUpLeg: [-1.5, 0, -0.05],
  mixamorigLeftLeg: [1.5, 0, 0],
  mixamorigRightLeg: [1.5, 0, 0],
};

/** Spine / Head bone names to drive the procedural idle (first match wins). */
export const IDLE_BONES = {
  spine: ["Spine1", "Spine", "mixamorigSpine1", "mixamorigSpine"],
  head: ["Head", "mixamorigHead"],
};

/** Constant morph-target influences (RPM ARKit blendshapes) — a friendly rest smile.
 *  Ignored by GLBs without these blendshapes (e.g. the placeholder). */
export const RPM_REST_MORPHS: Record<string, number> = {
  mouthSmileLeft: 0.32,
  mouthSmileRight: 0.32,
  cheekSquintLeft: 0.14,
  cheekSquintRight: 0.14,
};

/** Camera for the bust / desk framing (avatar origin at feet, +Y up). */
export const RPM_CAMERA = {
  position: (RPM_ENABLED ? [0.22, 1.5, 1.15] : [0.34, 1.5, 1.8]) as [number, number, number],
  fov: RPM_ENABLED ? 30 : 24,
  targetY: RPM_ENABLED ? 1.46 : 1.42,
};

/** Avatar world transform in the scene. */
export const RPM_TRANSFORM = { positionY: 0, rotationY: RPM_ENABLED ? 0.18 : 0.14, scale: 1 };
