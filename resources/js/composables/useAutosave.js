import { ref, computed, watch, onBeforeUnmount } from 'vue';

/**
 * Debounced autosave for a graph editor.
 *
 * Usage:
 *
 *     const { status, lastSavedAt, enabled, toggle } = useAutosave({
 *         source: () => graph.value,
 *         saver: () => save(),
 *         debounceMs: 2000,
 *     });
 *
 * `source` returns the reactive object whose changes should trigger a save.
 * `saver` is the async function that actually persists the change.
 * `enabled.value` is bound to a checkbox in the topbar; toggling it on
 * starts watching, off cancels any pending timer.
 *
 * Status values:
 *   - "idle"     — nothing scheduled, no recent save
 *   - "pending"  — change detected, save scheduled
 *   - "saving"   — saver running
 *   - "saved"    — last save completed successfully
 *   - "error"    — last save failed
 *
 * `isDirty` is true while an edit is unsaved (pending, saving or failed): wire
 * it to Statamic.$dirty so core asks before the page is left. Leaving the
 * editor (unmount / `dispose()`) saves what is pending or failed first.
 */
export function useAutosave({ source, saver, debounceMs = 2000, defaultEnabled = false } = {}) {
    const status = ref('idle');
    const lastSavedAt = ref(null);
    const lastError = ref(null);
    const enabled = ref(defaultEnabled);

    let timer = null;
    let stopWatching = null;
    let inFlight = null;
    let rerun = false;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function hasUnsaved() {
        return status.value === 'pending' || status.value === 'saving' || status.value === 'error';
    }

    // True while an edit has not reached the server. Hosts feed this to core's
    // dirty-state handling (Statamic.$dirty), which owns the one leave-the-page
    // prompt; a second beforeunload handler here would stack a second prompt.
    const isDirty = computed(hasUnsaved);

    async function runSaves() {
        do {
            rerun = false;
            status.value = 'saving';
            try {
                await saver();
                lastSavedAt.value = new Date();
                lastError.value = null;
                // Switched off while this save ran: leave the status alone.
                if (!enabled.value) return;
                // A change that arrived while saving is not saved yet.
                status.value = timer || rerun ? 'pending' : 'saved';
            } catch (e) {
                status.value = 'error';
                lastError.value = e?.response?.data?.message || e?.message || 'Autosave failed.';
                console.error('[flow-canvas] Autosave failed:', e);
                return;
            }
        } while (rerun && enabled.value);
    }

    /**
     * Saves now. Never runs two saves in parallel: a flush that arrives while
     * a save is in flight queues exactly one follow-up with the newest state.
     */
    function flush() {
        clearTimer();
        if (!enabled.value) return Promise.resolve();
        if (inFlight) {
            rerun = true;
            return inFlight;
        }
        inFlight = runSaves().finally(() => { inFlight = null; });
        return inFlight;
    }

    function schedule() {
        if (!enabled.value) return;
        clearTimer();
        status.value = 'pending';
        timer = setTimeout(flush, debounceMs);
    }

    function start() {
        if (stopWatching) return;
        stopWatching = watch(
            source,
            () => schedule(),
            { deep: true },
        );
    }

    function stop() {
        clearTimer();
        if (stopWatching) {
            stopWatching();
            stopWatching = null;
        }
        status.value = 'idle';
    }

    // Tear down without losing the last edit: save what is pending or failed first.
    function dispose() {
        if (enabled.value && (status.value === 'pending' || status.value === 'error')) {
            flush();
        }
        stop();
    }

    function toggle(value) {
        const next = typeof value === 'boolean' ? value : !enabled.value;
        enabled.value = next;
        if (next) {
            start();
        } else {
            stop();
        }
    }

    if (defaultEnabled) {
        start();
    }

    onBeforeUnmount(dispose);

    return {
        status,
        lastSavedAt,
        lastError,
        isDirty,
        enabled,
        flush,
        dispose,
        toggle,
    };
}
