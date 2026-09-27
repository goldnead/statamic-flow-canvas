<template>
    <VueFlow
        :id="flowId"
        v-model:nodes="vfNodes"
        v-model:edges="vfEdges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :edges-updatable="false"
        :elements-selectable="true"
        :select-nodes-on-drag="false"
        :pan-on-drag="true"
        :pan-activation-key-code="'Space'"
        :selection-key-code="'Shift'"
        :delete-key-code="null"
        :min-zoom="0.3"
        :max-zoom="1.5"
        class="size-full"
        @node-click="onNodeClick"
    >
        <!-- One slot per declared kind. Written as a dynamic slot name rather
             than three fixed ones, because the kinds are the host's: an
             automation has triggers and actions, a funnel has pages and
             offers, and this file must not know either. -->
        <template v-for="(descriptor, kind) in kinds" :key="kind" #[`node-${kind}`]="slotProps">
            <NodeCard :kind="kind" v-bind="cardProps(slotProps)" v-on="cardHandlers(slotProps.id)" />
        </template>
        <template #node-adder="slotProps">
            <AdderNode :data="slotProps.data" />
        </template>
        <template #[`node-${SCOPE_FRAME_NODE}`]="slotProps">
            <ScopeFrame :data="slotProps.data" />
        </template>
        <template #[`node-${SCOPE_BLOCK_NODE}`]="slotProps">
            <ScopeBlock :data="slotProps.data" />
        </template>

        <template #edge-insertable="edgeProps">
            <InsertableEdge v-bind="edgeProps" />
        </template>

        <Background :pattern-color="dotColor" :gap="18" :size="1.4" />
        <Controls />
        <MiniMap v-if="realNodeCount" pannable zoomable :node-class-name="minimapNodeClass" />

        <Panel position="bottom-left">
            <ControlBar :flow-id="flowId" />
        </Panel>
    </VueFlow>
</template>

<script setup>
import { computed, nextTick, provide, ref, watch } from 'vue';
import { VueFlow, Panel, useVueFlow } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import NodeCard from './NodeCard.vue';
import ControlBar from './ControlBar.vue';
import AdderNode from './AdderNode.vue';
import InsertableEdge from './InsertableEdge.vue';
import ScopeFrame from './ScopeFrame.vue';
import ScopeBlock from './ScopeBlock.vue';
import { LAYOUT, fractionForOutput, openOutputsOf, outputsFor } from '../composables/useAutoLayout.js';
import {
    SCOPE_BLOCK_PREFIX,
    SCOPE_FRAME,
    SCOPE_FRAME_PREFIX,
    collapseScopes,
    computeScopeFrames,
    layoutScoped,
    scopeReturnPath,
    visibleScopeFrames,
} from '../composables/useScopeFrames.js';
import { NODE_ICON, NODE_KINDS, createNodeIcon } from '../composables/useNodeIcon.js';

const props = defineProps({
    nodes: { type: Array, required: true },
    edges: { type: Array, required: true },
    selectedKey: { type: String, default: null },
    validation: { type: Object, default: () => ({}) },
    /**
     * Node kinds, as data. `{ handle: { label, color, group, unique,
     * hasInput, replaceable } }` — see the package README. The order decides
     * nothing; `group` is what ties a kind to a library group.
     */
    kinds: { type: Object, required: true },
    /** Group name → node descriptors. Any shape, flattened where needed. */
    library: { type: Object, default: () => ({}) },
    /** `(handle, kind) => iconName`, built with `createNodeIcon()`. */
    nodeIcon: { type: Function, default: null },
    /**
     * Wording on the "+" buttons. `{ root, step }` — an automation starts with
     * a trigger and a funnel with an entry page, and neither word belongs in
     * this package.
     */
    adderLabels: { type: Object, default: () => ({}) },
    // The pending sidebar "pick mode" target (see Edit.vue). Null when no "+"
    // is currently armed; otherwise `{kind:'append', fromNodeKey, output}` or
    // `{kind:'insert', edge}`. Passed through so adders can render their own
    // active/pending state without prop-drilling through NodeCard/VueFlow slots.
    pendingTarget: { type: Object, default: null },
    // node_key → `{ reached, completed, failed }`, for the window the activity
    // view is set to. Travels the same way `validation` does: a map keyed by
    // node_key, resolved per card in cardProps(). A node missing from the map
    // has had nothing run through it and its card shows no numbers.
    nodeStats: { type: Object, default: () => ({}) },
    /**
     * Whether a node's `thumbnail` (a URL the host puts on the node) is drawn
     * as a 16:10 tile above the card's title. Off, the cards look exactly as
     * they do for a host that never sets one. Nothing here knows where the
     * picture came from; a funnel screenshots its pages, an automation may
     * never have anything to show.
     */
    showThumbnails: { type: Boolean, default: true },
    /**
     * Node types whose one output opens a body instead of continuing the
     * flow, as data: `{ loop: { output: 'loop', continuation: 'done' } }`.
     * Each body is drawn inside a frame titled with the owner's name, with a
     * dashed line from its ends back to the owner, and can be folded into one
     * card. Purely a drawing: nothing here is saved or sent anywhere. Empty,
     * the canvas looks exactly as it did before 1.6.0.
     */
    scopes: { type: Object, default: () => ({}) },
    /**
     * Wording for the frames, from the host:
     * `{ steps: (n) => string, collapse: (title) => string, expand: (title) => string }`.
     */
    scopeLabels: { type: Object, default: () => ({}) },
    /**
     * Where this canvas remembers which bodies are folded, as a localStorage
     * key — per viewer and per browser, which is what a view preference is.
     * Null keeps the folds for as long as the page is open.
     */
    viewStateKey: { type: String, default: null },
});

const emit = defineEmits([
    'select',
    'toggle-pick',
    'remove-node',
    'rename-node',
    'duplicate-node',
    'toggle-node-disabled',
    'replace-unique',
]);

// The adder components (append nodes + insertable edges) are rendered deep
// inside Vue Flow's slot templates. Provide the pending-pick state and a
// callback to arm/disarm it so they can reach back up to the page without
// prop drilling. Clicking a "+" no longer opens a dropdown — it just tells
// Edit.vue "pick mode is now targeting this spot"; the actual node choice
// happens in the left NodeLibrary sidebar (see fix-picker-sidebar-brief.md).
// The cards are rendered through VueFlow's slots, so props cannot reach them
// without threading them through machinery this package does not own.
provide(NODE_KINDS, props.kinds);
provide(NODE_ICON, props.nodeIcon ?? createNodeIcon());

provide('saPendingTarget', computed(() => props.pendingTarget));
provide('saStartPick', (target) => emit('toggle-pick', target));
provide('saToggleScope', (id) => toggleScope(id));

// The two synthetic node types the scope frames are drawn with. Prefixed so
// they can never collide with a kind the host declares.
const SCOPE_FRAME_NODE = 'sa-scope-frame';
const SCOPE_BLOCK_NODE = 'sa-scope-block';

/** Which bodies are folded, by owner node_key. Expanded unless remembered. */
const collapsedScopes = ref(readCollapsed());

function readCollapsed() {
    if (!props.viewStateKey) return [];
    try {
        const raw = window.localStorage?.getItem(props.viewStateKey);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
    } catch {
        // Private windows, blocked storage, a value somebody else wrote: a
        // fold is a convenience, so every one of those simply means "open".
        return [];
    }
}

function writeCollapsed(list) {
    if (!props.viewStateKey) return;
    try {
        if (list.length) window.localStorage?.setItem(props.viewStateKey, JSON.stringify(list));
        else window.localStorage?.removeItem(props.viewStateKey);
    } catch {
        // See readCollapsed(): not being able to remember a fold is not an error.
    }
}

// A new graph gets its key once it has been saved; the folds made before
// then carry over instead of springing open.
watch(
    () => props.viewStateKey,
    (next, previous) => {
        if (!next) return;
        if (!previous && collapsedScopes.value.length) writeCollapsed(collapsedScopes.value);
        else collapsedScopes.value = readCollapsed();
    },
);

function toggleScope(id) {
    const next = collapsedScopes.value.includes(id)
        ? collapsedScopes.value.filter((k) => k !== id)
        : [...collapsedScopes.value, id];
    collapsedScopes.value = next;
    writeCollapsed(next);
}

// A frame is as large as its whole body; drawn as a filled node on the
// minimap it would cover every card inside it.
function minimapNodeClass(node) {
    return node?.type === SCOPE_FRAME_NODE ? 'sa-minimap-scope' : '';
}

function scopeLabel(name, arg) {
    const custom = props.scopeLabels?.[name];
    if (typeof custom === 'function') return custom(arg);
    if (name === 'steps') return __n(':count step|:count steps', arg);
    if (name === 'collapse') return __('Collapse :title', { title: arg });
    return __('Expand :title', { title: arg });
}

// Vue Flow paints the pattern via an SVG presentation attribute (`fill` on the
// dot variant, `stroke` on the lines variant), and an attribute cannot resolve a
// CSS `var()`. `currentColor` can: it is resolved by inheritance, so cp.css sets
// `color` on `.vue-flow__background` and the pattern follows the theme in both
// modes. This replaces a hard-coded light-grey literal that was rescued only by
// a `.vue-flow__background circle` override — which would have silently reverted
// to a light grid on a dark canvas the moment Vue Flow rendered anything but a
// <circle>, or renamed the class.
const dotColor = 'currentColor';

function cardProps(slotProps) {
    return {
        data: slotProps.data,
        selected: slotProps.selected,
        status: statusFor(slotProps.id),
        stats: props.nodeStats[slotProps.id] ?? null,
    };
}

function cardHandlers(id) {
    return {
        rename: () => emit('rename-node', id),
        duplicate: () => emit('duplicate-node', id),
        'toggle-disabled': () => emit('toggle-node-disabled', id),
        delete: () => emit('remove-node', id),
        'replace-unique': () => emit('replace-unique', id),
    };
}

// Scope this Vue Flow instance to a unique id so each builder session isolates
// its store and disposes cleanly on CP navigation.
const flowId = `sa-flow-${Math.random().toString(36).slice(2, 10)}`;

const vfNodes = ref([]);
const vfEdges = ref([]);
const realNodeCount = computed(() => props.nodes.length);

const { fitView, onNodesInitialized, onNodesChange } = useVueFlow(flowId);

/**
 * Die tatsaechlich gerenderten Kartenhoehen, `node_key` -> Pixel.
 *
 * Das Layout rechnete die Ebenen mit einer festen Zeilenhoehe aus. Eine Karte,
 * die durch ihren Inhalt hoeher wird — vier Variablen-Pills auf einem
 * `send_email` reichen —, ragte damit in die Ebene darunter, und der „+"-Knopf
 * dazwischen verschwand halb hinter der naechsten Karte (Adrians Befund F19
 * vom 03.09.2026). Gemessen wird deshalb erst gerendert, dann neu gelegt.
 */
const measuredHeights = ref({});

/**
 * Uebernimmt die gemessenen Hoehen, aber nur wenn sich wirklich etwas geaendert
 * hat: das Neulegen aendert nur y-Positionen, nie Hoehen, also kommt die
 * Schleife nach einem Durchlauf zur Ruhe. Ohne diesen Vergleich liefe sie
 * endlos, weil jede Zuweisung `rebuild()` erneut ausloest.
 */
function applyMeasuredHeights(graphNodes) {
    const next = { ...measuredHeights.value };
    let changed = false;

    for (const node of graphNodes ?? []) {
        // A folded body's block is laid out like a card, so it is measured
        // like one; adders, stubs and frames are not.
        if (!node?.id || (isSynthetic(node.id) && !node.id.startsWith(SCOPE_BLOCK_PREFIX))) continue;
        const height = Math.round(node.dimensions?.height ?? 0);
        if (!height) continue;
        if (next[node.id] !== height) {
            next[node.id] = height;
            changed = true;
        }
    }

    // Karten, die es nicht mehr gibt, nicht ewig mitschleppen.
    for (const key of Object.keys(next)) {
        if (!key.startsWith(SCOPE_BLOCK_PREFIX) && !props.nodes.some((n) => n.node_key === key)) {
            delete next[key];
            changed = true;
        }
    }

    if (changed) measuredHeights.value = next;
}

// Half the "+" button, to centre it under the handle. A step's "+" is the same
// 24px circle as the insert "+" on an edge, so every "+" on a canvas is one
// size; only the empty canvas's entry "+" is larger.
const ADDER_HALF = 12;
const ROOT_ADDER_HALF = 18;
const ADDER_DROP = 150; // vertical offset from the node top to its adder
// Abstand zwischen der Unterkante einer gemessenen Karte und ihrem „+".
// Entspricht dem, was ADDER_DROP bei einer Karte in Normalhoehe uebrig liess.
const ADDER_GAP = ADDER_DROP - LAYOUT.NODE_HEIGHT;

/**
 * Whether any card on this canvas carries a picture. Decided once for the whole
 * graph rather than per card, because the rows are a grid: one taller card in a
 * row of short ones would still need the whole row to be taller, and a graph
 * whose rows change height as pictures arrive would jump under the cursor.
 */
const thumbnailsShown = computed(() => props.showThumbnails && props.nodes.some((n) => !!n.thumbnail));

/** How much taller every row and every adder drop is while pictures are shown. */
const thumbExtra = computed(() => (thumbnailsShown.value ? LAYOUT.THUMB_HEIGHT : 0));

const ADDER_PREFIX = '__adder__';
const STUB_PREFIX = '__stub__';

function isSynthetic(id) {
    return id.startsWith(ADDER_PREFIX)
        || id.startsWith(STUB_PREFIX)
        || id.startsWith(SCOPE_FRAME_PREFIX)
        || id.startsWith(SCOPE_BLOCK_PREFIX);
}

/**
 * Which kind a node type belongs to, worked out from the library group it was
 * offered in. A kind declares its group; anything unrecognised falls back to
 * the last declared kind, which is the "ordinary step" in both hosts.
 */
function nodeKind(type) {
    for (const [kind, descriptor] of Object.entries(props.kinds)) {
        const group = descriptor.group ?? kind;
        if ((props.library[group] ?? []).some((m) => m.handle === type)) return kind;
    }

    return fallbackKind.value;
}

const fallbackKind = computed(() => {
    const entries = Object.entries(props.kinds);
    const ordinary = entries.find(([, d]) => d.fallback === true);

    return (ordinary ?? entries[entries.length - 1] ?? ['step'])[0];
});

function labelFor(handle) {
    return Object.values(props.library ?? {})
        .flat()
        .find((m) => m.handle === handle)?.label ?? handle;
}

function toVueFlowNode(n, position, extra = {}) {
    return {
        id: n.node_key,
        type: nodeKind(n.type),
        position: position ?? { x: 0, y: 0 },
        draggable: false,
        selected: n.node_key === props.selectedKey,
        data: {
            label: n.label || labelFor(n.type),
            type: n.type,
            config: n.config ?? {},
            disabled: n.disabled ?? false,
            // A URL or nothing. Dropped entirely, not passed as an empty
            // string, when the host switched pictures off, so the card has no
            // way of drawing a tile it was told not to.
            thumbnail: props.showThumbnails && n.thumbnail ? String(n.thumbnail) : null,
            // A framed loop's continuation leaves from the card's side
            // (`sideOutputs`), and a loop names its outputs on its edges, not
            // in the footer (`hideLegend`). Both only ever set for scopes.
            ...extra,
        },
    };
}

function adderNode(open, srcPos, node, place = null) {
    const frac = fractionForOutput(node, open.from_output);
    const hint = scopeOutputLabel(open);
    return {
        id: `${ADDER_PREFIX}${open.from_node_key}__${open.from_output}`,
        type: 'adder',
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        // A framed loop's open continuation hangs under the frame (`place`).
        position: place ?? {
            x: Math.round(srcPos.x + frac * LAYOUT.NODE_WIDTH - ADDER_HALF),
            // Per node, not per graph: the row grew for everybody, but only a
            // card that actually shows a picture is taller, and its "+" has to
            // hang below its own bottom edge.
            //
            // Dasselbe gilt fuer eine Karte, die durch ihren Inhalt hoch wird:
            // liegt eine gemessene Hoehe vor, haengt der „+" unter DIESER Karte
            // statt unter der angenommenen Normalhoehe. Ohne Messung bleibt es
            // beim bisherigen festen Abstand.
            y: measuredHeights.value[open.from_node_key]
                ? srcPos.y + measuredHeights.value[open.from_node_key] + ADDER_GAP
                : srcPos.y + ADDER_DROP + (props.showThumbnails && node?.thumbnail ? LAYOUT.THUMB_HEIGHT : 0),
        },
        data: {
            fromNodeKey: open.from_node_key,
            output: open.from_output,
            mode: 'step',
            stepLabel: props.adderLabels.step,
            // A scope's two outputs are named beside their "+", not on the
            // stub: the stub is ten pixels long, and its label sat on the
            // owner's own bottom edge. The body output's to the left, the
            // continuation's to the right, so two of them side by side never
            // cover each other.
            hint,
            hintSide: hint && open.from_output === scopeOf(open.from_node_key)?.output ? 'left' : 'right',
        },
    };
}

/** The scope a node owns (`{ output, continuation }`), or null. */
function scopeOf(key) {
    const owner = props.nodes.find((n) => n.node_key === key);
    return owner ? props.scopes?.[owner.type] ?? null : null;
}

/** What one of a node's outputs is called, from its own declaration. */
function outputLabel(key, handle) {
    const owner = props.nodes.find((n) => n.node_key === key);
    return owner ? outputsFor(owner).find((o) => o.handle === handle)?.label || null : null;
}

/** The label of an open scope output (a Loop's `loop` / `done`), else null. */
function scopeOutputLabel(open) {
    const scope = scopeOf(open.from_node_key);
    if (!scope || !open.label) return null;
    return open.from_output === scope.output || open.from_output === scope.continuation ? open.label : null;
}

function rootAdder() {
    return {
        id: `${ADDER_PREFIX}root`,
        type: 'adder',
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        position: { x: -ROOT_ADDER_HALF, y: 40 },
        // `mode` tells the adder whether it is offering an entry point or an
        // ordinary step; the wording comes from the host.
        data: {
            fromNodeKey: null,
            output: 'default',
            mode: 'entry',
            rootLabel: props.adderLabels.root,
            stepLabel: props.adderLabels.step,
        },
    };
}

function toVueFlowEdge(e, framedRect = null) {
    const out = e.from_output || 'default';
    const branch = out === 'true' || out === 'false';
    const accent = out === 'true'
        ? 'var(--sa-color-success)'
        : out === 'false' ? 'var(--sa-color-failed)' : null;

    // A scope's outputs carry their name as a pill, the way a branch's do.
    // The continuation of a framed loop takes its own route, round the frame.
    const scope = scopeOf(e.from_node_key);
    if (scope && (out === scope.output || out === scope.continuation)) {
        const route = out === scope.continuation && framedRect ? { rect: framedRect } : null;
        return {
            id: `${e.from_node_key}__${out}__${e.to_node_key}`,
            source: e.from_node_key,
            target: e.to_node_key,
            sourceHandle: out,
            type: 'insertable',
            data: { pill: outputLabel(e.from_node_key, out), route },
        };
    }

    return {
        id: `${e.from_node_key}__${out}__${e.to_node_key}`,
        source: e.from_node_key,
        target: e.to_node_key,
        // NodeCard renders one explicitly-`id`'d Handle per output (even the
        // lone "default" case), so the edge's sourceHandle must always name
        // it — Vue Flow can't resolve a `null` handle id against a real one.
        sourceHandle: out,
        type: 'insertable',
        data: { branch: branch ? out : null },
        style: accent ? { stroke: accent } : undefined,
    };
}

// A short dashed stub from an open output down to its "+" adder.
function stubEdge(open, framedRect = null) {
    const out = open.from_output;
    const scope = scopeOf(open.from_node_key);
    if (scope && out === scope.continuation && framedRect) {
        // Round the frame, like the connected continuation; its name is
        // beside the "+" it leads to.
        return {
            id: `${STUB_PREFIX}${open.from_node_key}__${out}`,
            source: open.from_node_key,
            sourceHandle: out,
            target: `${ADDER_PREFIX}${open.from_node_key}__${out}`,
            type: 'insertable',
            selectable: false,
            deletable: false,
            focusable: false,
            style: { strokeDasharray: '4 4' },
            data: { route: { rect: framedRect }, noInsert: true },
        };
    }
    const branch = out === 'true' || out === 'false';
    const accent = out === 'true'
        ? 'var(--sa-color-success)'
        : out === 'false' ? 'var(--sa-color-failed)' : null;
    // Non-branch, non-default outputs (switch cases, loop/parallel handles)
    // still get a label on their stub so an unconnected switch case reads
    // as e.g. "a", not a bare dashed line.
    // A scope output is named beside its "+" instead (see adderNode()).
    const showLabel = branch || (out && out !== 'default' && open.label && !scopeOutputLabel(open));

    return {
        id: `${STUB_PREFIX}${open.from_node_key}__${out}`,
        source: open.from_node_key,
        sourceHandle: out,
        target: `${ADDER_PREFIX}${open.from_node_key}__${out}`,
        type: 'smoothstep',
        selectable: false,
        deletable: false,
        focusable: false,
        style: { stroke: accent ?? 'var(--color-gray-300, #d1d5db)', strokeDasharray: '4 4' },
        label: branch ? (out === 'true' ? __('If true') : __('If false')) : (showLabel ? open.label : ''),
        labelBgBorderRadius: 8,
        labelBgPadding: showLabel ? [7, 4] : undefined,
        labelStyle: showLabel ? { fill: accent ?? 'var(--color-gray-500, #6b7280)', fontSize: 11, fontWeight: 600 } : undefined,
        labelBgStyle: showLabel
            ? { fill: 'var(--sa-edge-label-bg)', stroke: accent ?? 'var(--color-gray-300, #d1d5db)', strokeWidth: 1 }
            : undefined,
    };
}

/** The edge from an owner to its folded body, or rerouted onto the fold. */
function scopeEdge(e) {
    const out = e.from_output || 'default';
    return {
        id: `${e.from_node_key}__${out}__${e.to_node_key}`,
        source: e.from_node_key,
        target: e.to_node_key,
        sourceHandle: out,
        type: 'insertable',
        selectable: false,
        deletable: false,
        focusable: false,
        // Nothing can be inserted into a folded body from outside it.
        data: { pill: scopeOf(e.from_node_key) ? outputLabel(e.from_node_key, out) : null, noInsert: true },
    };
}

/** How tall a card is drawn: measured once rendered, assumed before. */
function cardHeight(key, node) {
    const measured = measuredHeights.value[key];
    if (measured) return measured;
    return LAYOUT.NODE_HEIGHT + (props.showThumbnails && node?.thumbnail ? LAYOUT.THUMB_HEIGHT : 0);
}

function rebuild() {
    // Scope bodies first: which exist, which are folded, and what the graph
    // looks like with the folded ones drawn as a single card.
    const frames = computeScopeFrames(props.nodes, props.edges, props.scopes);
    const frameIds = new Set(frames.map((f) => f.id));
    const collapsed = collapsedScopes.value.filter((id) => frameIds.has(id));
    const view = collapseScopes(props.nodes, props.edges, frames, collapsed);
    const shown = visibleScopeFrames(frames, view, collapsed);

    const nodeByKey = new Map(props.nodes.map((n) => [n.node_key, n]));
    const blockByKey = new Map(view.blocks.map((b) => [b.id, b]));
    const openOutputs = openOutputsOf(view.nodes, view.edges).filter((o) => !blockByKey.has(o.from_node_key));

    const layout = layoutScoped(view.nodes, view.edges, shown, {
        rowHeight: LAYOUT.ROW_HEIGHT + thumbExtra.value,
        nodeHeights: measuredHeights.value,
        openKeys: new Set(openOutputs.map((o) => o.from_node_key)),
        outputCount: (key) => (nodeByKey.has(key) ? outputsFor(nodeByKey.get(key)).length : 1),
    });

    // owner key → the rectangle of its frame, for every frame drawn.
    const framedRect = new Map(shown.filter((f) => layout.rects[f.id]).map((f) => [f.owner, layout.rects[f.id]]));

    const nodes = [];
    const cards = [];
    for (const n of view.nodes) {
        const position = layout.positions[n.node_key];
        const block = blockByKey.get(n.node_key);
        if (block) {
            cards.push(scopeBlockNode(block, position));
            continue;
        }
        const scope = props.scopes?.[n.type];
        const extra = !scope
            ? {}
            : framedRect.has(n.node_key)
                ? { hideLegend: true, sideOutputs: scope.continuation ? [scope.continuation] : [] }
                : { hideLegend: true };
        cards.push(toVueFlowNode(n, position, extra));
    }

    const adders = [];
    if (!props.nodes.length) {
        adders.push(rootAdder());
    } else {
        for (const o of openOutputs) {
            const srcPos = layout.positions[o.from_node_key];
            if (!srcPos) continue;
            const rect = framedRect.get(o.from_node_key);
            const place = rect && o.from_output === scopeOf(o.from_node_key)?.continuation
                ? { x: srcPos.x + LAYOUT.NODE_WIDTH / 2 - ADDER_HALF, y: rect.y + rect.height + SCOPE_FRAME.DONE_ADDER }
                : null;
            adders.push(adderNode(o, srcPos, nodeByKey.get(o.from_node_key), place));
        }
    }

    // The box a way back leaves from: a card, or — for a loop nested at the
    // end of a body — that loop's whole frame, left near its bottom.
    const boxOf = (key) => {
        const rect = framedRect.get(key);
        if (rect) return { ...rect, anchorY: rect.y + rect.height - 28 };
        const p = layout.positions[key];
        return p ? { x: p.x, y: p.y, width: LAYOUT.NODE_WIDTH, height: cardHeight(key, nodeByKey.get(key)) } : null;
    };

    // Frames go first and lowest, so every card and edge is drawn over them.
    for (const f of shown) {
        const rect = layout.rects[f.id];
        const p = layout.positions[f.owner];
        if (!rect || !p) continue;
        const owner = { x: p.x, y: p.y, width: LAYOUT.NODE_WIDTH, height: cardHeight(f.owner, nodeByKey.get(f.owner)) };
        const paths = f.terminals
            .map((key) => boxOf(key))
            .filter(Boolean)
            .map((box) => scopeReturnPath(rect, owner, box));
        nodes.push(scopeFrameNode(f, rect, paths));
    }

    nodes.push(...cards, ...adders);
    vfNodes.value = nodes;

    const edges = view.edges.map((e) => (e.synthetic ? scopeEdge(e) : toVueFlowEdge(e, framedRect.get(e.from_node_key) ?? null)));
    if (props.nodes.length) {
        for (const o of openOutputs) edges.push(stubEdge(o, framedRect.get(o.from_node_key) ?? null));
    }
    vfEdges.value = edges;
}

function ownerTitle(key) {
    const owner = props.nodes.find((n) => n.node_key === key);
    return owner ? (owner.label || labelFor(owner.type)) : key;
}

function scopeFrameNode(frame, rect, paths) {
    const title = ownerTitle(frame.owner);
    const collapsed = !!frame.collapsed;
    return {
        id: `${SCOPE_FRAME_PREFIX}${frame.id}`,
        type: SCOPE_FRAME_NODE,
        position: { x: rect.x, y: rect.y },
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        // Below the cards (0) and the edges (0); an inner frame above its outer one.
        zIndex: -10 + frame.depth,
        style: { pointerEvents: 'none' },
        class: 'sa-scope-frame-node',
        data: {
            id: frame.id,
            uid: `${flowId}-${frame.id}`,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            collapsed,
            paths,
            labels: {
                // The owner card is the frame's head, so the frame has no
                // title of its own; the count and the fold button remain.
                steps: scopeLabel('steps', frame.count ?? frame.members.length),
                toggle: scopeLabel(collapsed ? 'expand' : 'collapse', title),
            },
        },
    };
}

function scopeBlockNode(block, position) {
    const owner = props.nodes.find((n) => n.node_key === block.frame.owner);
    const title = scopeLabel('steps', block.frame.members.length);
    const first = block.frame.entries[0];
    const last = block.frame.terminals[block.frame.terminals.length - 1];
    const nameOf = (key) => {
        const n = props.nodes.find((m) => m.node_key === key);
        return n ? (n.label || labelFor(n.type)) : null;
    };
    // What is folded away, as its first and last step.
    const summary = [nameOf(first), last && last !== first ? nameOf(last) : null].filter(Boolean).join(' → ');
    return {
        id: block.id,
        type: SCOPE_BLOCK_NODE,
        position: position ?? { x: 0, y: 0 },
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        data: {
            id: block.id,
            frameId: block.frame.id,
            title,
            summary,
            kind: owner ? nodeKind(owner.type) : fallbackKind.value,
            ownerType: owner?.type ?? null,
        },
    };
}

// `measuredHeights` gehoert mit in die Liste: die erste Runde legt die Karten
// mit Annahmen aus, die zweite mit dem, was der Browser wirklich gerendert hat.
watch(
    [() => props.nodes, () => props.edges, () => props.showThumbnails, measuredHeights, () => props.scopes, collapsedScopes],
    rebuild,
    { immediate: true, deep: true },
);

watch(
    () => props.selectedKey,
    (next) => {
        vfNodes.value = vfNodes.value.map((n) => ({ ...n, selected: n.id === next }));
    },
);

// Keep the whole flow framed after structural changes (add / insert / delete).
onNodesInitialized((graphNodes) => {
    applyMeasuredHeights(graphNodes);
    nextTick(() => fitView({ padding: 0.25, duration: 200, maxZoom: 1 }));
});

// Eine Karte kann auch ohne Strukturaenderung wachsen — es reicht, im
// Eigenschaften-Panel eine Variable zu ergaenzen. vue-flow meldet das als
// Groessenaenderung; ohne diesen Haken bliebe die Ebene darunter auf dem
// Abstand von vorher stehen und die Karten ueberlappten wieder.
onNodesChange((changes) => {
    const resized = (changes ?? []).filter((change) => change.type === 'dimensions' && change.dimensions);
    if (!resized.length) return;
    applyMeasuredHeights(resized.map((change) => ({ id: change.id, dimensions: change.dimensions })));
});

function statusFor(id) {
    return props.validation[id] || null;
}

function onNodeClick({ node }) {
    if (isSynthetic(node.id)) return;
    emit('select', node.id);
}
</script>

<style>
/* Vue Flow's own stylesheets go into Tailwind's `base` layer, deliberately.
 *
 * Unlayered CSS outranks every layer, so importing these plainly means
 * `@vue-flow/minimap`'s `background-color: #fff` beats any themed rule the
 * host writes in `addon-utilities` — the minimap stays a white box in dark
 * mode, and not only in the addon that happens to build this file: one built
 * bundle is enough, because the Control Panel loads every addon's stylesheet
 * on every page.
 *
 * `base` is the right layer rather than a new one of our own: Statamic orders
 * it first, so vendor layout defaults behave like a reset and anything the
 * host themes on top of them wins.
 */
@import '@vue-flow/core/dist/style.css' layer(base);
@import '@vue-flow/core/dist/theme-default.css' layer(base);
@import '@vue-flow/controls/dist/style.css' layer(base);
@import '@vue-flow/minimap/dist/style.css' layer(base);
</style>
