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

        <template #edge-insertable="edgeProps">
            <InsertableEdge v-bind="edgeProps" />
        </template>

        <Background :pattern-color="dotColor" :gap="18" :size="1.4" />
        <Controls />
        <MiniMap v-if="realNodeCount" pannable zoomable />

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
import { computeLayout, LAYOUT, fractionForOutput } from '../composables/useAutoLayout.js';
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

const { fitView, onNodesInitialized } = useVueFlow(flowId);

const ADDER_HALF = 18; // half the "+" button, to centre it under the handle
const ADDER_DROP = 150; // vertical offset from the node top to its adder

const ADDER_PREFIX = '__adder__';
const STUB_PREFIX = '__stub__';

function isSynthetic(id) {
    return id.startsWith(ADDER_PREFIX) || id.startsWith(STUB_PREFIX);
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

function toVueFlowNode(n, position) {
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
        },
    };
}

function adderNode(open, srcPos, node) {
    const frac = fractionForOutput(node, open.from_output);
    return {
        id: `${ADDER_PREFIX}${open.from_node_key}__${open.from_output}`,
        type: 'adder',
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        position: {
            x: Math.round(srcPos.x + frac * LAYOUT.NODE_WIDTH - ADDER_HALF),
            y: srcPos.y + ADDER_DROP,
        },
        data: {
            fromNodeKey: open.from_node_key,
            output: open.from_output,
            mode: 'step',
            stepLabel: props.adderLabels.step,
        },
    };
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
        position: { x: -ADDER_HALF, y: 40 },
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

function toVueFlowEdge(e) {
    const out = e.from_output || 'default';
    const branch = out === 'true' || out === 'false';
    const accent = out === 'true'
        ? 'var(--sa-color-success)'
        : out === 'false' ? 'var(--sa-color-failed)' : null;

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
function stubEdge(open) {
    const out = open.from_output;
    const branch = out === 'true' || out === 'false';
    const accent = out === 'true'
        ? 'var(--sa-color-success)'
        : out === 'false' ? 'var(--sa-color-failed)' : null;
    // Non-branch, non-default outputs (switch cases, loop/parallel handles)
    // still get a label on their stub so an unconnected switch case reads
    // as e.g. "a", not a bare dashed line.
    const showLabel = branch || (out && out !== 'default' && open.label);

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

function rebuild() {
    const layout = computeLayout(props.nodes, props.edges);
    const nodeByKey = new Map(props.nodes.map((n) => [n.node_key, n]));

    const nodes = props.nodes.map((n) => toVueFlowNode(n, layout.positions[n.node_key]));
    if (!props.nodes.length) {
        nodes.push(rootAdder());
    } else {
        for (const open of layout.openOutputs) {
            const srcPos = layout.positions[open.from_node_key];
            if (srcPos) nodes.push(adderNode(open, srcPos, nodeByKey.get(open.from_node_key)));
        }
    }
    vfNodes.value = nodes;

    const edges = props.edges.map(toVueFlowEdge);
    if (props.nodes.length) {
        for (const open of layout.openOutputs) edges.push(stubEdge(open));
    }
    vfEdges.value = edges;
}

watch([() => props.nodes, () => props.edges], rebuild, { immediate: true, deep: true });

watch(
    () => props.selectedKey,
    (next) => {
        vfNodes.value = vfNodes.value.map((n) => ({ ...n, selected: n.id === next }));
    },
);

// Keep the whole flow framed after structural changes (add / insert / delete).
onNodesInitialized(() => {
    nextTick(() => fitView({ padding: 0.25, duration: 200, maxZoom: 1 }));
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
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';
</style>
