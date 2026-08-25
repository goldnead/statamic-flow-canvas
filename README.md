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
