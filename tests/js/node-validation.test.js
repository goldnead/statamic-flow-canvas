/**
 * Live validation and key-value rows: the pure halves of the config panel.
 */
import { describe, expect, it } from 'vitest';
import {
    computeNodeIssues,
    defaultConfigForSchema,
    missingRequiredHandles,
    schemaFor,
} from '../../resources/js/composables/useNodeValidation.js';
import { duplicateKeyIndices, rowsToObject, toRows } from '../../resources/js/composables/useKeyValueRows.js';

const LIBRARY = {
    actions: [{
        handle: 'send_email',
        schema: [
            { handle: 'to', required: true },
            { handle: 'subject', required: true },
            { handle: 'delay_unit', required: true, default: 'minutes' },
            { handle: 'cc' },
        ],
    }],
    pages: [{ handle: 'page', schema: [{ handle: 'entry', required: true }] }],
};

describe('node validation', () => {
    it('finds a node schema in any group of the library', () => {
        expect(schemaFor({ type: 'page' }, LIBRARY)).toHaveLength(1);
        expect(schemaFor({ type: 'nope' }, LIBRARY)).toEqual([]);
        expect(schemaFor(null, LIBRARY)).toEqual([]);
    });

    it('treats empty string and null as missing, but not an empty list or zero', () => {
        const node = { node_key: 'n1', type: 'send_email', config: { to: '', subject: null, delay_unit: [], cc: 'x' } };

        expect(missingRequiredHandles(node, LIBRARY)).toEqual(['to', 'subject']);
        expect(missingRequiredHandles({ ...node, config: { to: 0, subject: 's', delay_unit: 'h' } }, LIBRARY)).toEqual([]);
    });

    it('seeds the starting config from schema defaults only', () => {
        expect(defaultConfigForSchema(LIBRARY.actions[0].schema)).toEqual({ delay_unit: 'minutes' });
        expect(defaultConfigForSchema([{ handle: 'x', default: null }, { default: 'no handle' }])).toEqual({});
    });

    it('shapes issues like the server so the two lists can be merged', () => {
        const issues = computeNodeIssues([
            { node_key: 'n1', type: 'send_email', config: { to: 'a@b.c' } },
            { node_key: 'n2', type: 'page', config: { entry: 'home' } },
        ], LIBRARY);

        expect(issues.map((i) => [i.node_key, i.field])).toEqual([['n1', 'subject'], ['n1', 'delay_unit']]);
        expect(issues[0]).toMatchObject({ code: 'missing_required_config', level: 'error' });
    });
});

describe('key-value rows', () => {
    it('round-trips a map through rows and back', () => {
        const rows = toRows({ a: '1', b: '2' });

        expect(rows.map((r) => [r.key, r.value])).toEqual([['a', '1'], ['b', '2']]);
        expect(rowsToObject(rows)).toEqual({ a: '1', b: '2' });
    });

    it('drops empty keys on the way out and lets the last duplicate win', () => {
        const rows = toRows([['', 'ignored'], ['k', 'first'], ['k', 'second']]);

        expect(rowsToObject(rows)).toEqual({ k: 'second' });
    });

    it('flags only the later rows that collide with an earlier key', () => {
        const rows = toRows([['a', 1], ['b', 2], ['a', 3], ['', 4], ['', 5], ['b', 6]]);

        expect(duplicateKeyIndices(rows)).toEqual([2, 5]);
    });

    it('never throws on a half-typed JSON string', () => {
        expect(toRows('{"a":')).toEqual([]);
        expect(toRows('   ')).toEqual([]);
        expect(toRows('{"a":"1"}').map((r) => r.key)).toEqual(['a']);
    });
});
