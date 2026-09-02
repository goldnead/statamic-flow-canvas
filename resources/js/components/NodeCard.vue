<template>
    <div
        class="sa-node"
        :class="[
            `sa-node--${kind}`,
            selected && 'sa-node--selected',
            status === 'error' && 'sa-node--invalid',
            status === 'warning' && 'sa-node--incomplete',
        ]"
    >
        <!-- A picture of what this node is, when the host has one: a 16:10
             tile the full width of the card, above the title. The tile's
             height is fixed and the image loads lazily inside it, so a card
             is the same size before and after the picture arrives and the
             graph never jumps. No `alt`: the title underneath already says
             what it is. Absent, the card looks exactly as it always has. -->
        <div v-if="data.thumbnail" class="sa-node__thumb">
            <img :src="data.thumbnail" alt="" loading="lazy" decoding="async" draggable="false" />
        </div>

        <!-- Header: icon chip · title/subtitle · meta badge · context menu -->
        <div class="sa-node__header">
            <span class="sa-icon-chip">
                <Icon :name="icon" class="size-4" />
            </span>

            <div class="sa-node__heading">
                <div class="sa-node__title">{{ data.label }}</div>
                <div class="sa-node__subtitle">{{ data.type }}</div>
            </div>

            <div class="flex items-center gap-1 shrink-0">
                <!-- Inline validity badge (A3): a red "Invalid" / amber
                     "Incomplete" chip surfaces the node's validation state
                     right in the header, complementing the card ring + the
                     footer status pill. -->
                <Badge
                    v-if="status === 'error'"
                    color="red"
                    :text="__('Invalid')"
                    size="sm"
                    pill
                    icon="warning-diamond"
                />
                <Badge
                    v-else-if="status === 'warning'"
                    color="amber"
                    :text="__('Incomplete')"
                    size="sm"
                    pill
                    icon="warning-diamond"
                />
                <Badge :color="kindColor" :text="kindLabel" size="sm" pill />
                <Dropdown side="bottom" align="end">
                    <template #trigger>
                        <Button
                            icon="dots"
                            variant="ghost"
                            size="sm"
                            inset
                            :aria-label="__('Node actions')"
                            @click.stop
                        />
                    </template>
                    <!-- The items live inside a DropdownMenu because they are
                         `grid-cols-subgrid` and the menu is the grid that
                         defines the icon/label tracks. Loose items overflow
                         their own menu and it grows a sideways scrollbar. -->
                    <DropdownMenu>
                        <DropdownItem :text="__('Rename')" icon="rename" @click="$emit('rename')" />
                        <!-- Unique kinds are excluded: duplicating one would
                             create a second, and a unique node has no Delete to
                             recover from that (see the
                             "Delete" gate below / Edit.vue's duplicateNode). -->
                        <DropdownItem
                            v-if="!isUnique"
                            :text="__('Duplicate')"
                            icon="duplicate"
                            @click="$emit('duplicate')"
                        />
                        <DropdownItem
                            :text="data.disabled ? __('Enable') : __('Disable')"
                            :icon="data.disabled ? 'eye' : 'eye-slash'"
                            @click="$emit('toggle-disabled')"
                        />
                        <!-- Unique kinds only: the swap-in-place path. A graph
                             has exactly one entry point, so this is the primary way
                             to change it — "Delete" is hidden below for the same
                             reason. -->
                        <DropdownItem
                            v-if="isUnique"
                            :text="descriptor.replaceLabel ?? __('Replace')"
                            icon="replace"
                            @click="$emit('replace-unique')"
                        />
                        <template v-if="!isUnique">
                            <DropdownSeparator />
                            <DropdownItem
                                :text="__('Delete')"
                                icon="trash"
                                variant="destructive"
                                @click="$emit('delete')"
                            />
                        </template>
                    </DropdownMenu>
                </Dropdown>
            </div>
        </div>

        <!-- Body: one config summary line + variable chips (only if present) -->
        <div v-if="summary || chips.length" class="sa-node__body">
            <div v-if="summary" class="sa-node__summary">{{ summary }}</div>
            <div v-if="chips.length" class="sa-node__chips">
                <span v-for="chip in chips" :key="chip" class="sa-chip">{{ chip }}</span>
            </div>
        </div>

        <!-- What this step has actually done, in the window the activity view
             is set to: how many reached it, how many got through, how many
             broke on it.

             Absent, not zero, when nothing has run through this node. A fresh
             graph whose every card reads "0 / 0 / 0" looks broken rather
             than new, and the difference between "nobody yet" and "everybody
             failed" is the one thing this strip exists to make obvious.

             The card is a fixed 240px (cp.css), so the numbers are glyph plus
             figure with the sentence in the tooltip, and the failure figure only
             appears when there is a failure to report. -->
        <div v-if="figures.length" class="sa-node__stats" data-node-stats>
            <span
                v-for="figure in figures"
                :key="figure.key"
                class="sa-node__stat"
                :class="figure.tone ? `sa-node__stat--${figure.tone}` : null"
                :title="figure.label"
            >
                <Icon :name="figure.icon" class="size-3" />
                <span>{{ figure.text }}</span>
            </span>
        </div>

        <!-- Footer: status dot + kind label · output legend (one label per
             source handle, e.g. true/false, switch case handles, loop/done,
             parallel branch handles — empty for the plain single-output
             case, matching the previous behaviour). -->
        <div class="sa-node__footer">
            <span class="sa-status-dot" :class="statusDotClass" />
            <span class="sa-node__kind-label">{{ statusLabel }}</span>
            <span v-if="labeledOutputs.length" class="ml-auto flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 text-[10px] font-mono">
                <template v-for="(out, i) in labeledOutputs" :key="out.handle">
                    <span class="text-gray-300 dark:text-gray-600" v-if="i > 0">/</span>
                    <span :class="handleLabelClass(out.handle)">{{ out.label }}</span>
                </template>
            </span>
        </div>

        <!-- Vertical flow: nodes connect top → bottom. Target sits on the top
             edge, source(s) on the bottom edge. A node's outputs (branch
             true/false, switch cases + default, loop/done, parallel
             branches, or a single plain continuation) are spread evenly
             across the bottom edge via handleY(), each carrying its own
             `id` so edges/adders can address it as `from_output`. -->
        <Handle v-if="!isUnique" type="target" :position="Position.Top" />
        <Handle
            v-for="(out, i) in outputs"
            :key="out.handle"
            :id="out.handle"
            type="source"
            :position="Position.Bottom"
            :style="{ left: `${handleY(i, outputs.length) * 100}%` }"
        />
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { Badge, Button, Dropdown, DropdownMenu, DropdownItem, DropdownSeparator, Icon } from '@statamic/cms/ui';
import { inject } from 'vue';
import { NODE_ICON, NODE_KINDS, createNodeIcon } from '../composables/useNodeIcon.js';
import { outputsFor, handleY } from '../composables/useAutoLayout.js';

const props = defineProps({
    kind: { type: String, required: true },
    data: { type: Object, required: true },
    status: { type: String, default: null },
    selected: { type: Boolean, default: false },
    /**
     * What this node has done, for the strip on the card. Null when nothing has
     * run through it: null is not the same as zeroes, and a fresh graph whose
     * every card reads "0 / 0 / 0" looks broken rather than new.
     *
     * Two accepted shapes:
     *
     * - A **list** of `{ key, icon, value, label, tone? }`. The host decides
     *   what the figures mean and, importantly, what they are called: an
     *   automation's node "completed" and a funnel step's visitor "continued"
     *   are not the same sentence, and neither belongs in this package.
     * - The **legacy** `{ reached, completed, failed }` object, kept working so
     *   a host that has not moved over renders as before.
     */
    stats: { type: [Object, Array], default: null },
});

/**
 * Four figures and up in thousands, because the card is 240px wide and three of
 * these sit on one line. `12.4k` is legible where `12437` pushes the failure
 * count off the edge; the exact number stays in the tooltip.
 */
function formatCount(value) {
    const n = Number(value) || 0;
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

/**
 * The strip, normalised.
 *
 * A figure with no value at all is dropped rather than shown as zero, which is
 * how the failure count has always behaved and is worth keeping general: an
 * empty column is noise on a 240px card.
 */
const figures = computed(() => {
    const raw = props.stats;

    if (!raw) return [];

    const list = Array.isArray(raw)
        ? raw
        : [
              { key: 'reached', icon: 'arrow-down', value: raw.reached, label: __(':n reached this step', { n: raw.reached }) },
              { key: 'completed', icon: 'checkmark', value: raw.completed, tone: 'done', label: __(':n got through it', { n: raw.completed }) },
              { key: 'failed', icon: 'warning-diamond', value: raw.failed, tone: 'failed', label: __(':n failed here', { n: raw.failed }), onlyWhenSet: true },
          ];

    return list
        .filter((f) => !(f.onlyWhenSet && !f.value))
        .filter((f) => f.value !== null && f.value !== undefined)
        .map((f) => ({
            ...f,
            // A host may pass a ready-made string (a percentage, say). Numbers
            // still get the thousands treatment, because three five-digit
            // figures do not fit on one line.
            text: typeof f.value === 'string' ? f.value : formatCount(f.value),
        }));
});

defineEmits(['rename', 'duplicate', 'toggle-disabled', 'delete', 'replace-unique']);

// Provided by the canvas rather than passed as props: VueFlow renders these
// cards through its own slots, so a prop would have to be threaded through
// machinery this package does not own.
const nodeIcon = inject(NODE_ICON, createNodeIcon());
const kinds = inject(NODE_KINDS, {});

/** What this kind is called, what colour it wears, and how it may be edited. */
const descriptor = computed(() => kinds[props.kind] ?? {});

const icon = computed(() => nodeIcon(props.data.type, props.kind));

const kindLabel = computed(() => descriptor.value.label ?? props.kind);

const kindColor = computed(() => descriptor.value.color ?? 'default');

/**
 * A kind declared `unique` may exist at most once, which is also why it cannot
 * be duplicated and why it offers "Replace" instead of "Delete": deleting the
 * only entry point would leave a graph nothing can walk into.
 */
const isUnique = computed(() => descriptor.value.unique === true);

/** A kind with no input handle is where a graph starts. */
const hasInput = computed(() => descriptor.value.hasInput !== false);

// `data` is already shaped like a graph node ({ type, config, ... }), so it
// can be fed straight into the shared outputsFor() used by the layout/canvas.
const outputs = computed(() => outputsFor(props.data));
const labeledOutputs = computed(() => outputs.value.filter((o) => o.label));

function handleLabelClass(handle) {
    if (handle === 'true') return 'sa-handle-label--true';
    if (handle === 'false') return 'sa-handle-label--false';
    return 'sa-handle-label--default';
}

const summary = computed(() => {
    const config = props.data.config ?? {};
    if (props.data.type === 'send_email' && config.to) return `→ ${config.to}`;
    if (props.data.type === 'send_webhook' && config.url) return `POST ${config.url}`;
    if (props.data.type === 'add_log_entry' && config.message) return String(config.message).slice(0, 60);
    if (props.data.type === 'filter' && Array.isArray(config.conditions)) {
        return __(':n condition(s)', { n: config.conditions.length });
    }
    return null;
});

// Antenna-scan config for {{ variable }} references → chips (max 4, deduped).
const chips = computed(() => {
    const found = new Set();
    const scan = (value) => {
        if (typeof value === 'string') {
            const matches = value.match(/\{\{\s*[\w.]+\s*\}\}/g);
            if (matches) matches.forEach((m) => found.add(m.replace(/\s+/g, ' ').trim()));
        } else if (Array.isArray(value)) {
            value.forEach(scan);
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(scan);
        }
    };
    scan(props.data.config ?? {});
    return [...found].slice(0, 4);
});

const statusDotClass = computed(() => {
    if (props.status === 'error') return 'sa-status-dot--error';
    if (props.status === 'warning') return 'sa-status-dot--warning';
    return 'sa-status-dot--ok';
});

const statusLabel = computed(() => {
    if (props.data.disabled) return __('Disabled');
    if (props.status === 'error') return __('Invalid');
    if (props.status === 'warning') return __('Incomplete');
    return __('Ready');
});
</script>
