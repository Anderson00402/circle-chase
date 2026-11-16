# UI kit

Shared components and design tokens for every page. Svelte 5 runes, typed props, no dependencies.

```svelte
import { Page, PageHeader, Panel, Stat, Button } from '#lib/ui/index.ts';
```

## Building a page in the shell

- The layout (`src/routes/+layout.svelte`) draws the 48 px top bar, the footer and a `<main>` that is
  a flex column. Do not add your own `<main>`; start the page with `<Page>`.
- `<Page width="narrow">` (760 px) for reading and forms (study flow), `wide` (1200 px) for home,
  galleries and the dashboard, `full` for edge-to-edge views that fill the screen height (game board,
  replay player).
- Routes under `/play` get a "fill" shell: exactly one screen tall, no footer, no page scroll, and
  `<main>` fills what is left under the bar (`100dvh - var(--bar-h)`). Make your page a flex column
  with `flex: 1; min-height: 0` (or use `<Page width="full">`) and size the board to it. To give
  another route the same treatment, add it to `fill` in the layout.
- Top-level links live in `nav.ts` (`NAV`, `FREE_PLAY_HREF`); change them there only.
- Every page sets `<svelte:head><title>Name · Circle Chase</title></svelte:head>`.
- UI text: plain words, sentence case, no em dashes.

## Components

| Component | Use | Example |
| --- | --- | --- |
| `Page` | Width and padding wrapper. `width`: `narrow` \| `wide` \| `full`. | `<Page width="wide">…</Page>` |
| `PageHeader` | Title, one-line `lead`, optional `eyebrow`, `actions` snippet, extra children. | `<PageHeader eyebrow="Results" title="Dashboard" lead="…">{#snippet actions()}…{/snippet}</PageHeader>` |
| `Panel` | Titled surface for a chart, table or form. `sub`, `actions` snippet, `flush` for edge-to-edge tables, `level` 2 or 3. | `<Panel title="Caught rate by cue" sub="Engaged trials, humans">…</Panel>` |
| `Button` | `variant`: `primary` (one per view) \| `quiet` \| `danger` \| `ghost`; `size`: `sm` \| `md` \| `lg`; `block`. Becomes a link with `href`. | `<Button variant="primary" href="/study">Take the study</Button>` |
| `Stat` | Big number with `label`, `value` (preformatted, null shows a dash), `unit`, `sub`, `interval`, `delta` + `deltaTone`, `info` (definition), `tone`, `size`. | `<Stat label="Caught rate" value="18" unit="%" interval="95% CI 9-31%" sub="of 42 engaged trials" info="…" />` |
| `Badge` | Small label. `tone`: `neutral` \| `accent` \| `good` \| `bad` \| `warn` \| `sim` \| `live`. Use `sim` on anything showing bot data. | `<Badge tone="sim">Simulated</Badge>` |
| `Segmented` | Bindable radio group styled as a switch. Options `{ value, label, hint? }`. | `<Segmented label="Data" options={[…]} bind:value={source} />` |
| `Tabs` | Bindable tabs with a `panel(id)` snippet; arrow keys, Home, End. | `<Tabs label="Source" tabs={[{ id: 'human', label: 'Humans' }]} bind:value>{#snippet panel(id)}…{/snippet}</Tabs>` |
| `Field` | Label + control + `hint` / `error`. Children snippet receives the input id. `inline` puts the label beside it. | `<Field label="Cue">{#snippet children(id)}<Select {id} … />{/snippet}</Field>` |
| `Select` | Styled native select, bindable. Options `{ value, label, group?, disabled? }`; `size` `sm` \| `md`. | `<Select options={opts} bind:value={cue} size="sm" />` |
| `InfoTip` | "i" button with a definition on hover, focus or tap; stays on screen at edges. `term`, `align`. | `<InfoTip term="Engaged">Was chasing in the last 3 s of the power.</InfoTip>` |
| `Dialog` | Modal on native `<dialog>`. Bindable `open`, `title`, `actions` snippet, `dismissable=false` for required questions, `width`. | `<Dialog bind:open title="Round done">…{#snippet actions()}…{/snippet}</Dialog>` |
| `Scale7` | 1-7 agreement row with end labels. Bindable `value` (null until answered). Arrow keys or number keys 1-7. | `<Scale7 question="I could tell when the power was about to run out." low="Not at all" high="Completely" bind:value={clarity} />` |
| `EmptyState` | Where content will appear. `title`, text children, `actions` snippet, `icon`: `maze` \| `chart` \| `replay` \| `study`, `compact`. | `<EmptyState title="No replays yet" icon="replay">…</EmptyState>` |
| `DataTable` | Sticky header, `numeric` columns right-aligned in mono, `info` and `unit` on headers, custom `cell(row, col)` snippet, `maxHeight`, `onrowclick`, `dense`. `caption` is required (hidden unless `showCaption`). | `<DataTable caption="Trials" rows={trials} key={(r) => r._id} columns={[{ key: 'left', label: 'Time left', unit: 's', numeric: true, format: (r) => r.left.toFixed(2) }]} />` |
| `CueChip` | Code + name of a condition, coloured by role (reference dashed grey, baseline blue, idea yellow). `href`, `compact` (code only), `size`, `wrap`. | `<CueChip cue={cueById(id)} href="/play/{id}" />` |
| `CuePreviewSlot` | Board-shaped box (19:21) for a live cue thumbnail. Placeholder today; pass the preview as children or replace its placeholder branch. | `<CuePreviewSlot {cue}><LivePreview {cue} /></CuePreviewSlot>` |
| `Kbd` | A keyboard key. | `<Kbd>P</Kbd> to pause` |
| `Mark` | The logo mark (countdown ring, chaser, scared dot). `size`, `tile`, `title`. | `<Mark size={32} />` |
| `HeroArt` | Home page illustration. Not exported from `index.ts`. | |

Helpers:

- `cueListings()` (from `cues.ts`): all thirteen conditions in order, including those whose cue file
  is not written yet (`ready: false`), with `code`, `name`, `role`, `tagline` and the `cue` itself
  when registered. Use it for any list that should always show thirteen.
- `ROLE_LABEL`: `{ reference: 'Reference', baseline: 'Baseline', idea: 'Idea' }`.
- `NAV`, `FREE_PLAY_HREF`, `isCurrent(item, pathname)` from `nav.ts`.

## Tokens (`src/app.css`)

Dark theme only. Every text colour passes WCAG AA on `--bg`, `--surface` and `--surface-2`.

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg` page, `--surface` panels and cards, `--surface-2` inputs and raised bits, `--surface-3` hover and popovers, `--rule` hairlines, `--rule-strong` input borders |
| Text | `--ink` main, `--ink-dim` secondary (leads, labels), `--ink-faint` captions only |
| Accent | `--accent` (the one main action, current page, key numbers), `--accent-soft`, `--on-accent` text on accent |
| Meaning | `--good`, `--bad`, `--warn` (+ `-soft` backgrounds), `--focus` focus rings, `--sim` simulated data |
| Game | `--player`, `--scared`, `--hunter`, `--ambusher`, `--guard`, `--drifter` (match `BASE_COLORS` in the renderer) |
| Cue roles | `--role-reference`, `--role-baseline`, `--role-idea` (use these for series colours in charts too) |
| Type | `--font-display` (Unbounded: wordmark, h1, h2 only), `--font-body` (Atkinson Hyperlegible Next), `--font-mono` (JetBrains Mono: numbers, codes); sizes `--text-xs` 12, `--text-sm` 14, `--text-md` 16, `--text-lg` 19, `--text-xl` 24, `--text-2xl` 32, `--text-3xl` fluid hero |
| Space | `--space-1` 4 … `--space-9` 96 (4, 8, 12, 16, 24, 32, 48, 64, 96), `--gutter` fluid page side padding |
| Radius | `--radius-sm` 6, `--radius-md` 10, `--radius-lg` 16, `--radius-pill` |
| Layout | `--bar-h` 48 px, `--page-narrow` 760 px, `--page-wide` 1200 px |
| Motion | `--dur` (0 under reduced motion), `--ease`; `--shadow-pop`, `--glow-accent` |

Global classes: `.num` / `.tabular` (mono, tabular figures, slashed zero: use for every number that
changes or lines up), `.eyebrow` (small caps label), `.visually-hidden`.

Fonts are self-hosted through `@fontsource-variable/*` and imported once in the layout, so the app
works offline.
