# Officeverse 3D avatar

Drop your rigged character here as:

    public/avatars/officeverse-character.glb

Then open `src/components/officeverse/office-character/avatar-3d-config.ts` and set:

    export const HAS_MODEL = true;

That's the whole switch. Until then the app renders the existing SVG character
everywhere (no WebGL, no perf cost).

## Model requirements

| Property        | Expected                                                            |
|-----------------|-------------------------------------------------------------------- |
| Format          | glTF-binary (`.glb`), embedded textures                            |
| Up axis         | +Y                                                                  |
| Units           | metres, roughly 1.7 tall standing (or seated — tune `positionY`)   |
| Origin          | between the feet / seat base                                       |
| Animations      | at least an idle loop; ideally: Idle, Typing, Wave, Thinking, Happy, Celebrate |
| Rig             | standard humanoid skeleton (Mixamo / Ready Player Me / Blender)    |
| Poly / textures | keep it lean — this renders live in a browser canvas              |

## Per-employee colour (optional)

Name the model's materials so the name contains `skin`, `hair`, or `outfit`
(e.g. `M_Skin`, `hair_mat`, `Outfit_Body`). The app then tints them from each
employee's deterministic palette. Any material that doesn't match renders as
authored. Edit `MATERIAL_TARGETS` in the config to change the matching.

## Animation names

If your clips are named differently, edit `CLIP_FOR_POSE` in the config — each
pose lists candidate clip names, tried in order, with an `Idle` fallback.

## Where it appears

Hero spots only: Workspace / Closer Hub / HR / Command Center headers, Login,
Attendance, Avatar Studio preview. Roster/table avatar chips stay on the SVG
renderer by design.
