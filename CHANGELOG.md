# Changelog

## 1.1.0 — 2026-08-25

- **The stats strip on a node card belongs to the host.** It accepts a list of
  `{key, icon, value, label, tone}`, so the host decides what the figures mean and what they are
  called. An automation's "completed" and a funnel step's "continued" are not the same sentence, and
  neither belongs in this package. A value may be a ready-made string, so a percentage is not
  rounded into thousands.
- The legacy `{reached, completed, failed}` object still renders exactly as before.

## 1.0.4 — 2026-08-25

- No code change. `1.0.3` carried a hard-coded `version` field in its `composer.json`, which
  Packagist reads instead of the tag, so the tag never appeared.

## 1.0.3 — 2026-08-25

- **Vue Flow's own stylesheets go into the `base` layer.** Unlayered CSS outranks every layer, so
  `@vue-flow/minimap`'s fixed light background beat any themed rule a host wrote — and not only in
  the addon that built the bundle, because the Control Panel loads every addon's stylesheet on every
  page. The minimap stayed a white box in dark mode.
- The minimap's node rectangles and viewport mask follow CP tokens.

## 1.0.2 — 2026-08-25

- The canvas's own styling moved into the package (`canvas.css`, `canvas-theme.css`), so two hosts
  cannot drift apart.

## 1.0.1 — 2026-08-25

- `setNodeOutputSpecs` reads the whole library rather than one group.

## 1.0.0 — 2026-08-25

- Extracted from `goldnead/statamic-automations`: canvas, node cards, config panel, auto-layout,
  history, output-spec grammar.
