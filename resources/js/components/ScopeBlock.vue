<template>
    <!-- A folded loop body: one card in place of all its steps. Synthetic,
         never saved; edges into and out of the body are drawn to it. -->
    <div class="sa-node sa-scope-block" :class="`sa-node--${data.kind}`" :data-scope-block="data.id">
        <Handle type="target" :position="Position.Top" :connectable="false" />

        <div class="sa-node__header">
            <span class="sa-icon-chip">
                <Icon :name="icon" class="sa-scope-block__icon" />
            </span>
            <div class="sa-node__heading">
                <div class="sa-node__title">{{ data.title }}</div>
                <div class="sa-scope-block__count">{{ data.labels.steps }}</div>
            </div>
            <button
                type="button"
                class="sa-scope-frame__toggle nodrag nopan"
                :aria-expanded="false"
                :aria-label="data.labels.expand"
                :title="data.labels.expand"
                @click.stop="toggle"
            >
                <Icon name="chevron-right" class="sa-scope-frame__chevron" />
            </button>
        </div>

        <Handle id="default" type="source" :position="Position.Bottom" :connectable="false" />
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { Icon } from '@statamic/cms/ui';
import { NODE_ICON, createNodeIcon } from '../composables/useNodeIcon.js';

const props = defineProps({
    // { id, frameId, title, kind, ownerType, labels: { steps, expand } }
    data: { type: Object, required: true },
});

const toggleScope = inject('saToggleScope', () => {});
const nodeIcon = inject(NODE_ICON, createNodeIcon());

const icon = computed(() => nodeIcon(props.data.ownerType, props.data.kind));

function toggle() {
    toggleScope(props.data.frameId);
}
</script>
