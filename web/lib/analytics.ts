/**
 * Google Analytics (gtag.js) — client-safe helper. The <script> tags live in
 * components/Analytics.tsx (mounted by app/layout.tsx).
 *
 * The measurement id, and the off switch. The default is NOT here: it is
 * `ARG NEXT_PUBLIC_GA_ID=G-7143D6VVVR` in the Dockerfile's build stage,
 * passed through docker-compose.yml's `build: args:` as the bare
 * `NEXT_PUBLIC_GA_ID:` form (modeled on ~/Code/prospect's issue #982). So a
 * build that sets nothing still gets the same property id it always had —
 * unset means unchanged — while a build that sets the variable can reach
 * this read, which a `||` fallback would make impossible.
 *
 * Empty means OFF: no tag, no script, no beacon (components/Analytics.tsx
 * returns null). A trimmed, case-insensitive `off` means the same thing —
 * that is the value to set in Dokploy to disable the tag, because "empty"
 * has to survive the Dokploy UI, the project .env and compose interpolation,
 * and any layer that drops an empty entry would hand back the exact defect
 * #982 fixed: a field that looks like it acted and did not.
 *
 * THE OFF-VALUES ARE EXACTLY TWO — empty and `off`. Do not add `false`, `0`,
 * `none` or `disabled`.
 *
 * In local dev, NEXT_PUBLIC_GA_ID is unset (no default here, unlike the
 * Dockerfile), so the tag never loads unless a developer sets it explicitly.
 */
const RAW_GA_ID = (process.env.NEXT_PUBLIC_GA_ID ?? '').trim();
export const GA_ID = RAW_GA_ID.toLowerCase() === 'off' ? '' : RAW_GA_ID;
