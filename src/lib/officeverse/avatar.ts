/**
 * Officeverse character — option catalogue, colour ramps, curated presets, helpers.
 * Pure data + pure functions. No React, no storage, no business logic.
 */
import type {
  Accessory,
  AvatarConfig,
  CharacterPose,
  Expression,
  FacialHair,
  Glasses,
  HairColor,
  HairStyle,
  Headwear,
  Outfit,
  OutfitColor,
  Presentation,
  SkinTone,
} from "./types";

export type ColorRamp = { base: string; shadow: string; light: string };

/** Ink line shared by every character — a warm near-black for a friendly outline. */
export const INK = "#2B2333";

export const SKIN: Record<SkinTone, ColorRamp> = {
  porcelain: { base: "#FBDDC6", shadow: "#EFBE9F", light: "#FFEEDF" },
  light: { base: "#F2C6A0", shadow: "#DFA377", light: "#FEDCC0" },
  tan: { base: "#DB9F70", shadow: "#C07C4C", light: "#EDC09A" },
  brown: { base: "#B87A4E", shadow: "#985A32", light: "#D19A73" },
  deep: { base: "#8B5233", shadow: "#6A3B22", light: "#A56E4C" },
  ebony: { base: "#5E3826", shadow: "#452718", light: "#7C4E38" },
};

export const HAIR: Record<HairColor, ColorRamp> = {
  black: { base: "#2A2732", shadow: "#191721", light: "#443F52" },
  darkBrown: { base: "#402A1F", shadow: "#2A1B13", light: "#5C3E2D" },
  brown: { base: "#6B452E", shadow: "#4C301F", light: "#8A5E42" },
  chestnut: { base: "#90583A", shadow: "#6C3F27", light: "#B0764E" },
  blonde: { base: "#D2A159", shadow: "#B07F3D", light: "#EAC488" },
  platinum: { base: "#DCCDB4", shadow: "#B9A98C", light: "#F0E5D2" },
  auburn: { base: "#8A3B27", shadow: "#63281A", light: "#AC5238" },
  blueBlack: { base: "#232C39", shadow: "#161C25", light: "#384756" },
};

export const OUTFIT_COLOR: Record<OutfitColor, ColorRamp> = {
  indigo: { base: "#5A5CF0", shadow: "#4143C0", light: "#8688F6" },
  teal: { base: "#17ABA0", shadow: "#0F8178", light: "#48C8BE" },
  charcoal: { base: "#3E3E4A", shadow: "#2B2B34", light: "#5A5A69" },
  plum: { base: "#8654CE", shadow: "#653DA0", light: "#A47FE0" },
  sand: { base: "#E0BC88", shadow: "#C09C68", light: "#EFD5AC" },
  forest: { base: "#2F8757", shadow: "#20643F", light: "#49A574" },
  rose: { base: "#E27191", shadow: "#BC5875", light: "#F096AD" },
  slate: { base: "#5E7088", shadow: "#465468", light: "#7F92A9" },
};

export const DEFAULT_AVATAR: AvatarConfig = {
  presentation: "masculine",
  skin: "tan",
  hair: "messy",
  hairColor: "black",
  facialHair: "none",
  glasses: "none",
  outfit: "shirt",
  outfitColor: "sand",
  headwear: "none",
  accessory: "lanyard",
  expression: "happy",
};

export const OPTIONS = {
  presentation: ["feminine", "masculine", "neutral"] as Presentation[],
  skin: ["porcelain", "light", "tan", "brown", "deep", "ebony"] as SkinTone[],
  hair: [
    "short",
    "buzz",
    "fade",
    "sidePart",
    "spiky",
    "messy",
    "wavy",
    "curly",
    "coily",
    "undercut",
    "bun",
    "ponytail",
    "long",
  ] as HairStyle[],
  hairColor: [
    "black",
    "darkBrown",
    "brown",
    "chestnut",
    "blonde",
    "platinum",
    "auburn",
    "blueBlack",
  ] as HairColor[],
  facialHair: ["none", "stubble", "moustache", "goatee", "shortBeard", "fullBeard"] as FacialHair[],
  glasses: ["none", "round", "rectangle", "thin", "browline"] as Glasses[],
  outfit: [
    "hoodie",
    "tee",
    "polo",
    "shirt",
    "blazer",
    "turtleneck",
    "bomber",
    "varsity",
    "overshirt",
    "puffer",
    "denim",
  ] as Outfit[],
  outfitColor: [
    "indigo",
    "teal",
    "charcoal",
    "plum",
    "sand",
    "forest",
    "rose",
    "slate",
  ] as OutfitColor[],
  headwear: ["none", "cap", "capBack", "beanie", "headphones", "headset", "turban"] as Headwear[],
  accessory: [
    "none",
    "lanyard",
    "earbuds",
    "chain",
    "scarf",
    "coffee",
    "smartwatch",
    "backpack",
  ] as Accessory[],
  expression: ["neutral", "focused", "happy", "excited", "thinking", "concerned"] as Expression[],
} as const;

export type AvatarCategory = keyof typeof OPTIONS;

export const CATEGORY_LABELS: Record<AvatarCategory, string> = {
  presentation: "Character build",
  skin: "Skin",
  hair: "Hair",
  hairColor: "Hair colour",
  facialHair: "Facial hair",
  glasses: "Glasses",
  outfit: "Outfit",
  outfitColor: "Outfit colour",
  headwear: "Headwear",
  accessory: "Accessory",
  expression: "Expression",
};

export const OPTION_LABELS: Record<string, string> = {
  none: "None",
  // character build
  feminine: "Feminine",
  masculine: "Masculine",
  // hair styles
  short: "Short",
  buzz: "Buzz",
  fade: "Fade",
  sidePart: "Side part",
  spiky: "Spiky",
  messy: "Messy",
  wavy: "Wavy",
  waves: "Wavy",
  curly: "Curly",
  coily: "Coils",
  undercut: "Undercut",
  bun: "Top knot",
  ponytail: "Ponytail",
  long: "Long",
  // colours
  black: "Black",
  darkBrown: "Dark brown",
  brown: "Brown",
  chestnut: "Chestnut",
  blonde: "Blonde",
  platinum: "Platinum",
  auburn: "Auburn",
  blueBlack: "Blue black",
  // facial hair
  stubble: "Stubble",
  moustache: "Moustache",
  goatee: "Goatee",
  shortBeard: "Short beard",
  fullBeard: "Full beard",
  // glasses
  round: "Round",
  rectangle: "Rectangle",
  thin: "Thin metal",
  browline: "Browline",
  // outfit
  hoodie: "Hoodie",
  tee: "Tee",
  polo: "Polo",
  shirt: "Shirt",
  blazer: "Blazer",
  turtleneck: "Turtleneck",
  bomber: "Bomber",
  varsity: "Varsity",
  overshirt: "Overshirt",
  puffer: "Puffer",
  denim: "Denim jacket",
  // outfit colour
  indigo: "Indigo",
  teal: "Teal",
  charcoal: "Charcoal",
  plum: "Plum",
  sand: "Sand",
  forest: "Forest",
  rose: "Rose",
  slate: "Slate",
  // headwear
  cap: "Cap",
  capBack: "Cap (back)",
  beanie: "Beanie",
  headphones: "Headphones",
  headset: "Headset",
  turban: "Turban",
  // accessory
  lanyard: "Lanyard",
  earbuds: "Earbuds",
  chain: "Chain",
  scarf: "Scarf",
  coffee: "Coffee cup",
  smartwatch: "Smartwatch",
  backpack: "Backpack",
  // expression
  neutral: "Neutral",
  focused: "Focused",
  happy: "Happy",
  excited: "Excited",
  thinking: "Thinking",
  concerned: "Concerned",
};

/* -------------------------- curated personas -------------------------- */

export interface Persona {
  id: string;
  label: string;
  blurb: string;
  base: Omit<AvatarConfig, "skin" | "hairColor" | "presentation">;
}

/** Coherent combinations — the building blocks for Surprise Me + seeded defaults. */
export const PERSONAS: Persona[] = [
  {
    id: "hustler",
    label: "The Hustler",
    blurb: "Energetic, confident, always closing.",
    base: {
      hair: "fade",
      facialHair: "stubble",
      glasses: "none",
      outfit: "varsity",
      outfitColor: "indigo",
      headwear: "capBack",
      accessory: "smartwatch",
      expression: "excited",
    },
  },
  {
    id: "focused",
    label: "The Focused One",
    blurb: "Heads-down, glasses on, in the zone.",
    base: {
      hair: "short",
      facialHair: "none",
      glasses: "rectangle",
      outfit: "shirt",
      outfitColor: "slate",
      headwear: "none",
      accessory: "lanyard",
      expression: "focused",
    },
  },
  {
    id: "chill",
    label: "The Chill One",
    blurb: "Hoodie, headphones, unbothered.",
    base: {
      hair: "messy",
      facialHair: "none",
      glasses: "none",
      outfit: "hoodie",
      outfitColor: "forest",
      headwear: "headphones",
      accessory: "coffee",
      expression: "neutral",
    },
  },
  {
    id: "style",
    label: "The Style Icon",
    blurb: "Statement hair, statement fit.",
    base: {
      hair: "wavy",
      facialHair: "none",
      glasses: "round",
      outfit: "bomber",
      outfitColor: "rose",
      headwear: "none",
      accessory: "chain",
      expression: "happy",
    },
  },
  {
    id: "senior",
    label: "The Senior",
    blurb: "Calm, measured, seen it all.",
    base: {
      hair: "sidePart",
      facialHair: "shortBeard",
      glasses: "thin",
      outfit: "blazer",
      outfitColor: "charcoal",
      headwear: "none",
      accessory: "smartwatch",
      expression: "neutral",
    },
  },
  {
    id: "spark",
    label: "The Energetic One",
    blurb: "Big smile, big energy.",
    base: {
      hair: "spiky",
      facialHair: "none",
      glasses: "none",
      outfit: "tee",
      outfitColor: "teal",
      headwear: "none",
      accessory: "backpack",
      expression: "excited",
    },
  },
  {
    id: "genius",
    label: "The Quiet Genius",
    blurb: "Thoughtful, understated, sharp.",
    base: {
      hair: "curly",
      facialHair: "goatee",
      glasses: "browline",
      outfit: "turtleneck",
      outfitColor: "plum",
      headwear: "none",
      accessory: "lanyard",
      expression: "thinking",
    },
  },
  {
    id: "creator",
    label: "The Creator",
    blurb: "Beanie, denim, ideas everywhere.",
    base: {
      hair: "long",
      facialHair: "none",
      glasses: "none",
      outfit: "denim",
      outfitColor: "sand",
      headwear: "beanie",
      accessory: "coffee",
      expression: "happy",
    },
  },
];

function hashSeed(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100003) / 100003;
  };
}

function pick<T>(arr: readonly T[], r: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]!;
}

function fromPersona(
  p: Persona,
  r: () => number,
  presentation: Presentation = r() < 0.5 ? "feminine" : "masculine",
): AvatarConfig {
  return {
    ...p.base,
    presentation,
    skin: pick(OPTIONS.skin, r()),
    hairColor: pick(OPTIONS.hairColor, r()),
  };
}

/* --------------------------------------------------------------------------
 * Naturalistic identity hints derived from a name/seed string. Visual only —
 * no employee is hard-coded; these are broad first-name and Punjabi surname
 * conventions used to give a coherent, recognisable character. A saved Avatar
 * Studio config always overrides all of this.
 * ------------------------------------------------------------------------ */
const FEMININE_NAMES = new Set([
  "maria",
  "angela",
  "linda",
  "sandra",
  "priya",
  "neha",
  "simran",
  "lakshita",
  "gregoria",
  "sofia",
  "aisha",
  "anita",
  "pooja",
  "isabella",
  "emma",
  "olivia",
  "sara",
  "sarah",
  "riya",
  "meera",
  "kavya",
  "divya",
  "nisha",
]);
const MASCULINE_NAMES = new Set([
  "john",
  "david",
  "robert",
  "michael",
  "ayush",
  "rahul",
  "karan",
  "rohit",
  "amit",
  "gurpreet",
  "arjun",
  "vikram",
  "sameer",
  "james",
  "daniel",
  "aditya",
  "manish",
  "sunil",
  "deepak",
  "harish",
]);

function tokensOf(seed: string): string[] {
  return seed
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function presentationFromTokens(tk: string[], r: () => number): Presentation {
  if (tk.some((t) => FEMININE_NAMES.has(t)) || tk.includes("kaur")) return "feminine";
  if (tk.some((t) => MASCULINE_NAMES.has(t)) || tk.includes("singh")) return "masculine";
  return r() < 0.5 ? "feminine" : "masculine";
}

/** A visually coherent random character (persona + skin/hair jitter). */
export function randomAvatar(): AvatarConfig {
  const r = Math.random;
  const persona = PERSONAS[Math.floor(r() * PERSONAS.length)]!;
  const cfg = fromPersona(persona, r);
  // occasional tasteful expression swap
  if (r() < 0.3) cfg.expression = pick(["neutral", "happy", "focused"] as Expression[], r());
  return cfg;
}

/** Deterministic, SSR-safe character from a stable seed (persona-based, so it's coherent). */
export function avatarFromSeed(seed: string): AvatarConfig {
  const r = hashSeed(seed);
  const persona = PERSONAS[Math.floor(r() * PERSONAS.length)]!;
  const tk = tokensOf(seed);
  const cfg = fromPersona(persona, r, presentationFromTokens(tk, r));

  // A Sikh employee reads clearly through the character — turban + full beard —
  // without exaggeration, and only on the generated default.
  if (tk.includes("singh")) {
    cfg.presentation = "masculine";
    cfg.headwear = "turban";
    cfg.facialHair = "fullBeard";
  }
  // Keep feminine builds from landing on a shaved cut by chance.
  if (cfg.presentation === "feminine" && (cfg.hair === "buzz" || cfg.hair === "fade")) {
    cfg.hair = r() < 0.5 ? "wavy" : "bun";
  }
  return cfg;
}

/** Coerce anything read from storage into a valid config; migrate the "waves" alias. */
export function normalizeAvatar(
  input: unknown,
  fallback: AvatarConfig = DEFAULT_AVATAR,
): AvatarConfig {
  const v = (input && typeof input === "object" ? input : {}) as Partial<AvatarConfig>;
  const out = { ...fallback };
  const keys = Object.keys(OPTIONS) as AvatarCategory[];
  for (const k of keys) {
    const allowed = OPTIONS[k] as readonly string[];
    const raw = v[k];
    const val = raw === "waves" ? "wavy" : raw;
    if (typeof val === "string" && allowed.includes(val)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[k] = val;
    }
  }
  return out;
}

/* -------- visual reaction infrastructure (no business wiring here) -------- */

export type CharacterEvent =
  | "LOGIN"
  | "SHIFT_START"
  | "LEAD_SUBMITTED"
  | "FOLLOWUP_DUE"
  | "FOLLOWUP_OVERDUE"
  | "LEAD_ACCEPTED"
  | "LEAD_REJECTED"
  | "TASK_COMPLETED"
  | "ACHIEVEMENT"
  | "IDLE";

export const EVENT_REACTION: Record<
  CharacterEvent,
  { pose: CharacterPose; expression: Expression }
> = {
  LOGIN: { pose: "wave", expression: "happy" },
  SHIFT_START: { pose: "attention", expression: "excited" },
  LEAD_SUBMITTED: { pose: "celebrating", expression: "excited" },
  FOLLOWUP_DUE: { pose: "attention", expression: "focused" },
  FOLLOWUP_OVERDUE: { pose: "concerned", expression: "concerned" },
  LEAD_ACCEPTED: { pose: "celebrating", expression: "happy" },
  LEAD_REJECTED: { pose: "tired", expression: "concerned" },
  TASK_COMPLETED: { pose: "celebrating", expression: "happy" },
  ACHIEVEMENT: { pose: "celebrating", expression: "excited" },
  IDLE: { pose: "idle", expression: "neutral" },
};
