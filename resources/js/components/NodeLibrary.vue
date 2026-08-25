<template>
    <div class="p-3 flex flex-col h-full" :class="pickMode && 'sa-library--picking'">
        <div class="flex items-center justify-between mb-2">
            <h3 class="text-2xs uppercase tracking-wider text-gray-500 dark:text-gray-400 m-0">
                {{ __('Node library') }}
            </h3>
            <Button
                variant="ghost"
                size="sm"
                icon-only
                icon="chevron-left"
                :aria-label="__('Hide node library')"
                :disabled="pickMode"
                @click="$emit('toggle')"
            />
        </div>

        <!-- Pick mode is armed by clicking a canvas "+" (see AdderNode /
             InsertableEdge). The next node clicked below lands at that exact
             spot instead of the old dropdown flow. -->
        <div v-if="pickMode" class="sa-library-banner">
            <span>{{ pickBannerText }}</span>
            <button type="button" class="sa-library-banner__cancel" @click="$emit('cancel-pick')">
                {{ __('Cancel') }}
            </button>
        </div>

        <Input
            v-model="search"
            type="search"
            :placeholder="__('Filter nodes…')"
            class="mb-3"
        />

        <Tabs v-model="activeTab" class="flex-1 flex flex-col min-h-0">
            <TabList class="mb-2">
                <TabTrigger v-for="group in groups" :key="group.key" :name="group.key">
                    <span class="flex items-center gap-1.5">
                        {{ group.label }}
                        <Badge :text="String(group.items.length)" size="sm" color="default" pill />
                    </span>
                </TabTrigger>
            </TabList>

            <div class="flex-1 overflow-y-auto">
                <!-- Search is active: results merge across ALL tabs, grouped by
                     category — a match in Logic shouldn't hide just because
                     the first group happens to be the active tab. Switching tabs while
                     searching has no effect; clearing the query returns to the
                     normal per-tab view. -->
                <template v-if="searching">
                    <section v-for="group in searchSections" :key="group.key" class="mb-3">
                        <h4 class="sa-section-header mb-1">{{ group.label }}</h4>
                        <ul class="flex flex-col gap-1">
                            <PaletteItem
                                v-for="item in group.items"
                                :key="item.handle"
                                :item="item"
                                :kind="group.kind"
                                @select="$emit('add', $event)"
                            />
                        </ul>
                    </section>
                    <p v-if="!hasSearchResults" class="text-xs text-gray-500 dark:text-gray-400 text-center py-6">
                        {{ __('No nodes match your search.') }}
                    </p>
                </template>

                <template v-else>
                    <TabContent v-for="group in groups" :key="group.key" :name="group.key">
                        <ul class="flex flex-col gap-1">
                            <PaletteItem
                                v-for="item in group.items"
                                :key="item.handle"
                                :item="item"
                                :kind="group.kind"
                                @select="$emit('add', $event)"
                            />
                        </ul>
                        <p v-if="!group.items.length" class="text-xs text-gray-500 dark:text-gray-400 text-center py-6">
                            {{ __('No nodes in this category.') }}
                        </p>
                    </TabContent>
                </template>
            </div>
        </Tabs>
    </div>
</template>

<script setup>
import { computed, defineComponent, h, ref, watch } from 'vue';
import { Badge, Button, Icon, Input, TabContent, TabList, Tabs, TabTrigger } from '@statamic/cms/ui';
import { createNodeIcon } from '../composables/useNodeIcon.js';

const props = defineProps({
    library: { type: Object, required: true },
    /** Node kinds, as data. Same map the canvas gets. */
    kinds: { type: Object, required: true },
    /** `(handle, kind) => iconName`. */
    nodeIcon: { type: Function, default: null },
    // Pick mode is armed by a canvas "+" or by a unique node's "Replace"
    // action. While it is on, `pickKind` decides which groups may show at
    // all: a graph has exactly one entry point, so a mid-flow target must
    // never offer entry nodes, and an entry slot must offer nothing else.
    pickMode: { type: Boolean, default: false },
    pickKind: { type: String, default: 'step' }, // 'entry' | 'replace-entry' | 'step'
    /** Wording for the banner while a pick is armed. */
    pickLabels: { type: Object, default: () => ({}) },
});

const icon = computed(() => props.nodeIcon ?? createNodeIcon());

defineEmits(['add', 'toggle', 'cancel-pick']);

const search = ref('');

/** Every group the host declared, in declaration order. */
const allGroups = computed(() => Object.entries(props.kinds).map(([kind, descriptor]) => ({
    key: descriptor.group ?? kind,
    kind,
    label: descriptor.plural ?? descriptor.label ?? kind,
    unique: descriptor.unique === true,
    items: props.library[descriptor.group ?? kind] ?? [],
})));

const activeTab = ref(null);

const isEntryPick = computed(() => props.pickKind === 'entry' || props.pickKind === 'replace-entry');

const groups = computed(() => {
    const all = allGroups.value;
    if (!props.pickMode) return all;

    // A graph has exactly one entry point. Offering entry nodes mid-flow would
    // build a second one; offering anything else in the entry slot would build
    // a graph nothing can walk into.
    return isEntryPick.value
        ? all.filter((group) => group.unique)
        : all.filter((group) => !group.unique);
});

watch(groups, (list) => {
    if (!list.some((group) => group.key === activeTab.value)) {
        activeTab.value = list[0]?.key ?? null;
    }
}, { immediate: true });

const pickBannerText = computed(() => {
    if (props.pickKind === 'replace-entry') return props.pickLabels.replaceEntry ?? __('Choose a replacement.');
    if (props.pickKind === 'entry') return props.pickLabels.entry ?? __('Choose where this starts.');
    return props.pickLabels.step ?? __('Choose a node to insert here.');
});

// Keep the active tab valid whenever the available groups change (e.g.
// entering a step pick while the entry group was focused would otherwise show an
// empty tab body).
watch(
    groups,
    (next) => {
        if (!next.some((group) => group.key === activeTab.value)) {
            activeTab.value = next[0]?.key ?? 'logic';
        }
    },
    { immediate: true },
);

function filterItems(items) {
    const needle = search.value.toLowerCase();
    return items.filter(
        (item) =>
            item.label.toLowerCase().includes(needle) ||
            item.handle.toLowerCase().includes(needle),
    );
}

const searching = computed(() => search.value.trim().length > 0);

const searchSections = computed(() =>
    searching.value
        ? groups.value
            .map((group) => ({ ...group, items: filterItems(group.items) }))
            .filter((group) => group.items.length > 0)
        : [],
);

const hasSearchResults = computed(() => searchSections.value.length > 0);

// One card per library entry. Defined inline (rather than as a separate SFC)
// since it's only ever used from the two loops above — same pattern as
// ConfigPanel's inline OptionsSelect.
const PaletteItem = defineComponent({
    name: 'PaletteItem',
    props: {
        item: { type: Object, required: true },
        kind: { type: String, required: true },
    },
    emits: ['select'],
    setup(itemProps, { emit }) {
        // The clickable element is a real <button>, not the <li>. The <li> with
        // an onClick that used to sit here was reachable by mouse only: no role,
        // no tabindex, no key handler. Adding a node is the primary action of
        // this addon, so that made the whole builder unusable from a keyboard or
        // a screen reader. A native button brings focus, Enter/Space and the
        // right role with it — the same shape EmailTemplatePicker already uses.
        return () =>
            h('li', { class: 'w-full' }, [
                h(
                    'button',
                    {
                        type: 'button',
                        class: 'group w-full text-start flex items-start gap-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-content-bg px-2.5 py-2 cursor-pointer hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 focus-outline transition-colors',
                        onClick: () => emit('select', itemProps.item.handle),
                    },
                    [
                        h(
                            'span',
                            { class: `sa-icon-chip sa-icon-chip--sm sa-icon-chip--${itemProps.kind}` },
                            [h(Icon, { name: icon.value(itemProps.item.handle, itemProps.kind), class: 'size-3.5' })],
                        ),
                        h('div', { class: 'min-w-0' }, [
                            h('div', { class: 'text-sm font-medium leading-tight truncate' }, itemProps.item.label),
                            itemProps.item.description
                                ? h(
                                    'div',
                                    { class: 'text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug' },
                                    itemProps.item.description,
                                )
                                : null,
                        ]),
                    ],
                ),
            ]);
    },
});
</script>
