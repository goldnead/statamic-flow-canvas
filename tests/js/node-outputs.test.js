/**
 * The canvas half of the node-output contract: a spec the server declared,
 * evaluated against a node's live config. This is the file both hosts route
 * their handles through, so a wrong answer here is an edge drawn on a handle
 * the engine will never fire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    OUTPUT_SPEC_VERSION,
    clearNodeOutputSpecs,
    continuationOutput,
    keyValueEntries,
    onStaleOutputSpec,
    outputSpecFor,
    outputsFor,
    resolveOutputSpec,
    setNodeOutputSpecs,
} from '../../resources/js/composables/useNodeOutputs.js';

afterEach(() => {
    clearNodeOutputSpecs();
    onStaleOutputSpec(null);
});

const DEFAULT = [{ handle: 'default', label: '' }];

describe('registering specs', () => {
    it('reads a grouped library and a flat list the same way', () => {
        const spec = { clauses: [{ outputs: ['a'] }] };

        expect(setNodeOutputSpecs({ pages: [{ handle: 'page', outputs: spec }], offers: [{ handle: 'offer', outputs: spec }] })).toBe(2);
        expect(outputSpecFor('offer')).toBe(spec);

        expect(setNodeOutputSpecs([{ handle: 'only' , outputs: spec }])).toBe(1);
        expect(outputSpecFor('offer')).toBeNull();
        expect(outputSpecFor('only')).toBe(spec);
    });

    it('skips entries without a handle or without outputs', () => {
        expect(setNodeOutputSpecs([{ outputs: {} }, { handle: 'x' }, null])).toBe(0);
    });
});

describe('outputsFor', () => {
    it('gives a node without a spec the single default continuation', () => {
        expect(outputsFor({ type: 'unknown', config: {} })).toEqual(DEFAULT);
        expect(outputsFor(undefined)).toEqual(DEFAULT);
    });

    it('picks the first clause whose condition holds, in declared order', () => {
        setNodeOutputSpecs([{
            handle: 'parallel',
            outputs: {
                clauses: [
                    { when: { field: 'mode', is: ['all'] }, outputs: ['done'] },
                    { when: { field: 'mode', is: ['each'], default: 'each' }, outputs: ['each', 'done'] },
                    { when: { field: 'mode', not: ['all', 'each'] }, outputs: ['other'] },
                ],
            },
        }]);

        expect(outputsFor({ type: 'parallel', config: { mode: 'all' } }).map((o) => o.handle)).toEqual(['done']);
        expect(outputsFor({ type: 'parallel', config: { mode: 'odd' } }).map((o) => o.handle)).toEqual(['other']);
        // Unset field: the clause's `default` stands in for the value.
        expect(outputsFor({ type: 'parallel', config: {} }).map((o) => o.handle)).toEqual(['each', 'done']);
    });

    it('follows the rows of a key_value field as the user types them', () => {
        setNodeOutputSpecs([{
            handle: 'switch',
            outputs: {
                clauses: [{
                    outputs: [],
                    from: { field: 'cases', handle: 'key', label: 'value', label_fallback: 'handle' },
                    append: [{ handle: 'default', label: 'Otherwise' }],
                }],
            },
        }]);

        const outputs = outputsFor({ type: 'switch', config: { cases: { gold: 'Gold plan', '': 'no key', silver: '' } } });

        expect(outputs).toEqual([
            { handle: 'gold', label: 'Gold plan' },
            { handle: 'silver', label: 'silver' },
            { handle: 'default', label: 'Otherwise' },
        ]);
    });

    it('dedupes handles and marks the primary one', () => {
        setNodeOutputSpecs([{
            handle: 'loop',
            outputs: { primary: 'done', clauses: [{ outputs: ['loop', 'done', 'loop'] }] },
        }]);

        const outputs = outputsFor({ type: 'loop', config: {} });

        expect(outputs.map((o) => o.handle)).toEqual(['loop', 'done']);
        expect(outputs.find((o) => o.handle === 'done').primary).toBe(true);
        expect(outputs.find((o) => o.handle === 'loop').primary).toBeUndefined();
    });

    it('resolves an empty or malformed spec to no outputs without throwing', () => {
        expect(resolveOutputSpec(null)).toEqual([]);
        expect(resolveOutputSpec({ clauses: [] })).toEqual([]);
        expect(resolveOutputSpec({ clauses: 'nope' })).toEqual([]);
        expect(resolveOutputSpec({ clauses: [{ outputs: [null, 7, { handle: '' }] }] })).toEqual([{ handle: '7', label: '' }]);
    });

    it('falls back to the default output on a spec from a newer contract, and says so once per type', () => {
        const handler = vi.fn();
        onStaleOutputSpec(handler);
        setNodeOutputSpecs([{ handle: 'future', outputs: { version: OUTPUT_SPEC_VERSION + 1, clauses: [{ outputs: ['a', 'b'] }] } }]);

        const node = { type: 'future', config: {} };
        expect(outputsFor(node)).toEqual(DEFAULT);
        outputsFor(node);
        outputsFor(node);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toMatch(/version 2/);
        expect(handler.mock.calls[0][1]).toEqual({ type: 'future', version: 2, supported: OUTPUT_SPEC_VERSION });
    });

    it('reports again after the specs are re-registered', () => {
        const handler = vi.fn();
        onStaleOutputSpec(handler);
        const library = [{ handle: 'future', outputs: { version: 99, clauses: [] } }];

        setNodeOutputSpecs(library);
        outputsFor({ type: 'future' });
        setNodeOutputSpecs(library);
        outputsFor({ type: 'future' });

        expect(handler).toHaveBeenCalledTimes(2);
    });
});

describe('continuationOutput', () => {
    it('prefers the primary handle, then the first, then nothing', () => {
        setNodeOutputSpecs([
            { handle: 'loop', outputs: { primary: 'done', clauses: [{ outputs: ['loop', 'done'] }] } },
            { handle: 'branch', outputs: { clauses: [{ outputs: ['true', 'false'] }] } },
            { handle: 'stop', outputs: { clauses: [{ outputs: [] }] } },
        ]);

        expect(continuationOutput({ type: 'loop' })).toBe('done');
        expect(continuationOutput({ type: 'branch' })).toBe('true');
        expect(continuationOutput({ type: 'stop' })).toBeNull();
        expect(continuationOutput({ type: 'plain' })).toBe('default');
    });
});

describe('keyValueEntries', () => {
    it('accepts every shape a key_value field arrives in', () => {
        expect(keyValueEntries({ a: 1, b: 2 })).toEqual([['a', 1], ['b', 2]]);
        expect(keyValueEntries([{ key: 'a', value: 1 }, { handle: 'b', label: 2 }])).toEqual([['a', 1], ['b', 2]]);
        expect(keyValueEntries([['a', 1], ['b', 2]])).toEqual([['a', 1], ['b', 2]]);
        expect(keyValueEntries('{"a":1}')).toEqual([['a', 1]]);
    });

    it('degrades anything else to an empty list', () => {
        expect(keyValueEntries(null)).toEqual([]);
        expect(keyValueEntries('{not json')).toEqual([]);
        expect(keyValueEntries(42)).toEqual([]);
        expect(keyValueEntries([{ value: 'no key' }, 'stray'])).toEqual([]);
    });
});
