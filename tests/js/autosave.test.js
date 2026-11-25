/**
 * `useAutosave()` — the debounce must never lose the last edit: not on
 * unmount, not when a save is still in flight, not after a failed save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';
import { useAutosave } from '../../resources/js/composables/useAutosave.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function setup(saver, options = {}) {
    const graph = reactive({ n: 0 });
    const api = useAutosave({ source: () => graph, saver, debounceMs: 100, defaultEnabled: true, ...options });
    return { graph, api };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useAutosave', () => {
    it('saves once after the debounce window', async () => {
        const saver = vi.fn().mockResolvedValue();
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        expect(api.status.value).toBe('pending');

        await vi.advanceTimersByTimeAsync(100);
        expect(saver).toHaveBeenCalledTimes(1);
        expect(api.status.value).toBe('saved');
    });

    it('flushes a pending change when the editor is torn down', async () => {
        const saver = vi.fn().mockResolvedValue();
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        expect(api.status.value).toBe('pending');

        api.dispose();
        expect(saver).toHaveBeenCalledTimes(1);
    });

    it('flushes a failed change again on teardown instead of dropping it', async () => {
        const saver = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue();
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);
        expect(api.status.value).toBe('error');

        api.dispose();
        expect(saver).toHaveBeenCalledTimes(2);
    });

    it('logs a failed save and keeps the message', async () => {
        const saver = vi.fn().mockRejectedValue(new Error('419 expired'));
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);

        expect(api.lastError.value).toBe('419 expired');
        expect(console.error).toHaveBeenCalled();
    });

    it('does not report "saved" when a newer change arrived during the save', async () => {
        const first = deferred();
        const saver = vi.fn()
            .mockImplementationOnce(() => first.promise)
            .mockResolvedValue();
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);
        expect(api.status.value).toBe('saving');

        graph.n++;
        await nextTick();
        first.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(api.status.value).not.toBe('saved');
    });

    it('never runs two saves in parallel and saves the newest state afterwards', async () => {
        const first = deferred();
        let running = 0;
        let maxRunning = 0;
        const saver = vi.fn().mockImplementation(async () => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            if (saver.mock.calls.length === 1) await first.promise;
            running--;
        });
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);
        expect(saver).toHaveBeenCalledTimes(1);

        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);
        expect(saver).toHaveBeenCalledTimes(1);

        first.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(100);

        expect(saver).toHaveBeenCalledTimes(2);
        expect(maxRunning).toBe(1);
        expect(api.status.value).toBe('saved');
    });

    it('does not run the queued follow-up save after autosave was switched off', async () => {
        const first = deferred();
        const saver = vi.fn()
            .mockImplementationOnce(() => first.promise)
            .mockResolvedValue();
        const { graph, api } = setup(saver);

        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);
        graph.n++;
        await nextTick();
        await vi.advanceTimersByTimeAsync(100);

        api.toggle(false);
        first.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(saver).toHaveBeenCalledTimes(1);
        expect(api.status.value).toBe('idle');
    });

    it('asks the browser to confirm leaving while a change is unsaved', async () => {
        const listeners = {};
        vi.stubGlobal('window', {
            addEventListener: (name, fn) => { listeners[name] = fn; },
            removeEventListener: (name) => { delete listeners[name]; },
        });
        const saver = vi.fn().mockResolvedValue();
        const { graph, api } = setup(saver);

        expect(listeners.beforeunload).toBeTypeOf('function');

        graph.n++;
        await nextTick();
        const event = { preventDefault: vi.fn(), returnValue: undefined };
        listeners.beforeunload(event);
        expect(event.preventDefault).toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);
        const clean = { preventDefault: vi.fn() };
        listeners.beforeunload(clean);
        expect(clean.preventDefault).not.toHaveBeenCalled();

        api.dispose();
        expect(listeners.beforeunload).toBeUndefined();
    });
});
