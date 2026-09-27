<template>
    <!-- A folded loop body: one card in place of all its steps, inside the
         loop's frame. Synthetic, never saved; edges into and out of the body
         are drawn to it. Unfolded with the chevron in the frame's head. -->
    <div class="sa-node sa-scope-block" :class="`sa-node--${data.kind}`" :data-scope-block="data.id">
        <Handle type="target" :position="Position.Top" :connectable="false" />

        <div class="sa-node__header">
            <span class="sa-icon-chip">
                <Icon :name="icon" class="sa-scope-block__icon" />
            </span>
            <div class="sa-node__heading">
                <div class="sa-node__title">{{ data.title }}</div>
                <div v-if="data.summary" class="sa-scope-block__summary" :title="data.summary">{{ data.summary }}</div>
            </div>
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
    // { id, frameId, title, summary, kind, ownerType }
    data: { type: Object, required: true },
});

const nodeIcon = inject(NODE_ICON, createNodeIcon());

const icon = computed(() => nodeIcon(props.data.ownerType, props.data.kind));
</script>
