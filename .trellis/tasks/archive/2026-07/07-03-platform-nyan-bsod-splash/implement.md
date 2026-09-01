# Implementation Plan: Tsian Boot / BSOD / Nyan Splash

## Preconditions

- Do not implement until this task is started with `task.py start`.
- Before editing `apps/platform-web/src/**`, load `trellis-before-dev` for platform-web frontend guidance.
- Preserve existing unrelated worktree changes in market/server files.

## Ordered Checklist

### 1. Activate task

- Review `prd.md`, `design.md`, and this `implement.md`.
- Start the task:

```bash
python ./.trellis/scripts/task.py start .trellis/tasks/07-03-platform-nyan-bsod-splash
```

### 2. Add media assets

- Create `apps/platform-web/public/nyan/` if missing.
- Copy:
  - `F:/workspace/reverse/nyan-cat-vue/public/nyan/technyancolor.gif`
  - `F:/workspace/reverse/nyan-cat-vue/public/nyan/technyancolor.mp3`
- Destination:
  - `apps/platform-web/public/nyan/technyancolor.gif`
  - `apps/platform-web/public/nyan/technyancolor.mp3`

### 3. Replace `SplashScreen.vue`

Target: `apps/platform-web/src/components/SplashScreen.vue`

- Remove old typewriter implementation and `useTypewriter` import.
- Keep `defineEmits<{ exit: [] }>()`.
- Use the existing logo asset at `/tsian.svg` for the gate; animate it with split/overlaid CRT glitch layers and a segmented `TSIAN` wordmark.
- Implement local phase state:

```ts
type Phase = "gate" | "boot" | "bsod" | "entering" | "idle" | "exiting"
```

- Implement timers:
  - boot progress interval;
  - boot-to-BSOD delay;
  - BSOD progress interval;
  - entering-to-idle timeout;
  - hint timeout;
  - music fade interval.
- Ensure all timers clear on unmount.
- Implement `requestFullscreenFromGesture()` helper.
- Implement `primeMusicForNyan()`, `fadeInMusic()`, `fadeOutMusic()`.
- Implement pointer and key handlers:
  - `gate`: click/touch/key except Escape → fullscreen + boot;
  - `bsod`: click/touch/key except Escape → fullscreen fallback + audio + Nyan;
  - `idle`: click/touch/key except Escape → exit.
- Template sections:
  - gate;
  - boot;
  - bsod;
  - stars layer;
  - rainbow/cat/hint when Nyan active;
  - audio element.
- CSS sections:
  - root fixed overlay;
  - gate animation using Tsian theme;
  - boot CRT loader;
  - BSOD;
  - stars;
  - rainbow;
  - cat;
  - hint;
  - responsive tweaks.

### 4. Simplify `App.vue` and add replay skip

Target: `apps/platform-web/src/App.vue`

- Add a versioned localStorage key, e.g. `tsian:splash:nyan-bsod:v1`.
- Add safe helpers:
  - `hasSeenSplash()` reads localStorage and returns `false` on errors.
  - `markSplashSeen()` writes localStorage and ignores errors.
- Initialize `showSplash` synchronously from `!hasSeenSplash()`.
- Replace `splashState` state machine with `showSplash` boolean.
- Remove root `animate-crt-switch` binding and `@animationend` handler.
- Change splash listener to `@exit="finishSplash"`; `finishSplash()` should call `markSplashSeen()` before hiding the splash.
- Keep `DesktopShell`, `ToastHost`, `ConfirmHost`, `FloatingWindow`, and platform initialization behavior unchanged.

### 5. Reverse searches / cleanup

Run searches after edits:

```bash
rg "SplashState|startCrtTransition|onCrtAnimationEnd|animate-crt-switch" apps/platform-web/src
rg "useTypewriter" apps/platform-web/src
rg "technyancolor|NYAN_CAT_OVERFLOW|requestFullscreen" apps/platform-web/src apps/platform-web/public
```

Expected:

- `SplashState`, `startCrtTransition`, `onCrtAnimationEnd` should be gone.
- `animate-crt-switch` may remain in `style.css` if unused global CSS cleanup is intentionally deferred; if removing it, verify no other references.
- `useTypewriter` may remain as an unused composable file if not part of this task's cleanup; no imports from `SplashScreen.vue` should remain.
- Nyan references should exist in the new splash and public assets.

### 6. Build validation

Run preferred platform-web build from repo root:

```bash
npm run build:web
```

If the root script is unavailable or fails due to script naming, run:

```bash
npm --prefix "F:/workspace/Tsian/apps/platform-web" run build
```

Report exact output if it fails.

### 7. Browser validation

If feasible, run dev server and inspect with Playwright:

```bash
npm --prefix "F:/workspace/Tsian/apps/platform-web" run dev -- --host 127.0.0.1
```

Manual/Playwright checks:

- initial gate shows Tsian animated split logo;
- first click anywhere enters boot and attempts fullscreen;
- boot progress reaches 99 then BSOD;
- BSOD progress starts low and grows slowly;
- click BSOD at <99 launches Nyan;
- Escape does not launch Nyan;
- audio plays after BSOD click and fades in;
- Nyan rainbow aligns to cat body center;
- final click exits to desktop;
- console has no new business errors.

## Risk / Rollback Points

- `SplashScreen.vue` is the largest change. If the UX breaks, restore the previous component from git.
- `App.vue` state simplification is small but changes splash removal semantics. Roll back together with `SplashScreen.vue`.
- Media assets are additive and can be removed if rolling back.

## Review Notes

- Match existing code style: Vue SFC, Composition API, no new dependencies, local component state.
- Avoid touching unrelated current worktree changes in market/server files.
- Do not commit unless explicitly requested.
