# Design: Tsian Boot / BSOD / Nyan Splash

## Scope

Replace the current `apps/platform-web` splash experience with a single self-contained `SplashScreen.vue` flow:

```text
gate -> boot -> bsod -> entering -> idle -> exiting -> emit exit
```

The feature is frontend-only. It does not modify platform contracts, backend APIs, storage schemas, or desktop shell behavior.

## Current Architecture

### Existing boot overlay

- `apps/platform-web/src/App.vue` mounts `DesktopShell` immediately and overlays `SplashScreen` while `splashState !== "done"`.
- Existing splash state is split between parent and child:
  - child `SplashScreen.vue` owns typewriter text and emits `exit` on click;
  - parent `App.vue` owns `typing -> animating -> done` and CRT animation fallback.

### Replacement architecture

Move the whole opening performance into `SplashScreen.vue`:

- Parent `App.vue` only tracks whether splash is visible.
- Child `SplashScreen.vue` owns all phases, timers, media, fullscreen attempts, and final `exit` emit.

This avoids combining the old CRT transition with the new Nyan exit animation.

## Component State

`App.vue` should make a synchronous initial skip decision before rendering the splash:

```ts
const SPLASH_SEEN_KEY = "tsian:splash:nyan-bsod:v1"
const showSplash = ref(!hasSeenSplash())
```

`SplashScreen.vue` should use a local union state:

```ts
type Phase = "gate" | "boot" | "bsod" | "entering" | "idle" | "exiting"
```

Additional local refs:

- `bootProgress: Ref<number>`
- `bsodProgress: Ref<number>`
- `showHint: Ref<boolean>`
- `audioRef: Ref<HTMLAudioElement | undefined>`
- star list and timers for Nyan background

Derived state:

- `nyanActive = entering | idle | exiting`
- `isClickable = gate | bsod | idle`

## Flow Design

### Gate

Initial phase. Shows a full-screen Tsian RetroOS logo gate.

Interaction:

- whole screen listens to pointer/touch;
- document keydown can also be supported except Escape;
- on first user gesture:
  - call `requestFullscreenFromGesture()`;
  - switch to `boot`;
  - start boot progress timer.

Visual direction:

- use `public/tsian.svg` as the primary logo asset;
- split the logo presentation into animated layers/pieces where practical (for example multiple overlaid SVG copies, clipped panels, scan offsets, or separate wordmark fragments) so the gate feels assembled rather than static;
- pair the logo with a `TSIAN` wordmark made from separate spans/blocks;
- each segment can animate in with staggered translate/skew/opacity/filter;
- use existing theme variables: `--color-void`, `--color-neon`, `--color-text-main`, `--font-mono`;
- include CRT scanlines/noise overlays using existing global utility classes.

### Boot

A Tsian-flavored fake boot loader.

Behavior:

- progress starts at 0;
- increments dynamically up to 99;
- after reaching 99, pause briefly then switch to `bsod`;
- start BSOD progress timer on transition.

Visual direction:

- keep warm CRT look;
- avoid using the prototype's generic black boot style;
- show status lines like runtime/workspace/context restore;
- progress should feel systemic, not cute.

### BSOD

Fake Windows 8-style blue screen parody.

Behavior:

- progress starts low and increases slowly up to 99;
- user can trigger at any progress;
- no visible click prompt;
- pointer/touch/keydown except Escape launches Nyan.

Interaction on launch:

- clear BSOD timer;
- call `requestFullscreenFromGesture()` again as fallback;
- call `primeMusicForNyan()` immediately in the same user gesture;
- switch to `entering`;
- schedule idle phase.

Visual direction:

- blue `#2067b2` background;
- large `:(`;
- white light-weight text;
- parody copy with `NYAN_CAT_OVERFLOW` / `technyancolor.sys`;
- no Microsoft/Windows branding.

### Nyan entering / idle / exiting

Use the prototype mechanics with Tsian integration:

- cat image from `/nyan/technyancolor.gif`;
- audio from `/nyan/technyancolor.mp3`;
- cat width around `250px` desktop and `220px` small screens;
- `image-rendering: pixelated` / `crisp-edges`;
- rainbow height around `96px` desktop;
- rainbow endpoint reaches the cat body center (`--rainbow-anchor: 0px`) so idle bounce does not reveal gaps.

Entering:

- rainbow stage and cat image both slide from `-110vw` to center using the same duration/easing.
- music fades in from 0 to target volume.

Idle:

- cat keeps subtle horizontal bounce.
- show `Click anywhere to enter`.

Exiting:

- cat exits right;
- rainbow expands to cover trailing path;
- music fades out;
- emit `exit` after exit duration.

## Fullscreen Strategy

There is no native host fullscreen API in the current repository.

Implement browser Fullscreen API helper:

```ts
requestFullscreenFromGesture()
```

Properties:

- called only from user gesture handlers (`gate` click and `bsod` click/key);
- supports standard and vendor-prefixed methods where TypeScript allows via local extended type;
- catches rejection silently because fullscreen is a bonus;
- does not intercept Escape or prevent fullscreen exit.

## Audio Strategy

Browser autoplay restrictions require audio to start from user gesture.

- Do not call `audio.play()` on mount.
- In BSOD user gesture:
  - set `audio.muted = false`;
  - set `audio.volume = 0`;
  - set `audio.currentTime = 0` when possible;
  - call `audio.play()`;
  - begin fade-in shortly after launch.
- Playback failure must not block the visual flow.
- Fade-out on Nyan exit pauses audio at volume 0.

## Assets

Copy prototype assets into Vite public root:

- `apps/platform-web/public/nyan/technyancolor.gif`
- `apps/platform-web/public/nyan/technyancolor.mp3`

Use root-relative public URLs:

- `/nyan/technyancolor.gif`
- `/nyan/technyancolor.mp3`

No new runtime dependencies.

## Replay / Skip Strategy

The full opening performance is memorable but intentionally long. It should be treated as a first-run experience per browser/device.

- Store a versioned localStorage marker after the Nyan exit completes and before/while emitting `exit`.
- `App.vue` reads this marker synchronously during setup to decide whether `SplashScreen` should mount at all.
- If `localStorage.getItem` or `setItem` throws, fail open: show the splash and do not block startup.
- Use a versioned key such as `tsian:splash:nyan-bsod:v1`; changing the suffix later replays the updated splash once.
- This should not depend on `useAuth().loggedIn` because auth initialization is asynchronous and would complicate first paint.

## Compatibility / Accessibility

- Escape should not launch Nyan from gate or BSOD, preserving user intent to exit fullscreen.
- If fullscreen is rejected, continue in fixed overlay mode.
- Reduced motion is not currently a hard requirement, but animations should not require JavaScript frame loops beyond timers.
- The splash remains keyboard-triggerable with non-Escape keys for desktop users.

## Rollback

Rollback is localized:

- restore previous `App.vue` splash state machine;
- restore previous `SplashScreen.vue` typewriter implementation;
- remove `/public/nyan` assets if no longer needed.

No data migration is involved.
