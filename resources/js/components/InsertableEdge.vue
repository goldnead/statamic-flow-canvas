<template>
    <!-- Custom edge for real connections. Draws the smoothstep path and hangs a
         "+" insert button at its midpoint (Zapier "insert between steps"). For
         branch outputs it also shows the token-coloured "If true"/"If false"
         pill near the split; a loop's outputs get the same kind of pill with
         their own names. A framed loop's continuation (`data.route`) runs
         round the frame instead, and its pill and "+" sit under the frame. -->
    <BaseEdge :id="id" :path="path" :style="style" />

    <EdgeLabelRenderer>
        <div
            v-if="pillText"
            class="sa-edge-branch nodrag nopan"
            :class="pillClass"
            :style="pillTransform"
        >
            {{ pillText }}
        </div>

        <div v-if="!data?.noInsert" class="sa-edge-insert nodrag nopan" :style="insertTransform">
            <button
                type="button"
                class="sa-edge-insert__btn"
                :class="{ 'sa-edge-insert__btn--pending': isPending }"
                :aria-label="__('Insert step')"
                :aria-pressed="isPending"
                @click="onClick"
            >
                <Icon name="plus" class="size-3" />
            </button>
        </div>
    </EdgeLabelRenderer>
</template>

<script setup>
import { computed, inject } from 'vue';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position } from '@vue-flow/core';
import { Icon } from '@statamic/cms/ui';
import { scopeDoneRoute } from '../composables/useScopeFrames.js';

const props = defineProps({
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    sourceX: { type: Number, required: true },
    sourceY: { type: Number, required: true },
    targetX: { type: Number, required: true },
    targetY: { type: Number, required: true },
    sourcePosition: { type: String, default: Position.Bottom },
    targetPosition: { type: String, default: Position.Top },
    sourceHandleId: { type: String, default: null },
    style: { type: Object, default: () => ({}) },
    data: { type: Object, default: () => ({}) },
});

const startPick = inject('saStartPick', () => {});
const pendingTarget = inject('saPendingTarget', computed(() => null));

const route = computed(() => {
    const rect = props.data?.route?.rect;
    if (!rect) return null;
    return scopeDoneRoute(rect, { x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY });
});

const pathData = computed(() =>
    getSmoothStepPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        sourcePosition: props.sourcePosition,
        targetX: props.targetX,
        targetY: props.targetY,
        targetPosition: props.targetPosition,
    }),
);

const path = computed(() => route.value?.path ?? pathData.value[0]);
const insertPoint = computed(() => route.value?.insert ?? { x: pathData.value[1], y: pathData.value[2] });
const insertTransform = computed(
    () => ({ transform: `translate(-50%, -50%) translate(${insertPoint.value.x}px, ${insertPoint.value.y}px)` }),
);

const pillText = computed(() => {
    if (props.data?.branch) return props.data.branch === 'true' ? __('If true') : __('If false');
    return props.data?.pill || null;
});

const pillClass = computed(() => {
    if (props.data?.branch) return props.data.branch === 'true' ? 'sa-edge-branch--true' : 'sa-edge-branch--false';
    return 'sa-edge-branch--scope';
});

// A pill sits just below the source handle so it reads as the split label;
// on a routed continuation, on its run under the frame.
const pillTransform = computed(() => {
    const at = route.value?.pill ?? { x: props.sourceX, y: props.sourceY + 20 };
    return { transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)` };
});

const edgeTarget = computed(() => ({
    kind: 'insert',
    edge: {
        from_node_key: props.source,
        from_output: props.sourceHandleId ?? 'default',
        to_node_key: props.target,
    },
}));

const isPending = computed(() => {
    const p = pendingTarget.value;
    if (!p || p.kind !== 'insert') return false;
    const a = p.edge;
    const b = edgeTarget.value.edge;
    return a.from_node_key === b.from_node_key && a.from_output === b.from_output && a.to_node_key === b.to_node_key;
});

function onClick() {
    startPick(edgeTarget.value);
}
</script>
