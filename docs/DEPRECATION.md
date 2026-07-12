# Package deprecation: `@vantanminh/harness` → `5harness`

**Decision:** [0016](decisions/0016-npm-package-5harness.md) · **Story:** US-040

## What changed

| | Before | After |
| --- | --- | --- |
| npm package | `@vantanminh/harness` | **`5harness`** (unscoped) |
| CLI bin | `harness` | **`harness`** (unchanged) |
| Install | `npm i -g @vantanminh/harness` | `npm i -g 5harness` |

GitHub repository: [vantanminh/5harness](https://github.com/vantanminh/5harness)
(renamed from `vantanminh/harness`).

## Why

Shorter, memorable install UX for a global tool. Unscoped name `5harness` is
the product package identity on npm.

## Migration for users

```bash
# remove old scoped global install (optional)
npm uninstall -g @vantanminh/harness

# install new package (same bin)
npm i -g 5harness
harness --version
```

Project-local:

```bash
npm uninstall @vantanminh/harness
npm i -D 5harness
npx harness --help
```

No change to project markdown entities, registry layout (`~/.harness`), or
command surface — only the **npm package name**.

## Deprecation path (maintainers)

1. **Publish** `5harness` from this repo (`package.json` `name`).
2. **Trusted Publisher** on npmjs.com for package `5harness` (workflow `ci.yml`).
3. On the last publish of **`@vantanminh/harness`** (optional maintenance
   release), run:

   ```bash
   npm deprecate @vantanminh/harness@ "*" "Package renamed to 5harness. Install: npm i -g 5harness (bin: harness). See https://github.com/vantanminh/5harness/blob/main/docs/DEPRECATION.md"
   ```

4. README / install docs point only at `5harness`.
5. Do not dual-publish indefinitely; deprecate old name after first successful
   `5harness` release.

## Agent / template note

`templates/AGENTS.md` and product docs use `npm i -g 5harness`. Repos that still
mention `@vantanminh/harness` should run `harness upgrade` after installing the
new global package, or update the install line manually.
