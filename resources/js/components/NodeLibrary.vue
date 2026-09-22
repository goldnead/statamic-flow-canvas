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
            <!-- TabList (@statamic/cms/ui) renders a plain flex row with no
                 overflow-x-auto and no flex-wrap. Four groups plus their count
                 pills don't fit a 288-300px sidebar column, and "Actions" was
                 unreachable: clipped under automations' overflow-hidden wrapper,
                 spilling past the edge under funnels'. This wrapper turns that
                 overflow into a horizontal scroll instead, without touching
                 either host's wrapper. -->
            <div class="flow-tab-fade-wrap mb-2">
                <div
                    ref="tabScroller"
                    class="-mx-1 overflow-x-auto px-1"
                    data-node-library-tabs-shell
                    @scroll="updateTabFade"
                >
                    <TabList class="flex-nowrap">
                        <TabTrigger v-for="group in groups" :key="group.key" :name="group.key">
                            <span class="flex items-center gap-1.5">
                                {{ group.label }}
                                <Badge :text="String(group.items.length)" size="sm" color="default" pill />
                            </span>
                        </TabTrigger>
                    </TabList>
                </div>

                <!--
                    Weiche Kante statt Dekoration: der Fade zeigt nur, wenn in diese
                    Richtung wirklich noch Tabs liegen, und verschwindet, sobald das Ende
                    erreicht ist — sonst waere er eine Kante, die am Ende der Liste luegt.
                    Aria-hidden und `pointer-events: none`, damit er keinen Klick schluckt:
                    der Tab darunter bleibt der Treffer, nicht das Overlay. Farbe kommt aus
                    dem Statamic-Token `var(--theme-color-content-bg)` (derselbe Wert, den
                    `bg-content-bg` aufloest), kein fester Hex-Wert, das traegt Hell und
                    Dunkel gleichermassen. Plain CSS im <style>-Block unten statt
                    Tailwind-Utility-Klassen: dieses Repo hat keinen eigenen Tailwind-Build,
                    Hosts kompilieren NodeLibrary.vue jeweils selbst, und automations bindet
                    canvas.css nicht ein, sondern haelt eine eigene Kopie der sa-*-Klassen —
                    eine neue Utility-Klasse hier haette in mindestens einem Host lautlos
                    keine Regel erzeugt. Baugleich mit der Gegenstelle in NodeLibrary.vue
                    (statamic-flow-canvas) und Settings.vue (statamic-brand-context) —
                    zweimal gebaut statt geteilt, weil brand-context nicht von flow-canvas
                    abhaengt (siehe composer.json) und eine neue Abhaengigkeit fuer eine
                    Fade-Kante zu teuer waere. Aenderung hier: die Gegenstelle im jeweils
                    anderen Repo nachziehen.
                -->
                <div
                    v-show="canScrollTabsLeft"
                    aria-hidden="true"
                    data-node-library-tabs-fade="left"
                    class="flow-tab-fade flow-tab-fade--left"
                />
                <div
                    v-show="canScrollTabsRight"
                    aria-hidden="true"
                    data-node-library-tabs-fade="right"
                    class="flow-tab-fade flow-tab-fade--right"
                />
            </div>

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
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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

/** The scrollable strip around the tab bar — see the fade divs in the template. */
const tabScroller = ref(null);
const canScrollTabsLeft = ref(false);
const canScrollTabsRight = ref(false);

/**
 * Reads the scroll position back out of the DOM. Cheap enough to call on
 * every scroll tick: three property reads and two comparisons, no layout
 * thrash. The 1px slack absorbs sub-pixel rounding some browsers report at
 * the scroll boundary, which would otherwise flicker a fade at rest.
 */
function updateTabFade() {
    const el = tabScroller.value;
    if (!el) return;
    canScrollTabsLeft.value = el.scrollLeft > 1;
    canScrollTabsRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

// The group list changes shape under pick mode (entry vs. step groups), which
// changes how much the tab bar overflows — recompute once the DOM has caught
// up. A window resize can do the same to the sidebar column itself.
watch(groups, () => nextTick(updateTabFade));
onMounted(() => {
    nextTick(updateTabFade);
    window.addEventListener('resize', updateTabFade);
});
onBeforeUnmount(() => window.removeEventListener('resize', updateTabFade));

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

<style scoped>
/* Plain CSS, not Tailwind utilities — see the template comment above the fade
   divs for why. `var(--theme-color-content-bg)` is the same custom property
   `bg-content-bg` resolves to, so this tracks the CP's light/dark theme (and
   any custom accent) without a second definition of what that colour is. */
.flow-tab-fade-wrap {
    position: relative;
}
.flow-tab-fade {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1.5rem;
    z-index: 1;
    pointer-events: none;
}
.flow-tab-fade--left {
    left: 0;
    background: linear-gradient(to right, var(--theme-color-content-bg), transparent);
}
.flow-tab-fade--right {
    right: 0;
    background: linear-gradient(to left, var(--theme-color-content-bg), transparent);
}
</style>
