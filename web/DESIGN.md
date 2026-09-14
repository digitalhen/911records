# Design system — 9/11 City Records (web/)

Workstream B14. The visual system is the "records-desk" direction set by
`design/astra/style.css` and `design/astra/BRIEF.md`/`NOTES.md`: Arial/Helvetica
prose, monospace Bates stamps and data, cool white surfaces, slate text,
restrained blue actions, hairline borders, dense tables, no cards-with-shadows,
no gradients, no "AI look" (no sparkles, pastel chips, rounded-card grids).

This document describes the tokens and primitives added in B14 and how to use
them. `app/globals.css` is the single stylesheet (plain CSS, no CSS-in-JS, no
new dependencies); it is now hand-formatted (not minified) — reformat with
`npx prettier --write app/globals.css` after editing, don't re-minify it.

## Tokens (`app/globals.css`, top of the `:root` block)

All new UI should read these variables rather than hard-coding a color, size,
spacing, radius, focus ring or z-index:

- **Color** — `--ink`, `--muted`, `--muted-2`, `--line`, `--line-strong`,
  `--soft`, `--paper`, `--bg`, `--blue`, `--blue-dark`, `--blue-tint`,
  `--blue-line`, `--navy`, `--green`, `--amber`, `--red`, `--red-tint`,
  `--overlay` (dialog backdrop). `--red`/`--red-tint` generalize the astra
  mockup's hard-coded `#854437`/`#f7ece9` (removed/error states) into named
  tokens.
- **Type** — `--font-sans`, `--font-mono`; a scale `--text-2xs` (10px) through
  `--text-4xl` (36px, matches `h1`); `--leading-tight/snug/base/relaxed`;
  `--weight-regular/medium/semibold/bold`. Existing bare selectors (`h1`,
  `.eyebrow`, `.mono`, …) keep their historical literal values from the astra
  port — new component CSS should use the token names.
- **Spacing** — 4px-based scale `--space-1` (4px) … `--space-9` (48px).
  Matches the rhythm already used throughout astra's hand-tuned paddings.
- **Borders/radii** — `--border-width` (1px, hairline), `--radius-sm` (2px),
  `--radius-md` (3px). Kept deliberately small — this system has no
  cards-with-shadows and no big rounded corners.
- **Focus ring** — `--focus-ring-width/color/offset`, matching the existing
  `:focus-visible{outline:2px solid var(--blue)}` global rule.
- **z-index** — `--z-nav` (20, the sticky `.binder`), `--z-peek` (60, citation
  hover-card), `--z-dialog` (80), `--z-toast` (100).

## Primitives (`web/components/ui/*`)

Plain CSS classes, no new dependencies. Each wraps and extends astra's
existing selectors rather than reinventing them — the visual system was
already faithfully ported in B1; B14's job was consistency and gap-filling,
not a redesign.

| Component | File | Notes |
|---|---|---|
| `Button`, `ButtonLink` | `Button.tsx` | variants `primary/secondary/quiet/dark`, sizes `small/default/large`. `ButtonLink` picks `next/link` vs `<a>` by URL. |
| `Field`, `Input`, `Select`, `Textarea`, `LabeledInput` | `Field.tsx` | label/help/error wiring, `aria-invalid`-style `data-invalid`. |
| `Panel`, `PanelHeader`, `PanelBody` | `Panel.tsx` | bordered surface, no shadow. |
| `SectionHeading` | `SectionHeading.tsx` | eyebrow + title (+ optional trailing action), the recurring "section head" pattern. |
| `DataTable` | `DataTable.tsx` | dense by default; optional `sortable` columns (caller owns sort state/logic). |
| `Badge`, `Marker` | `Badge.tsx` | `Badge` = small status/type label (tones: neutral/blue/green/red/amber). `Marker` = the required "machine-extracted" label with an optional link — use on every derived value; never claim it's verified. |
| `Callout` (alias `Note`) | `Note.tsx` | generalizes astra's `.note`/`.coverage`/`.provenance`/`.error-note` into tones `plain/info/error`. |
| `EmptyState` | `EmptyState.tsx` | no-results/404/gone pages: heavy top rule + plain copy + optional actions. |
| `Dialog` | `Dialog.tsx` | native `<dialog>`, styled. Copy-first: pass `primaryAction` (Copy) and `secondaryAction` (Download) per BRIEF.md's "CSV exports … open copyable dialogs, with download secondary." |
| `Toast`, `useToast` | `Toast.tsx` | shared toast hook, previously duplicated per-component (e.g. `CaseFolderApp`). |

Import from the barrel: `import { Button, Field, Panel } from '@/components/ui'`.

New CSS backing these lives in one clearly marked block at the end of
`app/globals.css` ("B14 — design-system primitives"): spacing utilities
(`.stack`, `.mt-1`…`.mt-7` — use instead of `style={{ marginTop: N }}`),
`.field*`, `.input/.select/.textarea`, `.panel*`, `.section-heading`,
`.badge*`, `.marker`, `.callout*`, `.empty-state`, `DataTable`'s sortable-header
affordance, plus new `.button` modifiers (`.secondary`, `.quiet`, `.large`,
disabled state).

## `/styleguide`

`app/styleguide/page.tsx` (`noindex`) renders every primitive in every state
(hover/focus/disabled/error are exercised via real interactive markup —
tab through it) next to the token list. Use it to sanity-check a new
component against the system before adding another one-off style.

## Migration note for the entities/discovery agent

`web/app/entities/**`, `web/app/entity/**`, `web/app/signatory/**` and
`web/components/discovery/**` were **not touched** by B14 (out of scope —
being redesigned concurrently). When that work lands, please adopt:

- `Marker` (`components/ui/Badge.tsx`) in place of the ad-hoc `.extraction`
  spans in `TopicTree.tsx`/`Shared.tsx` etc., so "machine-extracted" reads
  identically everywhere (topics, search results, map, entities alike).
- `Callout` in place of hand-rolled note/warning `<div>`s.
- The spacing utilities (`.mt-1`…`.mt-7`) in place of inline
  `style={{ marginTop: N }}` — `discovery.module.css` and
  `home.module.css` don't currently have any, but new markup added there
  will otherwise reintroduce the pattern this workstream just removed.
- `Button`/`ButtonLink` for any new call-to-action buttons.
- Token variables (`app/globals.css` `:root`) for any new color/spacing/radius
  — several discovery/entity module CSS files (`discovery.module.css`,
  `home.module.css`) hard-code hex colors and pixel spacing that already have
  a token (e.g. `#eaf0f7` ≡ `--blue-tint`, `#859bb3` ≡ `--blue-line`,
  `#274d6e` is not tokenized — a topic-map–specific color, fine to keep
  local). Not required for launch, just worth aligning on the next pass so
  `discovery.module.css`/`home.module.css` don't drift from the shared
  palette.

Nothing in `app/globals.css`'s existing selectors was renamed or removed, so
none of this is a breaking change — it's additive.
