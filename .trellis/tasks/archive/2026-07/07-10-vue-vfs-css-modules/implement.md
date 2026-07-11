# Implementation Plan: Vue VFS 加固与 CSS Modules

## Preflight

- [ ] Review current git diff for the five `src/frontend-build` files; separate prior/user changes from this task's baseline fixes.
- [ ] Read `platform-web/frontend` quality and type-safety specs plus shared reuse/module-structure guides.
- [ ] Confirm installed `@vue/compiler-sfc` type/API signature for `rewriteDefault` and parser plugins.
- [ ] Confirm installed `esbuild-wasm` supports `local-css` in plugin `onLoad` results.

## Implementation

1. **Harden shared VFS resolution**
   - [ ] Consolidate path/query parsing and actual-file resolution so `onResolve` returns canonical keys.
   - [ ] Preserve importer-relative resolution for virtual SFC style CSS imports.
   - [ ] Ensure `@/` is never externalized by CDN plugin.
   - [ ] Keep `?raw`, `?url`, `?inline`; reject unsupported worker/custom query paths clearly.
   - [ ] Use `local-css` for standalone `.module.css`.

2. **Replace Vue default-export regex**
   - [ ] Replace `toComponentBinding` regex with `@vue/compiler-sfc` official `rewriteDefault` or verified equivalent.
   - [ ] Preserve TypeScript parser behavior for `<script lang="ts">` and `<script setup lang="ts">`.
   - [ ] Verify template-only and script-only SFC assembly.

3. **Implement virtual CSS Modules**
   - [ ] Parse each style block's `module` value into `$style` or named key.
   - [ ] Generate side-effect imports for ordinary styles and namespace imports for module styles.
   - [ ] Compile scoped CSS before returning `local-css`.
   - [ ] Attach module namespaces to `__sfc_main.__cssModules` without clobbering multiple modules.
   - [ ] Preserve relative CSS asset resolution from the owning `.vue` directory.
   - [ ] Keep clear errors for external style src and unsupported preprocessors.

4. **Normalize outputs consistently**
   - [ ] Review entry/output/CSS path normalize helper use across write-back.
   - [ ] Verify stale cleanup compares exactly the stored normalized paths.

5. **Add regression coverage**
   - [ ] Add a minimal browser build fixture/harness following existing project patterns; avoid introducing a Node-only test that cannot exercise esbuild-wasm runtime behavior.
   - [ ] Cover local component binding, scoped style, CSS Modules, alias/directory resolution, image/style URL, asset query and leading-slash output.
   - [ ] Cover clear failures for unsupported style/query.

## Validation

- [ ] Run `npm run build:web`.
- [ ] Run the new browser build fixture/self-check.
- [ ] Rebuild the real `play-frontend-dev` source package through platform-web.
- [ ] Load packaged iframe and inspect DOM, console, network and computed/style outcome.
- [ ] Run `git diff --check` on changed files.
- [ ] Record warnings and any skipped validation honestly.

## Review Gates

- [ ] No plugin object carries fields other than `name` and `setup`.
- [ ] `esbuild.initialize` call-once behavior is unchanged.
- [ ] No Node built-in dependency enters browser build code.
- [ ] No bridge, contract, Dexie or Service Worker DB change.
- [ ] Existing old-dist-on-build-failure behavior remains intact.

## Rollback Points

- After step 2: official Vue rewrite can be validated independently of CSS Modules.
- After step 3: CSS Modules changes can be reverted without discarding VFS/output/SFC binding fixes.
- Before browser reupload: prior card dist remains available if the new source build fails.
