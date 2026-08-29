import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { HAIR, OUTFIT_COLOR, SKIN } from "@/lib/officeverse/avatar";
import type { AvatarConfig, CharacterPose } from "@/lib/officeverse/types";
import { PARALLAX } from "./avatar-3d-config";

/**
 * Procedural stylised 3D figure — the default hero avatar when no custom .glb is
 * supplied. Jointed rounded-primitive body with adult proportions (~7 heads),
 * PBR materials tinted from the deterministic palette, a seated working posture,
 * pose targets wired to the existing CharacterPose system, and a continuous idle
 * (breathing, head/eye drift, blink, weight shift). No skinning, no external
 * asset. Not sculpted-cinematic — that still needs a real model — but genuinely
 * dimensional, lit and alive.
 */

type Pres = "feminine" | "masculine" | "neutral";
const REDUCED =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const UPPER_ARM = 0.31;
const FOREARM = 0.29;
const THIGH = 0.44;
const SHIN = 0.44;
const PELVIS_Y = 0.5;
const HEAD_R = 0.088;

function dims(pres: Pres) {
  const f = pres === "feminine";
  const m = pres === "masculine";
  return {
    shoulder: f ? 0.19 : m ? 0.24 : 0.215,
    hip: f ? 0.13 : m ? 0.115 : 0.122,
    chestR: f ? 0.105 : m ? 0.128 : 0.116,
    waistR: f ? 0.086 : m ? 0.108 : 0.096,
    handR: f ? 0.036 : m ? 0.044 : 0.04,
    footL: f ? 0.15 : m ? 0.18 : 0.165,
    jawX: f ? 0.88 : m ? 1.0 : 0.93,
    neckR: f ? 0.036 : m ? 0.045 : 0.04,
  };
}

type Rot = [number, number, number];
type PoseMap = Record<string, Rot>;

const SEATED: PoseMap = {
  pelvis: [-0.04, 0, 0],
  spine: [0.06, 0, 0],
  chest: [0.04, 0, 0],
  neck: [0.02, 0, 0],
  head: [0.05, 0, 0],
  armLU: [-0.5, 0.06, 0.14],
  armLF: [-0.95, 0, 0],
  armRU: [-0.5, -0.06, -0.14],
  armRF: [-0.95, 0, 0],
  legLU: [-1.46, 0, 0.07],
  legLF: [1.36, 0, 0],
  legRU: [-1.46, 0, -0.07],
  legRF: [1.36, 0, 0],
};

const POSE_DELTA: Partial<Record<CharacterPose, PoseMap>> = {
  idle: {},
  working: {
    spine: [0.15, 0, 0],
    chest: [0.08, 0, 0],
    head: [0.24, 0, 0],
    armLU: [-0.78, 0.1, 0.16],
    armLF: [-1.4, 0, 0],
    armRU: [-0.78, -0.1, -0.16],
    armRF: [-1.4, 0, 0],
  },
  focused: {
    spine: [0.1, 0, 0],
    head: [0.16, 0, 0],
    armLF: [-1.2, 0, 0],
    armRF: [-1.2, 0, 0],
  },
  wave: {
    head: [-0.02, 0.12, 0.06],
    armRU: [-2.5, -0.25, -0.55],
    armRF: [-0.7, 0, 0],
    armLF: [-0.9, 0, 0],
  },
  thinking: {
    head: [-0.16, 0.16, 0.1],
    spine: [0.06, 0.05, 0.03],
    armRU: [-1.15, -0.35, -0.22],
    armRF: [-2.35, 0, 0],
  },
  happy: {
    head: [-0.12, 0, 0],
    armLU: [-1.45, 0.1, 0.34],
    armLF: [-0.5, 0, 0],
    armRU: [-1.45, -0.1, -0.34],
    armRF: [-0.5, 0, 0],
  },
  celebrating: {
    head: [-0.16, 0, 0],
    armLU: [-2.65, 0.1, 0.42],
    armLF: [-0.35, 0, 0],
    armRU: [-2.65, -0.1, -0.42],
    armRF: [-0.35, 0, 0],
  },
  concerned: {
    spine: [0.16, 0, 0],
    chest: [0.12, 0, 0],
    head: [0.3, 0, 0.04],
    armLU: [-0.4, 0, 0.1],
    armRU: [-0.4, 0, -0.1],
  },
  tired: {
    pelvis: [0.02, 0, 0.03],
    spine: [0.2, 0, 0],
    head: [0.38, 0.12, 0.08],
    armLU: [-0.35, 0, 0.08],
    armRU: [-0.35, 0, -0.08],
  },
  attention: {
    spine: [0.02, 0, 0],
    chest: [0.01, 0, 0],
    head: [0.03, 0, 0],
    armLU: [-0.42, 0.04, 0.12],
    armRU: [-0.42, -0.04, -0.12],
    armLF: [-0.7, 0, 0],
    armRF: [-0.7, 0, 0],
  },
};

function targetFor(pose: CharacterPose): PoseMap {
  return { ...SEATED, ...(POSE_DELTA[pose] ?? {}) };
}

function useMats(config: AvatarConfig) {
  return useMemo(() => {
    const skin = SKIN[config.skin].base;
    const hair = HAIR[config.hairColor].base;
    const outfit = OUTFIT_COLOR[config.outfitColor].base;
    const std = (color: string, roughness = 0.62, metalness = 0.02) =>
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness });
    return {
      skin: std(skin, 0.58),
      hair: std(hair, 0.72),
      outfit: std(outfit, 0.66),
      pants: std("#37384a", 0.7),
      shoe: std("#26232e", 0.55),
      dark: std("#1c1a24", 0.4, 0.1),
      turban: std(outfit, 0.6),
      wood: std("#b98a53", 0.6),
      chair: std("#33313c", 0.5, 0.05),
    };
  }, [config.skin, config.hairColor, config.outfitColor]);
}

/* --------------------------------- figure -------------------------------- */

export function ProceduralFigure({
  config,
  pose = "idle",
}: {
  config: AvatarConfig;
  pose?: CharacterPose;
  expression?: string | undefined;
}) {
  const pres = (
    config.presentation === "feminine" || config.presentation === "masculine"
      ? config.presentation
      : "neutral"
  ) as Pres;
  const d = dims(pres);
  const mats = useMats(config);
  const isSikh = config.headwear === "turban";
  const hairLong = config.hair === "long" || config.hair === "ponytail" || config.hair === "bun";

  const rig = useRef<THREE.Group>(null);
  const g = {
    pelvis: useRef<THREE.Group>(null),
    spine: useRef<THREE.Group>(null),
    chest: useRef<THREE.Group>(null),
    neck: useRef<THREE.Group>(null),
    head: useRef<THREE.Group>(null),
    armLU: useRef<THREE.Group>(null),
    armLF: useRef<THREE.Group>(null),
    armRU: useRef<THREE.Group>(null),
    armRF: useRef<THREE.Group>(null),
    legLU: useRef<THREE.Group>(null),
    legLF: useRef<THREE.Group>(null),
    legRU: useRef<THREE.Group>(null),
    legRF: useRef<THREE.Group>(null),
  };
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);
  const blink = useRef({ next: 2, closing: 0 });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const target = targetFor(pose);
    const L = 8;
    const idle = REDUCED ? 0 : 1;

    const apply = (key: keyof typeof g, extra: Rot = [0, 0, 0]) => {
      const node = g[key].current;
      if (!node) return;
      const tr = target[key] ?? [0, 0, 0];
      node.rotation.x = THREE.MathUtils.damp(node.rotation.x, tr[0] + extra[0], L, delta);
      node.rotation.y = THREE.MathUtils.damp(node.rotation.y, tr[1] + extra[1], L, delta);
      node.rotation.z = THREE.MathUtils.damp(node.rotation.z, tr[2] + extra[2], L, delta);
    };

    const breathe = Math.sin(t * 1.7) * 0.012 * idle;
    const sway = Math.sin(t * 0.7) * 0.06 * idle;
    const sway2 = Math.sin(t * 0.9 + 1) * 0.03 * idle;
    const typing = pose === "working" ? Math.sin(t * 9) * 0.05 * idle : 0;
    const bounce = (pose === "celebrating" ? 0.02 : pose === "happy" ? 0.008 : 0) * idle;

    apply("pelvis", [0, 0, Math.sin(t * 0.5) * 0.012 * idle]);
    apply("spine", [breathe, 0, 0]);
    apply("chest", [breathe * 1.4, 0, 0]);
    apply("neck", [sway2 * 0.5, sway * 0.4, 0]);
    apply("head", [sway2, sway, 0]);
    apply("armLU");
    apply("armLF", [typing, 0, 0]);
    apply("armRU", pose === "wave" ? [0, 0, Math.sin(t * 6) * 0.18] : [0, 0, 0]);
    apply("armRF", [typing, 0, 0]);
    apply("legLU");
    apply("legLF");
    apply("legRU");
    apply("legRF");

    if (rig.current) {
      rig.current.position.y = THREE.MathUtils.damp(
        rig.current.position.y,
        Math.abs(Math.sin(t * 6)) * bounce,
        6,
        delta,
      );
      if (!REDUCED) {
        rig.current.rotation.y = THREE.MathUtils.damp(
          rig.current.rotation.y,
          state.pointer.x * PARALLAX.yaw * 0.7,
          3,
          delta,
        );
        rig.current.rotation.x = THREE.MathUtils.damp(
          rig.current.rotation.x,
          -state.pointer.y * PARALLAX.pitch * 0.7,
          3,
          delta,
        );
      }
    }

    // blink
    const b = blink.current;
    b.next -= delta;
    if (b.next <= 0 && b.closing <= 0) b.closing = 0.14;
    let open = 1;
    if (b.closing > 0) {
      b.closing -= delta;
      open = b.closing > 0.07 ? THREE.MathUtils.lerp(1, 0.08, (0.14 - b.closing) / 0.07) : 0.08;
      if (b.closing <= 0) {
        open = 1;
        b.next = 2.4 + Math.random() * 3;
      }
    }
    if (eyeL.current) eyeL.current.scale.y = open;
    if (eyeR.current) eyeR.current.scale.y = open;
  });

  const headR = HEAD_R;
  const eyeY = -0.004;
  const eyeZ = headR * 0.9;

  return (
    <group ref={rig}>
      <group ref={g.pelvis} position={[0, PELVIS_Y, 0]}>
        <mesh castShadow position={[0, 0, 0.01]}>
          <capsuleGeometry args={[d.hip, 0.1, 6, 20]} />
          <primitive object={mats.pants} attach="material" />
        </mesh>

        <group ref={g.spine} position={[0, 0.12, 0]}>
          <mesh castShadow position={[0, 0.12, 0]}>
            <capsuleGeometry args={[d.waistR, 0.2, 6, 20]} />
            <primitive object={mats.outfit} attach="material" />
          </mesh>

          <group ref={g.chest} position={[0, 0.26, 0]}>
            <mesh castShadow position={[0, 0.05, 0]} scale={[1.16, 1, 0.82]}>
              <capsuleGeometry args={[d.chestR, 0.24, 6, 22]} />
              <primitive object={mats.outfit} attach="material" />
            </mesh>
            {config.accessory === "lanyard" ? (
              <group>
                <mesh position={[0.05, 0.02, d.chestR * 0.86]}>
                  <boxGeometry args={[0.012, 0.24, 0.006]} />
                  <primitive object={mats.dark} attach="material" />
                </mesh>
                <mesh position={[-0.05, 0.02, d.chestR * 0.86]}>
                  <boxGeometry args={[0.012, 0.24, 0.006]} />
                  <primitive object={mats.dark} attach="material" />
                </mesh>
                <mesh position={[0, -0.1, d.chestR * 0.9]}>
                  <boxGeometry args={[0.06, 0.09, 0.008]} />
                  <meshStandardMaterial color="#f2f0f6" roughness={0.5} />
                </mesh>
              </group>
            ) : null}

            {/* shoulder yoke */}
            <mesh castShadow position={[0, 0.19, 0]} scale={[1, 0.36, 0.78]}>
              <capsuleGeometry args={[d.shoulder, 0.05, 6, 22]} />
              <primitive object={mats.outfit} attach="material" />
            </mesh>

            <group ref={g.neck} position={[0, 0.24, 0]}>
              <mesh castShadow position={[0, 0.055, 0]}>
                <capsuleGeometry args={[d.neckR, 0.1, 6, 16]} />
                <primitive object={mats.skin} attach="material" />
              </mesh>

              <group ref={g.head} position={[0, 0.15, 0]}>
                {/* cranium + jaw */}
                <mesh castShadow scale={[d.jawX * 0.98, 1.08, 0.98]}>
                  <sphereGeometry args={[headR, 28, 24]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                <mesh
                  castShadow
                  position={[0, -headR * 0.48, headR * 0.14]}
                  scale={[d.jawX * 0.8, 0.66, 0.84]}
                >
                  <sphereGeometry args={[headR, 20, 16]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                {/* ears */}
                <mesh position={[headR * 0.92, -0.005, 0]} scale={[0.5, 0.9, 0.6]}>
                  <sphereGeometry args={[0.024, 12, 10]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                <mesh position={[-headR * 0.92, -0.005, 0]} scale={[0.5, 0.9, 0.6]}>
                  <sphereGeometry args={[0.024, 12, 10]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                {/* nose */}
                <mesh position={[0, -0.012, eyeZ + 0.006]} rotation={[Math.PI / 2, 0, 0]}>
                  <coneGeometry args={[0.016, 0.04, 12]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                {/* brows */}
                <mesh position={[0.045, eyeY + 0.03, eyeZ]} rotation={[0, 0, -0.12]}>
                  <boxGeometry args={[0.045, 0.008, 0.01]} />
                  <primitive object={mats.hair} attach="material" />
                </mesh>
                <mesh position={[-0.045, eyeY + 0.03, eyeZ]} rotation={[0, 0, 0.12]}>
                  <boxGeometry args={[0.045, 0.008, 0.01]} />
                  <primitive object={mats.hair} attach="material" />
                </mesh>
                {/* eyes (modest) */}
                <mesh ref={eyeL} position={[0.045, eyeY, eyeZ]}>
                  <sphereGeometry args={[0.019, 16, 14]} />
                  <meshStandardMaterial color="#241d2e" roughness={0.25} />
                </mesh>
                <mesh ref={eyeR} position={[-0.045, eyeY, eyeZ]}>
                  <sphereGeometry args={[0.019, 16, 14]} />
                  <meshStandardMaterial color="#241d2e" roughness={0.25} />
                </mesh>
                {/* mouth */}
                <mesh
                  position={[0, -0.052, eyeZ - 0.004]}
                  rotation={[
                    0,
                    0,
                    config.expression === "happy" || config.expression === "excited"
                      ? Math.PI
                      : config.expression === "concerned"
                        ? 0
                        : Math.PI,
                  ]}
                  scale={[
                    1,
                    config.expression === "happy" || config.expression === "excited"
                      ? 1
                      : config.expression === "concerned"
                        ? 0.9
                        : 0.35,
                    1,
                  ]}
                >
                  <torusGeometry args={[0.022, 0.005, 8, 16, Math.PI]} />
                  <meshStandardMaterial color="#7a3b46" roughness={0.5} />
                </mesh>

                {/* hair / turban */}
                {isSikh ? (
                  <group>
                    <mesh castShadow position={[0, headR * 0.34, -0.002]} scale={[1.22, 1.14, 1.2]}>
                      <sphereGeometry args={[headR, 30, 24, 0, Math.PI * 2, 0, Math.PI * 0.78]} />
                      <primitive object={mats.turban} attach="material" />
                    </mesh>
                    <mesh
                      position={[0, headR * 0.5, headR * 1.02]}
                      rotation={[0.4, 0, 0]}
                      scale={[0.8, 1, 0.8]}
                    >
                      <coneGeometry args={[0.018, 0.04, 12]} />
                      <primitive object={mats.turban} attach="material" />
                    </mesh>
                    <mesh
                      position={[0, headR * 0.18, 0]}
                      rotation={[Math.PI / 2, 0, 0]}
                      scale={[1.24, 1.22, 1]}
                    >
                      <torusGeometry args={[headR, 0.005, 6, 30]} />
                      <meshStandardMaterial
                        color={new THREE.Color(OUTFIT_COLOR[config.outfitColor].shadow)}
                        roughness={0.6}
                      />
                    </mesh>
                  </group>
                ) : (
                  <group>
                    <mesh
                      castShadow
                      position={[0, headR * 0.26, -0.004]}
                      scale={[1.04, hairLong ? 0.98 : 0.76, 1.03]}
                    >
                      <sphereGeometry args={[headR, 26, 20, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
                      <primitive object={mats.hair} attach="material" />
                    </mesh>
                    {hairLong ? (
                      <mesh
                        castShadow
                        position={[0, -0.03, -headR * 0.68]}
                        scale={[0.86, 1.6, 0.55]}
                      >
                        <capsuleGeometry args={[headR * 0.66, 0.14, 5, 14]} />
                        <primitive object={mats.hair} attach="material" />
                      </mesh>
                    ) : null}
                    {config.hair === "bun" ? (
                      <mesh castShadow position={[0, headR * 0.62, -headR * 0.5]}>
                        <sphereGeometry args={[0.042, 16, 14]} />
                        <primitive object={mats.hair} attach="material" />
                      </mesh>
                    ) : null}
                  </group>
                )}

                {/* beard */}
                {isSikh ||
                config.facialHair === "fullBeard" ||
                config.facialHair === "shortBeard" ||
                config.facialHair === "goatee" ? (
                  <mesh
                    castShadow
                    position={[0, -headR * 0.55, headR * 0.1]}
                    scale={[
                      d.jawX * (config.facialHair === "goatee" ? 0.5 : 0.92),
                      isSikh || config.facialHair === "fullBeard" ? 0.9 : 0.66,
                      0.92,
                    ]}
                  >
                    <sphereGeometry
                      args={[headR, 22, 18, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55]}
                    />
                    <primitive object={mats.hair} attach="material" />
                  </mesh>
                ) : null}
                {(isSikh ||
                  config.facialHair === "moustache" ||
                  config.facialHair === "fullBeard") && (
                  <mesh position={[0, -0.038, eyeZ - 0.002]}>
                    <boxGeometry args={[0.05, 0.012, 0.014]} />
                    <primitive object={mats.hair} attach="material" />
                  </mesh>
                )}

                {/* glasses */}
                {config.glasses !== "none" ? (
                  <group position={[0, eyeY, eyeZ + 0.002]}>
                    <mesh position={[0.045, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[0.026, 0.004, 8, 20]} />
                      <primitive object={mats.dark} attach="material" />
                    </mesh>
                    <mesh position={[-0.045, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[0.026, 0.004, 8, 20]} />
                      <primitive object={mats.dark} attach="material" />
                    </mesh>
                    <mesh position={[0, 0, 0]}>
                      <boxGeometry args={[0.03, 0.004, 0.004]} />
                      <primitive object={mats.dark} attach="material" />
                    </mesh>
                  </group>
                ) : null}
              </group>
            </group>

            {/* arms */}
            <group ref={g.armLU} position={[d.shoulder, 0.17, 0]}>
              <mesh castShadow position={[0, -UPPER_ARM / 2, 0]}>
                <capsuleGeometry args={[0.05, UPPER_ARM, 5, 14]} />
                <primitive object={mats.outfit} attach="material" />
              </mesh>
              <group ref={g.armLF} position={[0, -UPPER_ARM, 0]}>
                <mesh castShadow position={[0, -FOREARM / 2, 0]}>
                  <capsuleGeometry args={[0.042, FOREARM, 5, 14]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                <mesh castShadow position={[0, -FOREARM - 0.01, 0]} scale={[1, 0.8, 0.7]}>
                  <sphereGeometry args={[d.handR, 14, 12]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
              </group>
            </group>
            <group ref={g.armRU} position={[-d.shoulder, 0.17, 0]}>
              <mesh castShadow position={[0, -UPPER_ARM / 2, 0]}>
                <capsuleGeometry args={[0.05, UPPER_ARM, 5, 14]} />
                <primitive object={mats.outfit} attach="material" />
              </mesh>
              <group ref={g.armRF} position={[0, -UPPER_ARM, 0]}>
                <mesh castShadow position={[0, -FOREARM / 2, 0]}>
                  <capsuleGeometry args={[0.042, FOREARM, 5, 14]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
                <mesh castShadow position={[0, -FOREARM - 0.01, 0]} scale={[1, 0.8, 0.7]}>
                  <sphereGeometry args={[d.handR, 14, 12]} />
                  <primitive object={mats.skin} attach="material" />
                </mesh>
              </group>
            </group>
          </group>
        </group>

        {/* legs */}
        <group ref={g.legLU} position={[d.hip * 0.9, -0.02, 0]}>
          <mesh castShadow position={[0, -THIGH / 2, 0]}>
            <capsuleGeometry args={[0.062, THIGH, 5, 16]} />
            <primitive object={mats.pants} attach="material" />
          </mesh>
          <group ref={g.legLF} position={[0, -THIGH, 0]}>
            <mesh castShadow position={[0, -SHIN / 2, 0]}>
              <capsuleGeometry args={[0.052, SHIN, 5, 16]} />
              <primitive object={mats.pants} attach="material" />
            </mesh>
            <mesh castShadow position={[0, -SHIN, d.footL * 0.35]} scale={[0.8, 0.5, 1]}>
              <capsuleGeometry args={[0.05, d.footL, 4, 12]} />
              <primitive object={mats.shoe} attach="material" />
            </mesh>
          </group>
        </group>
        <group ref={g.legRU} position={[-d.hip * 0.9, -0.02, 0]}>
          <mesh castShadow position={[0, -THIGH / 2, 0]}>
            <capsuleGeometry args={[0.062, THIGH, 5, 16]} />
            <primitive object={mats.pants} attach="material" />
          </mesh>
          <group ref={g.legRF} position={[0, -THIGH, 0]}>
            <mesh castShadow position={[0, -SHIN / 2, 0]}>
              <capsuleGeometry args={[0.052, SHIN, 5, 16]} />
              <primitive object={mats.pants} attach="material" />
            </mesh>
            <mesh castShadow position={[0, -SHIN, d.footL * 0.35]} scale={[0.8, 0.5, 1]}>
              <capsuleGeometry args={[0.05, d.footL, 4, 12]} />
              <primitive object={mats.shoe} attach="material" />
            </mesh>
          </group>
        </group>
      </group>

      <Furniture mats={mats} />
    </group>
  );
}

function Furniture({ mats }: { mats: ReturnType<typeof useMats> }) {
  return (
    <group>
      {/* office chair */}
      <mesh castShadow receiveShadow position={[0, PELVIS_Y - 0.06, -0.02]}>
        <boxGeometry args={[0.5, 0.09, 0.46]} />
        <primitive object={mats.chair} attach="material" />
      </mesh>
      <mesh castShadow position={[0, PELVIS_Y + 0.2, -0.24]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[0.46, 0.5, 0.08]} />
        <primitive object={mats.chair} attach="material" />
      </mesh>
      <mesh castShadow position={[0, PELVIS_Y - 0.28, -0.02]}>
        <cylinderGeometry args={[0.03, 0.03, 0.34, 12]} />
        <primitive object={mats.chair} attach="material" />
      </mesh>
      <mesh castShadow position={[0, 0.03, -0.02]}>
        <cylinderGeometry args={[0.26, 0.26, 0.04, 5]} />
        <primitive object={mats.chair} attach="material" />
      </mesh>
      {/* desk + laptop */}
      <mesh castShadow receiveShadow position={[0, PELVIS_Y + 0.14, 0.34]}>
        <boxGeometry args={[1.0, 0.04, 0.5]} />
        <primitive object={mats.wood} attach="material" />
      </mesh>
      <mesh position={[0, PELVIS_Y + 0.2, 0.32]} rotation={[-1.2, 0, 0]}>
        <boxGeometry args={[0.28, 0.19, 0.01]} />
        <primitive object={mats.dark} attach="material" />
      </mesh>
      <mesh position={[0, PELVIS_Y + 0.165, 0.4]}>
        <boxGeometry args={[0.28, 0.01, 0.19]} />
        <primitive object={mats.dark} attach="material" />
      </mesh>
    </group>
  );
}
