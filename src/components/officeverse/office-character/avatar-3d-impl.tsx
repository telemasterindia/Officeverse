import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Lightformer,
  useAnimations,
  useGLTF,
} from "@react-three/drei";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { HAIR, OUTFIT_COLOR, SKIN } from "@/lib/officeverse/avatar";
import type { AvatarConfig, CharacterPose, Expression } from "@/lib/officeverse/types";
import {
  CAMERA,
  CLIP_FADE,
  CLIP_FOR_POSE,
  HAS_MODEL,
  IDLE_BONES,
  MATERIAL_TARGETS,
  MODEL_DRACO,
  MODEL_SRC,
  MODEL_TRANSFORM,
  MODEL_URL,
  PARALLAX,
  RPM_CAMERA,
  RPM_ENABLED,
  RPM_REST_MORPHS,
  RPM_TRANSFORM,
  SEATED_POSE,
} from "./avatar-3d-config";
import { ProceduralFigure } from "./avatar-3d-figure";

useGLTF.preload(MODEL_SRC, MODEL_DRACO);
if (HAS_MODEL) useGLTF.preload(MODEL_URL);

const REDUCED =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* -------------------- posed rigged GLB (RPM or bundled) ------------------- */

/** Mixamo GLBs sometimes keep the "mixamorig:" colon; normalise it away. */
const boneKey = (n: string) => n.replace(":", "");

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && names.includes(boneKey(o.name))) found = o;
  });
  return found;
}

function PosedModel() {
  const gltf = useGLTF(MODEL_SRC, MODEL_DRACO);
  const group = useRef<THREE.Group>(null);
  const hasClips = gltf.animations.length > 0;

  const model = useMemo(() => {
    const root = skeletonClone(gltf.scene) as THREE.Object3D;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat && "envMapIntensity" in mat) mat.envMapIntensity = 0.9;
      }
      // Only hand-pose bones when the GLB ships no animation (e.g. an RPM avatar).
      if (!hasClips && o instanceof THREE.Bone) {
        const rot = SEATED_POSE[boneKey(o.name)];
        if (rot)
          o.rotation.set(o.rotation.x + rot[0], o.rotation.y + rot[1], o.rotation.z + rot[2]);
      }
    });
    return root;
  }, [gltf.scene, hasClips]);

  const { actions, names } = useAnimations(gltf.animations, group);
  useEffect(() => {
    if (!names.length) return;
    const idle =
      names.find((n) => /idle/i.test(n)) ?? names.find((n) => !/^t.?pose$/i.test(n)) ?? names[0];
    const act = idle ? actions[idle] : undefined;
    act?.reset().fadeIn(0.3).play();
    return () => void act?.fadeOut(0.3);
  }, [actions, names]);

  const morphMeshes = useMemo(() => {
    const arr: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) {
        arr.push(m);
        for (const [name, val] of Object.entries(RPM_REST_MORPHS)) {
          const idx = m.morphTargetDictionary[name];
          if (idx !== undefined) m.morphTargetInfluences[idx] = val;
        }
      }
    });
    return arr;
  }, [model]);

  const spine = useMemo(() => findBone(model, IDLE_BONES.spine), [model]);
  const head = useMemo(() => findBone(model, IDLE_BONES.head), [model]);

  const base = useRef({ headX: 0, headY: 0, spineX: 0 });
  useEffect(() => {
    base.current = {
      headX: head ? head.rotation.x : 0,
      headY: head ? head.rotation.y : 0,
      spineX: spine ? spine.rotation.x : 0,
    };
  }, [head, spine]);

  const blink = useRef({ next: 2.5, closing: 0 });

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (!REDUCED) {
      if (!hasClips && spine) spine.rotation.x = base.current.spineX + Math.sin(t * 1.6) * 0.016;
      if (!hasClips && head) {
        head.rotation.y = base.current.headY + Math.sin(t * 0.55) * 0.06;
        head.rotation.x = base.current.headX + Math.sin(t * 0.85) * 0.02;
      }
      if (group.current) {
        group.current.rotation.y = THREE.MathUtils.damp(
          group.current.rotation.y,
          RPM_TRANSFORM.rotationY + state.pointer.x * 0.14,
          3,
          delta,
        );
        group.current.rotation.x = THREE.MathUtils.damp(
          group.current.rotation.x,
          -state.pointer.y * 0.06,
          3,
          delta,
        );
      }
    }

    const b = blink.current;
    b.next -= delta;
    if (b.next <= 0 && b.closing <= 0) b.closing = 0.13;
    let v = 0;
    if (b.closing > 0) {
      b.closing -= delta;
      v = b.closing > 0.065 ? 1 : b.closing / 0.065;
      if (b.closing <= 0) {
        v = 0;
        b.next = 2 + Math.random() * 3;
      }
    }
    for (const m of morphMeshes) {
      const dl = m.morphTargetDictionary?.["eyeBlinkLeft"];
      const dr = m.morphTargetDictionary?.["eyeBlinkRight"];
      if (dl !== undefined) m.morphTargetInfluences![dl] = v;
      if (dr !== undefined) m.morphTargetInfluences![dr] = v;
    }
  });

  return (
    <group
      ref={group}
      position={[0, RPM_TRANSFORM.positionY, 0]}
      rotation={[0, RPM_TRANSFORM.rotationY, 0]}
      scale={RPM_TRANSFORM.scale}
    >
      <primitive object={model} />
    </group>
  );
}

/* --------------------------- local .glb (later) --------------------------- */

function tintMaterial(
  mat: THREE.Material,
  colours: { skin: string; hair: string; outfit: string },
) {
  const cloned = mat.clone();
  const name = (cloned.name || "").toLowerCase();
  const hit = (keys: string[]) => keys.some((k) => name.includes(k));
  const std = cloned as THREE.MeshStandardMaterial;
  if (!std.color) return cloned;
  if (hit(MATERIAL_TARGETS.skin)) std.color.set(colours.skin);
  else if (hit(MATERIAL_TARGETS.hair)) std.color.set(colours.hair);
  else if (hit(MATERIAL_TARGETS.outfit)) std.color.set(colours.outfit);
  return cloned;
}

function resolveClip(names: string[], pose: CharacterPose): string | null {
  const wanted = CLIP_FOR_POSE[pose] ?? CLIP_FOR_POSE.idle;
  for (const w of wanted) {
    const exact = names.find((n) => n === w);
    if (exact) return exact;
  }
  for (const w of wanted) {
    const loose = names.find((n) => n.toLowerCase().includes(w.toLowerCase()));
    if (loose) return loose;
  }
  return names.find((n) => n.toLowerCase().includes("idle")) ?? names[0] ?? null;
}

function CustomModel({ config, pose }: { config: AvatarConfig; pose: CharacterPose }) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const group = useRef<THREE.Group>(null);

  const colours = useMemo(
    () => ({
      skin: SKIN[config.skin].base,
      hair: HAIR[config.hairColor].base,
      outfit: OUTFIT_COLOR[config.outfitColor].base,
    }),
    [config.skin, config.hairColor, config.outfitColor],
  );

  const model = useMemo(() => {
    const root = skeletonClone(scene) as THREE.Object3D;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => tintMaterial(m, colours))
        : tintMaterial(mesh.material, colours);
    });
    return root;
  }, [scene, colours]);

  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    if (!names.length) return;
    const clip = resolveClip(names, pose);
    if (!clip || !actions[clip]) return;
    const next = actions[clip];
    next.reset().fadeIn(CLIP_FADE).play();
    return () => {
      next.fadeOut(CLIP_FADE);
    };
  }, [actions, names, pose]);

  useFrame((state, delta) => {
    if (!group.current || REDUCED) return;
    const lambda = 3 / Math.max(PARALLAX.ease, 0.05);
    const rot = group.current.rotation;
    rot.y = THREE.MathUtils.damp(
      rot.y,
      MODEL_TRANSFORM.rotationY + state.pointer.x * PARALLAX.yaw,
      lambda,
      delta,
    );
    rot.x = THREE.MathUtils.damp(rot.x, -state.pointer.y * PARALLAX.pitch, lambda, delta);
  });

  return (
    <group
      ref={group}
      position={[0, MODEL_TRANSFORM.positionY, 0]}
      rotation={[0, MODEL_TRANSFORM.rotationY, 0]}
      scale={MODEL_TRANSFORM.scale}
    >
      <primitive object={model} />
    </group>
  );
}

/* --------------------------------- scene --------------------------------- */

function Rig() {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.lookAt(0, RPM_CAMERA.targetY, 0);
  }, [camera]);
  return null;
}

export default function Avatar3DScene({
  config,
  pose = "idle",
  expression,
}: {
  config: AvatarConfig;
  pose?: CharacterPose;
  expression?: Expression | undefined;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.9]}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false }}
      camera={{ position: RPM_CAMERA.position, fov: RPM_CAMERA.fov }}
      frameloop={REDUCED ? "demand" : "always"}
      style={{ width: "100%", height: "100%" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <Rig />
      <Environment resolution={128}>
        <Lightformer intensity={2.4} position={[2.5, 2.5, 3]} scale={[5, 5, 1]} color="#fff3e6" />
        <Lightformer intensity={1.1} position={[-3, 1.5, -2]} scale={[6, 6, 1]} color="#bcd0ff" />
        <Lightformer intensity={0.7} position={[0, -1.5, 2]} scale={[7, 3, 1]} color="#ffffff" />
      </Environment>
      <hemisphereLight args={["#fff2df", "#2a2440", 0.55]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[2.6, 3.4, 2.6]}
        intensity={2.3}
        color="#ffe9d0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-1}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-3, 2.2, -2.4]} intensity={0.9} color="#b9ccff" />
      <Suspense fallback={null}>
        <PosedModel />
      </Suspense>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <shadowMaterial opacity={0.24} />
      </mesh>
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.5}
        scale={4}
        blur={2.4}
        far={2}
        resolution={512}
        color="#1b1424"
      />
    </Canvas>
  );
}
