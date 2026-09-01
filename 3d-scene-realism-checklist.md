# 3D Meeting Room — Realism Pass (plan + checklist)

Goal: bring the interactive room closer to the reference render
`Codex Image Aug 30, 2026, 02_01_49 PM.png` (soft bounced light, materials with a
finish, framed boards, detail density) **without regressing web performance**.

Scope: `src/visualization/**`, `src/components/onboarding/pre-meeting-stage.tsx`,
`scripts/assets/**`. The DOM UI and the room's data flow are untouched — the
canvas stays `aria-hidden` ambiance.

---

## Guardrails (do not break these)

- [ ] **No third‑party assets** — every texture/HDR/env is procedural or baked by
  our own scripts (precedent: `scripts/assets/convert.py`, `textures.ts`).
  `<Environment preset|files>` fetches from a CDN → **not allowed**; use
  `<Environment>` with `<Lightformer>` children only.
- [ ] **CSP allowlist** — no new external hosts. No runtime `fetch` for assets
  beyond the existing `/models/**` and `/public/**`.
- [ ] **Perf budget** — 60 fps on target desktop (M‑series / discrete GPU);
  ≥ 45 fps on mid Android / integrated‑Intel on the `low` tier. Non‑3D routes
  unaffected (3D bundle is already client‑only + route‑scoped).
- [ ] **Determinism** — the layout is deterministic; any prop jitter/tilt stays
  seeded.
- [ ] **Legibility** — no grade/DoF/blur that softens board text or the
  "you" ring / halo cues.
- [ ] **`prefers-reduced-motion`** (already wired via `useShell().reducedMotion`)
  also forces the `low` effects tier.

---

## Phase 0 — Measure first (before touching anything)

- [ ] Add a dev‑only `<Stats>` (drei) + Chrome DevTools Performance capture on the
  room route and the welcome route.
- [ ] Record **baseline** here for 3 devices — desktop (M‑series), integrated
  Intel laptop, mid Android:
  - [ ] frame time (ms) idle / during camera flight
  - [ ] draw calls, triangles, programs
  - [ ] texture memory, geometry memory (`renderer.info`)
  - [ ] JS bundle size for the 3D chunk (`next build` output)
- [ ] Identify the current hot path — likely candidates: the **8 figure GLB
  clones** (`participant-avatar.tsx`), **canvas‑texture redraws** on room state
  change (`textures.ts` `useBoardFaceTexture`), or shadow map re‑render.
- [ ] Note current `Canvas` config: `dpr={[1,1.75]}`, `gl={{antialias,alpha}}`,
  `shadows={{type: PCFShadowMap}}`, lights = 1 hemisphere + 2 directional, fog,
  no env, no post.

**Baseline numbers:** _(fill in)_

**Exit:** we know what's actually slow, so later phases spend the right budget.

---

## Phase 1 — Lighting & tone  ·  runtime cost ≈ 0

### 1a. Renderer / tone mapping
- [ ] Set/confirm `gl.toneMapping = ACESFilmicToneMapping`,
  `gl.toneMappingExposure ≈ 0.95`, `outputColorSpace = SRGBColorSpace` in **both**
  Canvases (`room-visualization.tsx`, `pre-meeting-stage.tsx`).
- [ ] `PCFShadowMap` → `PCFSoftShadowMap`.
- [ ] Directional key light: shadow map `2048` (not 4096 — VRAM), tighten
  `shadow-camera-{left,right,top,bottom,near,far}` to the room bounds, tune
  `shadow-bias` / `shadow-normalBias` to kill acne without peter‑panning.
- [ ] After first frame, `keyLight.shadow.autoUpdate = false` (scene is static);
  flip `needsUpdate = true` only when seat count changes.

### 1b. Environment (soft fill + reflections, procedural)
- [ ] Add `<Environment frames={1} resolution={256}>` with `<Lightformer>`
  children: a large dim **ceiling softbox**, a **warm floor bounce** plane, a
  **cool "window"** plane on the open side.
- [ ] Reduce `hemisphereLight` intensity; keep one warm key `directionalLight`
  (`#fff7ea`) + a low cool fill + a dim rim behind the boards.
- [ ] Set `envMapIntensity` per material group (floor/table/glass higher, walls
  low).

### 1c. Contact / accumulated shadows
- [ ] `<AccumulativeShadows>` (or `<ContactShadows>` if simpler) blurred plane
  under the table + chair cluster.
- [ ] Verify: bakes over ~40–60 frames at load, **zero per‑frame cost** after.

### 1d. LED wall sconces
- [ ] Thin emissive vertical bars between boards + one low‑intensity warm
  `pointLight` each. (Reference leans on these for local believable light.)

**Verify:** side‑by‑side screenshots vs baseline; frame time unchanged within
noise on all 3 devices; no shadow acne / z‑fighting.

---

## Phase 2 — Post‑processing  ·  per‑frame cost, tier‑gated

- [ ] Add deps `@react-three/postprocessing` + `postprocessing`
  (~40–60 KB gz added to the 3D chunk — record the TBT/bundle delta).
- [ ] `<EffectComposer>` with: `SMAA` + `N8AO` (half‑res mode) + subtle `Bloom`
  (high threshold — emissive sconces/screens only) + `Vignette` + fine grain.
- [ ] **Quality tiers:**
  - [ ] `high` — full stack
  - [ ] `medium` — N8AO half‑res, no bloom
  - [ ] `low` — composer disabled entirely (Phase‑1 baked look only)
- [ ] Auto‑select tier: GPU sniff (`gl` renderer string) + `navigator.deviceMemory`
  + a 1‑second `<PerformanceMonitor>` probe that downgrades on sag.
- [ ] Drop `dpr` to `[1, 1.5]` whenever the composer is active (fullscreen passes
  are fill‑rate bound).
- [ ] Disable the composer during camera flights and when the tab is hidden;
  consider `frameloop="demand"` for the idle room (throttle halo/beacon).
- [ ] `prefers-reduced-motion` → `low`.

**Verify:** 60 fps desktop `high`; ≥ 45 fps mid Android `low`; Lighthouse
Total Blocking Time delta on the room route is acceptable.

---

## Phase 3 — Materials  ·  small per‑frame cost

- [ ] `meshPhysicalMaterial` upgrades:
  - [ ] `sheen` + `sheenRoughness` on chair fabric (`participant-avatar.tsx` /
    chair prop)
  - [ ] `clearcoat` on the table top and glossy whiteboards
  - [ ] `transmission` / `ior` / `thickness` on the glass balustrade
    (fallback to `opacity` if it costs too much on mobile)
  - [ ] `anisotropy` on brushed‑metal chair base + board trim
- [ ] **Roughness breakup** — multiply every roughness by a large‑scale noise so
  no surface is perfectly uniform (extend `textures.ts`).
- [ ] **Normal maps** — extend `speckle()` / `grain()` in `textures.ts` to also
  emit a height→normal map (Sobel on the greyscale); wire as `normalMap` on
  wall / floor / wood. One‑time canvas work at startup.
- [ ] Black trim (`SURFACE.frame`): flat `#2e2b27` → very dark grey,
  `roughness ≈ 0.35`, slight `metalness`, so it catches a soft highlight.
- [ ] Tune `envMapIntensity` on floor / table / glass once the env exists.
- [ ] **Edge bevels** — `toCreasedNormals` on the prop GLBs; add 2–3 mm chamfer
  strips on the table rim, credenza edges, board frames.

**Verify:** no z‑fighting / shading artefacts; texture RAM within Phase‑0 budget;
frame‑time delta acceptable on integrated GPU.

---

## Phase 4 — Geometry & detail props  ·  draw‑call cost, mitigate with instancing

- [ ] **Boards as framed objects** — extruded frame profile + inset surface
  (8–10 mm) + a soft dark contact‑shadow decal where the frame meets the wall +
  a marker tray shelf.
- [ ] **Corkboard variant** for Proposals — wood frame, cork‑noise material,
  pushpin meshes, slightly tilted sketch quads.
- [ ] **Wood‑slat acoustic panels** flanking the Constraints board —
  `InstancedMesh` (~30 slats = 1 draw call).
- [ ] **Sticky notes** — 2 mm thickness, seeded ±4° tilt, top‑edge curl, their
  own tiny contact shadow, irregular cluster (not a grid).
- [ ] **Life props** — flip chart on casters, floor lamp by the sofa, water
  carafe + glasses on a credenza, charging pucks, a tablet on the table, leaning
  books, a second plant species, a small round side table.
- [ ] **Chairs** — creased normals or a better model; seeded slight angle
  variation; tuck to the table (not perfectly radial).
- [ ] **Dollhouse framing polish** — plinth height, mitred ceiling trim, thinner
  glass‑rail mullions to match the reference.
- [ ] **Instancing + geometry merge** for all repeated static geometry
  (`BufferGeometryUtils.mergeGeometries`); share materials.
- [ ] Compress any new GLBs (Draco / meshopt via the existing Blender pipeline);
  new textures as KTX2/Basis.

**Verify:** draw calls increase by a bounded amount (target ≤ +15);
triangles within budget; mobile still ≥ 45 fps on `low`.

---

## Phase 5 — Bake cheats  ·  best quality‑per‑frame (optional, needs build step)

- [ ] Blender **lightmap bake** script for the static shell (walls, floor,
  credenzas, boards) alongside `scripts/assets/convert.py`.
- [ ] Ship the lightmap (KTX2), apply as `lightMap` / `aoMap`; then **remove
  real‑time lights + shadow casting for the shell** → net frame‑time win.
- [ ] Blurred **planar floor reflection** (`MeshReflectorMaterial`, low‑res
  buffer ~256–512, ~8 % mix) — `high` tier only.
- [ ] **Hero‑only DoF** on the welcome shot (static beauty frame; never in the
  interactive room).

**Verify:** shell renders with baked GI; runtime light count reduced; overall
frame time ≤ Phase‑0 baseline.

---

## Rollout

- [ ] Feature‑flag the whole pass behind a **quality setting** in
  `src/components/shell/drawers/settings-drawer.tsx` — auto‑detected tier with a
  manual override; remember the choice (`localStorage`).
- [ ] Default tier chosen by device probe; `reduced-motion` pins `low`.
- [ ] Welcome/hero shot runs heavier; interactive room runs lighter.
- [ ] Land in small PRs, one phase each, each with before/after screenshots +
  the 3‑device perf numbers in the description.
- [ ] Update `docs/product-ux.md` (or a `docs/workstreams/` doc) with the final
  tier behaviour.

---

## Risks / open questions

- [ ] Phase 0 may show the **8 figure clones** or **canvas redraws** are already
  the bottleneck — if so, fix that first (instance the figures, memoize/skip
  redundant board redraws) before spending on lighting.
- [ ] `postprocessing` bundle size vs room‑route TTI — measure, and lazy‑load the
  composer only for `medium`/`high`.
- [ ] Mobile VRAM — shadow maps + normal/rough maps + lightmap; keep shadow maps
  at 2048 and compress textures.
- [ ] `transmission` on glass can be expensive on integrated GPUs — have the
  `opacity` fallback ready and tier‑gate it.
- [ ] `<Environment>` re‑render — must be `frames={1}`; a stray `Infinity`
  re‑bakes the cubemap every frame.

---

## Cost cheat‑sheet

| Technique | Per‑frame | Load / bundle | Feels it |
|---|---|---|---|
| Tone map / exposure / soft shadow map | ~0 | 0 | nobody |
| Baked / `AccumulativeShadows` | 0 (one‑time bake) | ~40–60 frames at load | nobody |
| `<Environment>` + `<Lightformer>` (`frames={1}`) | ~0 | 0 | nobody |
| Normal maps from canvas generators | ~free | few MB tex RAM | very low‑end |
| Offline lightmap bake | **negative** (drops runtime lights) | +200 KB–1 MB + build step | net win |
| Detail props (instanced / merged) | small | +100–300 KB GLB | mobile if not instanced |
| N8AO / SSAO | 1.5–4 ms desktop · 8–15 ms integrated/mobile | +40–60 KB gz | mobile / old laptops |
| Bloom | 1–2 ms | (same dep) | mobile |
| SMAA · Vignette · grain | <1 ms combined | (same dep) | nobody |
| `MeshReflectorMaterial` floor | ~1.5–2× scene that frame | 0 | `high` tier only |
| DoF | 2–4 ms + hurts text | (same dep) | hero shot only |
| 4096² shadow maps ×2 | render pass + 128 MB VRAM | 0 | mobile — **use 2048²** |
