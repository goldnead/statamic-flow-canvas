# Flow Canvas

The node-graph editor that `statamic-automations` and `statamic-funnels` share.

**It exists so there is one editor, not two that drift.** Every look-and-feel incident in this
addon family has traced back to a copy, so the pieces that are not about a particular domain live
here and both addons consume them.

## What is in here, and what is not

**In:** the canvas, the node card, the node library, the config panel, the control bar, the adder
node, the insertable edge, and the composables for auto-layout, history, autosave, validation and
key-value rows.

**Out:** what a node *means*. An automation node is an event and an action; a funnel node is a page
somebody walks onto. This package knows how to draw a graph and let someone rearrange it; the host
addon says what the boxes are.

## The seam: kinds are data

Nothing in here knows the word "trigger". A host passes a map of kinds:

```js
const KINDS = {
    trigger: { label: __('Trigger'), color: 'blue', unique: true, hasInput: false, replaceable: true },
    logic:   { label: __('Logic'),   color: 'amber' },
    action:  { label: __('Action'),  color: 'emerald' },
};
```

`unique` means at most one of these may exist, which is also why it cannot be duplicated.
`hasInput: false` means no incoming handle is drawn. `replaceable` offers "Replace" instead of
"Delete" — the way a flow with exactly one entry point has to be edited.

## Nodes, and the picture on one

A node is `{ node_key, type, label, config, disabled }`. One more field is optional:

```js
{ node_key: 'page_a1b2', type: 'page', label: 'Landing', config: {}, thumbnail: '/storage/…/page_a1b2.png' }
```

`thumbnail` is a URL. The card draws it as a 16:10 tile the full width of the card, above the
title. The tile has a fixed height and the image loads lazily inside it, so a card is the same size
before and after the picture arrives; the layout grows its rows by that height as soon as any node
on the canvas has one, and not before. Where the picture comes from is the host's business — a
funnel screenshots its pages, an automation may never have anything to show. Leave the field off and
the card looks exactly as it always has.

`<Canvas :show-thumbnails="false">` switches the tiles off without stripping the field.

## Requirements

- PHP 8.2 or newer
- Statamic 6 (`statamic/cms ^6.0`), on Laravel 12 or 13
- A host addon with its own Vite build using `@statamic/cms/vite-plugin`. This package has no
  build of its own: the host compiles it.
- In the host's `package.json`: `vue ^3.4`, `@vue-flow/core ^1.41`, `@vue-flow/background`,
  `@vue-flow/controls`, `@vue-flow/minimap`. They are peer dependencies here; the host owns them.

## Installation

```bash
composer require goldnead/statamic-flow-canvas
```

The service provider is discovered by Laravel and registers nothing: it exists so Statamic lists
the package on the Addons screen. The JavaScript is consumed the same way `@statamic/cms` is, from
the vendor directory:

```json
"dependencies": {
    "@goldnead/flow-canvas": "file:./vendor/goldnead/statamic-flow-canvas/resources/js"
}
```

Composer therefore has to run before npm, exactly as it already does for `@statamic/cms`.

npm links that path, so the package's files sit outside the host project and would resolve `vue`
from the wrong place. Two lines in the host's `vite.config.js` keep one Vue and one flow library on
the page:

```js
export default defineConfig({
    resolve: {
        preserveSymlinks: true,
        dedupe: ['vue', '@vue-flow/core', '@vue-flow/background', '@vue-flow/controls', '@vue-flow/minimap'],
    },
    plugins: [statamic(), tailwindcss(), laravel({ /* … */ })],
});
```

## Usage

Everything is exported from the barrel; deep imports work as well
(`@goldnead/flow-canvas/components/Canvas.vue`, `@goldnead/flow-canvas/composables/useHistory.js`).

```js
import { Canvas, NodeLibrary, setNodeOutputSpecs, useHistory } from '@goldnead/flow-canvas';
```

The page that owns the editor tells the canvas which handles each node type has, once, from the
node library the server rendered, and wires the undo stack to its own graph state:

```js
setNodeOutputSpecs(props.library);

const graph = ref({ nodes: [...], edges: [...] });

const history = useHistory({
    getState: () => ({ nodes: graph.value.nodes, edges: graph.value.edges }),
    setState: (state) => {
        graph.value.nodes = state.nodes;
        graph.value.edges = state.edges;
    },
});
// After each structural change: history.record(). While typing into one field:
// history.record(`label:${node.node_key}`), so a burst of keystrokes is one undo step.
```

```vue
<NodeLibrary :library="library" :kinds="KINDS" :node-icon="nodeIcon" @pick="addNode" />

<Canvas
    :kinds="KINDS"
    :node-icon="nodeIcon"
    :nodes="graph.nodes"
    :edges="graph.edges"
    :library="library"
    :selected-key="selectedKey"
    @select="selectedKey = $event"
    @remove-node="removeNode"
/>
```

The canvas draws nothing it was not told about: `kinds` (see above) says what the boxes are,
`node-icon` maps a type to an icon, and every label the host wants translated comes in as a prop
(`adder-labels`, `pick-labels`), because Statamic's `__()` does not know the host's language file
from inside a shared component.

The stylesheets ship with the package and go into the host's CP stylesheet, the theme first:

```css
@import "@goldnead/flow-canvas/canvas-theme.css";
@import "@goldnead/flow-canvas/canvas.css";
```

### When the published bundle is older than the server

A node whose output spec is newer than this canvas understands falls back to a single `default`
handle and reports it once per type, to the browser console by default. A host that wants it
somewhere else registers a handler:

```js
import { onStaleOutputSpec } from '@goldnead/flow-canvas';

onStaleOutputSpec((message, { type, version, supported }) => toast.error(message));
```

## Development

```bash
composer install && composer test     # PHPUnit: provider, package identity, the JS surface
npm ci && npx vitest run              # Vitest: auto-layout, history, node outputs, validation
vendor/bin/pint --test
```
