<template>
    <div class="sa-control-bar">
        <Button
            variant="ghost"
            size="sm"
            inset
            icon-only
            :aria-label="__('Zoom out')"
            @click="zoomOut({ duration: 200 })"
        >
            <!-- The `fc-` classes below are plain CSS in the <style> block, not
                 Tailwind utilities (see NodeLibrary.vue). -->
            <span class="fc-zoom-out-glyph">&minus;</span>
        </Button>

        <span class="sa-control-bar__zoom">{{ zoomPercent }}%</span>

        <Button
            variant="ghost"
            size="sm"
            inset
            icon="plus"
            :aria-label="__('Zoom in')"
            @click="zoomIn({ duration: 200 })"
        />

        <span class="fc-control-divider" />

        <Button
            variant="ghost"
            size="sm"
            inset
            icon="fit-screen"
            :aria-label="__('Fit to view')"
            @click="fitView({ duration: 300, padding: 0.25, maxZoom: 1 })"
        />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useVueFlow } from '@vue-flow/core';
import { Button } from '@statamic/cms/ui';

const props = defineProps({
    flowId: { type: String, required: true },
});

// Nodes are never draggable in the fixed-layout model, so there is no lock
// toggle — only zoom + fit controls remain.
const { zoomIn, zoomOut, fitView, viewport } = useVueFlow(props.flowId);

const zoomPercent = computed(() => Math.round((viewport.value?.zoom ?? 1) * 100));
</script>

<style scoped>
/* Tailwind utilities before, same values. Dark colour from the old `dark:` variant. */
.fc-zoom-out-glyph {
    font-size: 1rem;
    line-height: 1;
    padding-inline: 0.25rem;
}
.fc-control-divider {
    width: 1px;
    height: 1rem;
    margin-inline: 0.125rem;
    background: var(--color-gray-200);
}
:global(.dark) .fc-control-divider {
    background: var(--color-gray-700);
}
</style>
