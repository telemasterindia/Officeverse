/**
 * Officeverse — CINEMATIC CELEBRATION SCENE (Phase 6, reworked for TV scale).
 *
 * Consumes the Phase-5 `recognitionBus "celebration"` payload (already
 * normalised by `celebration-visuals.ts`) and plays a ~5 s sports-broadcast
 * reveal that FILLS the Office TV:
 *
 *   0.0–0.4  dramatic background ignition + light burst
 *   0.3–1.0  hero photo enters (scale 0.6 → 1.0 + rise)
 *   0.7–1.4  employee NAME, huge
 *   1.1–1.8  achievement headline
 *   1.5–2.2  +points (only when the payload carries points > 0)
 *   1.5–3.8  dense multi-colour confetti + spray + moving light
 *   3.8–4.5  hero hold
 *   4.5–5.0  clean exit
 *
 * ARCHITECTURE:
 *   - ONE requestAnimationFrame loop over a PURE timeline. It stops at "done".
 *   - a single safety setTimeout in case rAF is throttled (background tab).
 *   - every timer / frame / listener / canvas is cleaned up on unmount.
 *   - data flow is ONE-WAY: payload → scene → visuals. Never scores, never
 *     mutates, never fetches, never computes points.
 *   - reduced motion → calm cross-fades, colour wash, no particle storm.
 *   - LEVEL_0 → a compact static recognition strip (no cinematic).
 */
import { useEffect, useRef, useState } from "react";
import {
  celebrationTimeline,
  isRevealed,
  phaseAt,
  visualsForLevel,
  type CelebrationInput,
  type CelebrationPhase,
} from "./celebration-visuals";
import { CelebrationLightBurst } from "./CelebrationLightBurst";
import { CelebrationParticles } from "./CelebrationParticles";
import { CelebrationPhoto } from "./CelebrationPhoto";
import { CelebrationText } from "./CelebrationText";
import { useCelebrationCue } from "./useCelebrationAudio";
import { interpolateAnnouncement, resolveAudioProfile } from "./celebration-audio-profiles";

interface Props {
  input: CelebrationInput;
  reduced: boolean;
  /** existing office_tv_settings.soundEnabled flag (read-only) */
  soundEnabled?: boolean;
  /** fired exactly once when the scene has fully finished (or errored out) */
  onDone: () => void;
}

/** hero portrait diameter — viewport sized so it truly dominates the TV */
const HERO_SIZE = "min(42vh, 42vw)";
const HERO_SIZE_SMALL = "min(30vh, 44vw)"; // narrow / portrait browser windows

const SCENE_CSS = `
.cs-root{position:absolute;inset:0;overflow:hidden;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(130% 130% at 50% 38%,#101a33 0%,#070c18 55%,#04060d 100%)}
.cs-pulse{position:absolute;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(circle at 50% 46%,rgba(76,141,255,.16),transparent 60%);
  animation:cs-pulse 2.6s ease-in-out infinite}
.cs-shake{animation:cs-shake 520ms ease-in-out 1}
.cs-stage{position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;gap:3.2vh;
  padding:0 5vw;text-align:center;max-width:96vw}
.cs-name{font-family:var(--font-display,'Space Grotesk',system-ui,sans-serif);font-weight:900;
  letter-spacing:.005em;line-height:.94;color:#f7f9ff;
  text-shadow:0 0.6vh 4vh rgba(0,0,0,.6),0 0 6vh color-mix(in srgb,#4C8DFF 40%,transparent);
  text-transform:uppercase}
.cs-headline{font-weight:900;letter-spacing:.05em;line-height:1;-webkit-background-clip:text;background-clip:text;
  color:transparent;text-transform:uppercase;filter:drop-shadow(0 0.3vh 2vh rgba(0,0,0,.4))}
.cs-sub{letter-spacing:.24em;color:#aebbdd;text-transform:uppercase}
.cs-points{font-weight:900;color:#8CFFD3;letter-spacing:.03em;
  text-shadow:0 0 5vh color-mix(in srgb,#34F5C5 50%,transparent);
  transition:transform 420ms cubic-bezier(.16,.9,.3,1)}
.cs-points-unit{font-size:.42em;color:#aebbdd;margin-left:.6vw;letter-spacing:.24em}
.cs-vignette{position:absolute;inset:0;pointer-events:none;z-index:2;
  background:radial-gradient(130% 130% at 50% 46%,transparent 34%,rgba(0,0,0,.62) 100%)}
.cs-kicker{font-weight:800;letter-spacing:.4em;color:#8fbcff;text-transform:uppercase;
  font-size:clamp(.8rem,min(2.4vw,2.6vh),2.4rem)}
.cs-static{display:flex;align-items:center;gap:3vw;padding:3vh 4vw;border-radius:2.4vh;z-index:3;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
.cs-static .cs-name{font-size:clamp(1.6rem,min(4.4vw,4.6vh),4rem)}
@keyframes cs-burst{0%{transform:scale(.24);opacity:0}
  14%{opacity:var(--cs-burst-o,1)}55%{transform:scale(1.18)}100%{transform:scale(1.55);opacity:0}}
@keyframes cs-flash{0%{transform:scale(.2);opacity:0}12%{opacity:.9}100%{transform:scale(1.4);opacity:0}}
@keyframes cs-rays{0%{opacity:0;transform:rotate(0deg) scale(.7)}
  16%{opacity:.9}70%{opacity:.5}100%{opacity:0;transform:rotate(26deg) scale(1.25)}}
@keyframes cs-ring-spin{to{transform:rotate(360deg)}}
@keyframes cs-pulse{0%,100%{opacity:.4}50%{opacity:.9}}
@keyframes cs-shake{10%,90%{transform:translate3d(-2px,0,0)}30%,70%{transform:translate3d(4px,0,0)}
  50%{transform:translate3d(-6px,0,0)}}
@media (prefers-reduced-motion: reduce){.cs-shake,.cs-pulse{animation:none}}
`;

export function CelebrationScene({ input, reduced, soundEnabled = false, onDone }: Props) {
  const visuals = visualsForLevel(input.level, input.particleProfile, reduced);
  const tl = celebrationTimeline(input.durationMs, input.level);

  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(false);
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Phase 7 — profile-driven audio cue: PRE sound → spoken announcement → POST
  // sound. Audio is NEVER required; if the kiosk blocks autoplay / has no
  // speechSynthesis this degrades to silence and the visual scene is unaffected.
  const audioProfile = resolveAudioProfile(input.audioProfile);
  const announcement = interpolateAnnouncement(audioProfile.tts.template, {
    employeeName: input.employeeName,
    points: input.points,
    headline: input.headline,
    eventLabel: input.kind.replace(/_/g, " "),
  });
  useCelebrationCue({
    profile: audioProfile,
    announcement,
    soundEnabled: soundEnabled && visuals.showCinematic,
    reduced,
    durationMs: tl.totalMs,
  });

  // ONE rAF loop over the pure timeline + a safety timeout
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const start = performance.now();
    const tick = (now: number) => {
      if (stopped) return;
      const t = now - start;
      setElapsed(t);
      if (phaseAt(t, tl) === "done") {
        stopped = true;
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const safety = setTimeout(finish, tl.totalMs + 1600);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearTimeout(safety);
    };
    // one scene per mount — deps intentionally static
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phase: CelebrationPhase = phaseAt(elapsed, tl);
  const exiting = phase === "exit" || phase === "done";
  const name = input.employeeName;

  // ---- LEVEL_0 · compact static recognition (no cinematic) ----
  if (!visuals.showCinematic) {
    return (
      <div
        className="cs-root"
        style={{ opacity: exiting ? 0 : 1, transition: "opacity 400ms ease" }}
      >
        <style>{SCENE_CSS}</style>
        <div className="cs-static">
          <CelebrationPhoto
            name={name ?? "Officeverse"}
            src={input.photoSrc}
            sizeExpr="min(16vh, 22vw)"
            scaleFrom={1}
            scaleTo={1}
            glow={false}
            accent={visuals.accent}
            revealed
            reduced
          />
          <div style={{ textAlign: "left" }}>
            <div className="cs-kicker">{input.headline ?? input.kind.replace(/_/g, " ")}</div>
            {name ? <div className="cs-name">{name}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  const reveal = {
    photo: isRevealed("photo", elapsed, tl),
    name: isRevealed("name", elapsed, tl),
    headline: isRevealed("headline", elapsed, tl),
    points: isRevealed("points", elapsed, tl),
  };
  const peaked = elapsed >= tl.peakMs;
  const heroSize =
    typeof window !== "undefined" && window.innerWidth < 720 ? HERO_SIZE_SMALL : HERO_SIZE;
  // eyebrow above the photo — omit it when it would just duplicate the headline
  const kickerRaw = input.kind.replace(/_/g, " ");
  const kicker =
    input.headline && input.headline.toUpperCase() === kickerRaw.toUpperCase() ? "" : kickerRaw;

  return (
    <div
      className={`cs-root${visuals.screenShake && peaked && !exiting ? " cs-shake" : ""}`}
      style={{
        opacity: exiting ? 0 : 1,
        transition: `opacity ${Math.max(320, tl.totalMs - tl.exitMs)}ms ease`,
      }}
    >
      <style>{SCENE_CSS}</style>

      {reduced ? null : <div className="cs-pulse" aria-hidden />}
      <CelebrationLightBurst
        intensity={visuals.lightIntensity}
        accent={visuals.accent}
        durationMs={tl.totalMs}
        reduced={reduced}
      />
      <CelebrationParticles
        kind={visuals.particleKind}
        count={visuals.particleCount}
        accent={visuals.accent}
        run={!exiting}
        durationMs={tl.totalMs}
      />
      {/* Phase 7 — a dollar-rain scene also layers multi-colour confetti on top
          (both canvases are finite + self-cleaning). */}
      {visuals.particleKind === "dollars" && !reduced ? (
        <CelebrationParticles
          kind="confetti"
          count={Math.round(visuals.particleCount * 0.7)}
          accent={visuals.accent}
          run={!exiting}
          durationMs={tl.totalMs}
        />
      ) : null}
      <div className="cs-vignette" aria-hidden />

      <div className="cs-stage">
        {kicker ? (
          <div
            className="cs-kicker"
            style={{ opacity: reveal.photo ? 1 : 0, transition: "opacity 400ms ease" }}
          >
            {kicker}
          </div>
        ) : null}
        <CelebrationPhoto
          name={name ?? "Officeverse"}
          src={input.photoSrc}
          sizeExpr={heroSize}
          scaleFrom={visuals.photoScaleFrom}
          scaleTo={visuals.photoScaleTo}
          glow={visuals.glow}
          accent={visuals.accent}
          revealed={reveal.photo}
          reduced={reduced}
        />
        <CelebrationText
          name={name}
          headline={input.headline}
          subheadline={input.subheadline}
          points={input.points}
          accent={visuals.accent}
          nameScale={visuals.nameScale}
          headlineScale={visuals.headlineScale}
          pointsScale={visuals.pointsScale}
          reveal={{ name: reveal.name, headline: reveal.headline, points: reveal.points }}
          reduced={reduced}
        />
      </div>
    </div>
  );
}
