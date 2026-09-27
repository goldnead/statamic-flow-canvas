<template>
    <!-- The frame around a loop (see useScopeFrames.js): its owner card is the
         head, its body hangs below. A synthetic node, below every card and
         edge, never saved. Only the fold button takes the pointer; the rest
         lets panning and clicks through to the canvas and the cards on top. -->
    <div
        class="sa-scope-frame"
        :class="{ 'sa-scope-frame--collapsed': data.collapsed }"
        :style="{ width: `${data.width}px`, height: `${data.height}px` }"
        :data-scope-frame="data.id"
    >
        <div class="sa-scope-frame__bar">
            <!-- One control: chevron and step count together, core's ghost
                 button, the way a collapsible section toggles in the CP. -->
            <Button
                class="sa-scope-frame__toggle nodrag nopan"
                variant="ghost"
                size="xs"
                :icon="data.collapsed ? 'chevron-right' : 'chevron-down'"
                :text="data.labels.steps"
                :aria-expanded="!data.collapsed"
                :aria-label="data.labels.toggle"
                :title="data.labels.toggle"
                @click.stop="toggle"
            />
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
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 10 5 L 0 10 z" class="sa-scope-frame__arrow" />
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
import { Button } from '@statamic/cms/ui';

const props = defineProps({
    // { id, uid, x, y, width, height, collapsed, paths, labels: { steps, toggle } }
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
