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

## Install

It ships as a Composer package and its JavaScript is consumed the same way `@statamic/cms` is:

```json
"dependencies": {
    "@goldnead/flow-canvas": "file:./vendor/goldnead/statamic-flow-canvas/resources/js"
}
```

Composer therefore has to run before npm, exactly as it already does for `@statamic/cms`.

`@vue-flow/*` and `vue` are peer dependencies: the host owns them, so there is one copy of the
flow library and one Vue on the page.
