# Changelog

## 1.4.0 — 2026-09-05

- **Ebenen folgen der echten Kartenhöhe, nicht einer festen Zeile.** `computeLayout()` legte jede
  Ebene genau `ROW_HEIGHT` unter die vorige. Eine Karte, die durch ihren Inhalt höher wird als
  diese 200px (vier Variablen-Pills auf einem `send_email` reichen), ragte damit in die Ebene
  darunter, und der Plus-Knopf dazwischen verschwand halb hinter der nächsten Karte (Befund F19
  vom 03.09.2026).

  Neu: `computeLayout(nodes, edges, { nodeHeights })` nimmt die gemessenen Kartenhöhen je
  `node_key` und gibt jeder Ebene den Abstand, den ihre höchste Karte braucht; alle anderen Ebenen
  bleiben, wo sie waren. Ohne die Angabe rechnet es bitgleich wie vorher, drei Knoten ergeben
  weiter y = 0, 200, 400. Die Canvas misst die Karten selbst und reicht die Höhen durch.

- **Das Paket ist ein Statamic-Addon, kein anonymes `library`.** `composer.json` trägt jetzt
  `type: statamic-addon`, `extra.statamic` (Name, Beschreibung, Slug, URL, Entwickler) und einen
  Service-Provider. Der Provider ist absichtlich leer: er veröffentlicht nichts und registriert
  nichts, denn die Hosts kompilieren die Canvas in ihre eigenen Bundles. Er existiert, weil
  Statamic ein Paket nur dann auf der Addons-Seite listet, wenn `extra.statamic` **und** ein
  Provider da sind; ohne ihn fällt der Eintrag wortlos aus dem Manifest. `statamic/cms ^6.0` steht
  nun explizit in `require`, wo es vorher nur durch die Hosts impliziert war.

- **Eine Testsuite, auf zwei Ebenen.** PHPUnit über `Statamic\Testing\AddonTestCase` prüft, dass
  der Provider bootet, was das Manifest der Marketplace-Karte liefert, und dass jeder Pfad, den die
  Hosts aus `@goldnead/flow-canvas` importieren, noch existiert. Vitest läuft direkt gegen die
  Quelldateien in `resources/js/composables` (kein Build nötig): Auto-Layout, Undo/Redo mit
  Coalescing, Output-Spezifikationen, Validierung und Key-Value-Zeilen, 43 Tests. Jeder Test wurde
  einmal gegen eine absichtlich zerbrochene Funktion gehalten und ist dabei rot geworden. CI fährt
  PHP 8.2 bis 8.4 gegen Laravel 12 und 13, dazu den JS-Job, Pint und den addon-lint des Studios.

- **`onStaleOutputSpec(handler)`.** Trifft die Canvas auf eine Output-Spezifikation aus einer
  neueren Vertragsversion, fällt sie auf einen `default`-Ausgang zurück und meldet das einmal je
  Knotentyp. Bisher fest an `console.warn`; das bleibt der Standard, aber ein Host kann die Meldung
  nun umleiten (Toast, eigener Logger). Der Handler bekommt den Text und
  `{ type, version, supported }`.

- Ein leeres `dist/`, `config/` oder Vite-Setup gibt es weiterhin nicht, und das ist jetzt auch
  ein Test: die Hosts sind der Ort, an dem aus dieser Canvas ein Bundle wird.

## 1.3.0 — 2026-09-02

- **A node may carry a `thumbnail`.** A URL on the node, and the card draws it as a 16:10 tile the
  full width of the card, above the title. Where the picture comes from is the host's business —
  a funnel screenshots its pages; this package only knows how to show one.

  The tile has a fixed height (`LAYOUT.THUMB_HEIGHT`, 150px on a 240px card) and the image loads
  lazily inside it, so a card is the same size before and after the picture arrives. The layout
  grows every row by that height as soon as any node on the canvas has a picture, and only then:
  a graph without thumbnails is laid out exactly as before, and a graph with them does not
  overlap. The tile's ground is the card's ground in both modes, so a slow image is never a white
  block on a dark canvas.

- `showThumbnails` on `<Canvas>` (default `true`) lets a host switch the tiles off without
  stripping the field from its nodes.
- `computeLayout()` takes an optional `{ rowHeight }`.

## 1.2.1 — 2026-08-26

### Removed — die VERSION-Konstante log

Sie stand auf `1.0.0`, ausgeliefert war v1.2.0. Nichts liess sie mitwandern, wenn ein Tag wanderte —
eine Versionsnummer, die von Hand kopiert werden muss, driftet nicht aus Versehen, sondern von
selbst. Wer darauf eine Faehigkeitspruefung baute, bekam die falsche Antwort.

Entfernt statt nachgezogen: niemand in der Familie las sie (gegrept), und wofuer diese Klasse
existiert — „ist das Paket installiert" — beantwortet `class_exists()`, das nicht veralten kann.
Composer kennt die Version ohnehin, und dort stimmt sie.

## 1.2.0 — 2026-08-26

- **MIT, no longer proprietary.** A `LICENSE` file, which this package never had, and
  `"license": "MIT"` in the composer manifest.

  The reason is the dependency, not generosity. `statamic-funnels` **requires** this package, and
  both were listed as commercial — so buying Funnels left a second licence to sort out that nobody
  had decided the terms of. A shared editor that two of our own addons consume is infrastructure,
  and infrastructure that a customer has to buy twice is a bad seam. It also matches the rest of the
  foundation layer: Brand Context, Identity Contracts and Suppression are MIT for the same reason.

  Nothing about the code changes. Versions up to 1.1.0 were published under the old terms and stay
  that way; this applies from 1.2.0 on.

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
