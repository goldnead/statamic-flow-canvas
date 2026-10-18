<template>
    <!-- The `fc-` classes are plain CSS in the <style> block below, not Tailwind
         utilities (see NodeLibrary.vue). -->
    <section class="fc-section">
        <component
            :is="collapsible ? 'button' : 'div'"
            :type="collapsible ? 'button' : undefined"
            class="sa-section-header fc-section-header"
            :class="collapsible && 'fc-section-header--collapsible'"
            @click="collapsible && (isOpen = !isOpen)"
        >
            <span>{{ title }}</span>
            <Icon
                v-if="collapsible"
                :name="isOpen ? 'chevron-down' : 'chevron-right'"
                class="size-3 fc-section-chevron"
            />
        </component>

        <div v-show="isOpen" class="fc-section-body">
            <slot />
        </div>
    </section>
</template>

<script setup>
import { ref } from 'vue';
import { Icon } from '@statamic/cms/ui';

const props = defineProps({
    title: { type: String, required: true },
    collapsible: { type: Boolean, default: true },
    defaultOpen: { type: Boolean, default: true },
});

const isOpen = ref(props.defaultOpen);
</script>

<style scoped>
.fc-section {
    border-bottom: 1px solid var(--color-gray-200);
}
:global(.dark) .fc-section {
    border-bottom-color: var(--color-gray-800);
}
.fc-section-header {
    padding-inline: 1rem;
    padding-block: 0.625rem;
}
.fc-section-header--collapsible {
    cursor: pointer;
}
.fc-section-chevron {
    color: var(--color-gray-400);
}
.fc-section-body {
    padding-inline: 1rem;
    padding-bottom: 1rem;
}
</style>
