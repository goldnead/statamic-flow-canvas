/**
 * `useHistory()` — undo/redo for the graph, and the coalescing that keeps a
 * hundred keystrokes from evicting the one delete the user wants back.
 */
import { describe, expect, it } from 'vitest';
import { useHistory } from '../../resources/js/composables/useHistory.js';

function harness(initial = { nodes: [], edges: [] }, options = {}) {
    let state = JSON.parse(JSON.stringify(initial));
    let at = 1_000;
    const history = useHistory({
        getState: () => state,
        setState: (next) => { state = next; },
        now: () => at,
        ...options,
    });

    return {
        history,
        get: () => state,
        set: (next) => { state = JSON.parse(JSON.stringify(next)); },
        label: (text) => { state = { ...state, nodes: [{ ...state.nodes[0], label: text }] }; },
        advance: (ms) => { at += ms; },
    };
}

const graph = (...labels) => ({ nodes: labels.map((l) => ({ node_key: l, label: l })), edges: [] });

describe('useHistory', () => {
    it('starts with nothing to undo or redo', () => {
        const { history } = harness();

        expect(history.canUndo.value).toBe(false);
        expect(history.canRedo.value).toBe(false);
    });

    it('undo restores the previous graph and redo re-applies it', () => {
        const h = harness(graph());

        h.set(graph('a'));
        h.history.record();
        h.set(graph('a', 'b'));
        h.history.record();

        h.history.undo();
        expect(h.get()).toEqual(graph('a'));
        h.history.undo();
        expect(h.get()).toEqual(graph());
        expect(h.history.canUndo.value).toBe(false);

        h.history.redo();
        expect(h.get()).toEqual(graph('a'));
        h.history.redo();
        expect(h.get()).toEqual(graph('a', 'b'));
        expect(h.history.canRedo.value).toBe(false);
    });

    it('hands the caller a copy, never the stored snapshot', () => {
        const h = harness(graph('a'));

        h.set(graph('a', 'b'));
        h.history.record();
        h.history.undo();

        // Mutating what undo returned must not corrupt what redo will restore from.
        h.get().nodes.push({ node_key: 'rogue' });
        h.history.redo();
        h.history.undo();

        expect(h.get()).toEqual(graph('a'));
    });

    it('does not record a change that changed nothing', () => {
        const h = harness(graph('a'));

        h.set(graph('a'));
        h.history.record();

        expect(h.history.canUndo.value).toBe(false);
    });

    it('a new edit after undo discards the redo branch', () => {
        const h = harness(graph());

        h.set(graph('a'));
        h.history.record();
        h.history.undo();
        expect(h.history.canRedo.value).toBe(true);

        h.set(graph('z'));
        h.history.record();

        expect(h.history.canRedo.value).toBe(false);
        h.history.undo();
        expect(h.get()).toEqual(graph());
    });

    it('drops the oldest entry past the maximum depth', () => {
        const h = harness(graph('0'), { max: 3 });

        for (const step of ['1', '2', '3', '4']) {
            h.set(graph(step));
            h.history.record();
        }

        h.history.undo();
        h.history.undo();
        h.history.undo();
        expect(h.get()).toEqual(graph('1'));
        expect(h.history.canUndo.value).toBe(false);
    });

    it('folds a burst of typing on one field into a single undo step', () => {
        const h = harness(graph('a'), { coalesceMs: 600 });

        for (const text of ['L', 'La', 'Lan', 'Land']) {
            h.label(text);
            h.history.record('label:a');
            h.advance(100);
        }

        h.history.undo();
        expect(h.get().nodes[0].label).toBe('a');
        expect(h.history.canUndo.value).toBe(false);
    });

    it('a pause longer than the window starts a new step', () => {
        const h = harness(graph('a'), { coalesceMs: 600 });

        h.label('La');
        h.history.record('label:a');
        h.advance(601);
        h.label('Land');
        h.history.record('label:a');

        h.history.undo();
        expect(h.get().nodes[0].label).toBe('La');
        h.history.undo();
        expect(h.get().nodes[0].label).toBe('a');
    });

    it('moving to another field ends the run even mid-typing', () => {
        const h = harness(graph('a'), { coalesceMs: 600 });

        h.label('La');
        h.history.record('label:a');
        h.set({ ...h.get(), nodes: [{ ...h.get().nodes[0], config: { to: 'x' } }] });
        h.history.record('config:a');

        h.history.undo();
        expect(h.get().nodes[0].config).toBeUndefined();
        expect(h.get().nodes[0].label).toBe('La');
    });

    it('never folds a structural step into the typing before it', () => {
        const h = harness(graph('a'), { coalesceMs: 600 });

        h.label('La');
        h.history.record('label:a');
        h.set({ nodes: [...h.get().nodes, { node_key: 'b', label: 'b' }], edges: [] });
        h.history.record(); // untagged: add a node

        h.history.undo();
        expect(h.get().nodes.map((n) => n.node_key)).toEqual(['a']);
        expect(h.get().nodes[0].label).toBe('La');
    });

    it('typing after an undo cannot fold into the entry that undo restored past', () => {
        const h = harness(graph('a'), { coalesceMs: 600 });

        h.label('La');
        h.history.record('label:a');
        h.history.undo();
        h.label('Lx');
        h.history.record('label:a');

        h.history.undo();
        expect(h.get().nodes[0].label).toBe('a');
    });

    it('reset re-baselines so earlier edits are gone', () => {
        const h = harness(graph());

        h.set(graph('a'));
        h.history.record();
        h.history.undo();
        h.set(graph('fresh'));
        h.history.reset();

        expect(h.history.canUndo.value).toBe(false);
        expect(h.history.canRedo.value).toBe(false);

        h.set(graph('fresh', 'more'));
        h.history.record();
        h.history.undo();
        expect(h.get()).toEqual(graph('fresh'));
    });
});
