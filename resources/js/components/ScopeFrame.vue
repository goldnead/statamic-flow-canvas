<template>
    <!-- The frame behind a loop body (see useScopeFrames.js). A synthetic
         node, below every card and edge, never saved. Only the fold button
         takes the pointer; the rest lets panning and clicks through to the
         canvas and the cards on top of it. -->
    <div
        class="sa-scope-frame"
        :style="{ width: `${data.width}px`, height: `${data.height}px` }"
        :data-scope-frame="data.id"
    >
        <div class="sa-scope-frame__bar">
            <button
                type="button"
                class="sa-scope-frame__toggle nodrag nopan"
                :aria-expanded="true"
                :aria-label="data.labels.collapse"
                :title="data.labels.collapse"
                @click.stop="toggle"
            >
                <Icon name="chevron-down" class="sa-scope-frame__chevron" />
            </button>
            <span class="sa-scope-frame__title">{{ data.title }}</span>
            <span class="sa-scope-frame__count">{{ data.labels.steps }}</span>
        </div>

        <!-- The way back from each end of the body to the loop, drawn in flow
             coordinates and shifted into this node's own box. -->
        <svg
            v-if="data.paths.length"
            class="sa-scope-frame__return"
            :width="data.width"
            :height="data.height"
            aria-hidden="true"
        >
            <defs>
                <marker
                    :id="markerId"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 1 L 9 5 L 0 9 z" class="sa-scope-frame__arrow" />
                </marker>
            </defs>
            <g :transform="`translate(${-data.x} ${-data.y})`">
                <path
                    v-for="(d, i) in data.paths"
                    :key="i"
                    :d="d"
                    class="sa-scope-frame__return-path"
                    :marker-end="`url(#${markerId})`"
                />
            </g>
        </svg>
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { Icon } from '@statamic/cms/ui';

const props = defineProps({
    // { id, x, y, width, height, title, paths, labels: { steps, collapse } }
    data: { type: Object, required: true },
});

const toggleScope = inject('saToggleScope', () => {});

// One marker per frame: SVG ids are document-wide, and two canvases (or two
// frames) sharing one would each point at whichever was defined first.
const markerId = computed(() => `sa-scope-arrow-${String(props.data.uid ?? props.data.id).replace(/[^\w-]/g, '_')}`);

function toggle() {
    toggleScope(props.data.id);
}
</script>
