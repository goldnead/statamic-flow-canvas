/**
 * `computeLayout()` turns a graph into positions and append points.
 *
 * The hosts store no coordinates: everything the user sees on the canvas is
 * derived here on every render. So a wrong number in this file is not a
 * cosmetic bug — it is two cards on top of each other, or a "+" that points
 * at the wrong handle.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    LAYOUT,
    computeLayout,
    fractionForOutput,
    handleY,
} from '../../resources/js/composables/useAutoLayout.js';
import { clearNodeOutputSpecs, setNodeOutputSpecs } from '../../resources/js/composables/useNodeOutputs.js';

const node = (key, type = 'step', config = {}) => ({ node_key: key, type, label: key, config });
const edge = (from, to, output = 'default') => ({ from_node_key: from, to_node_key: to, from_output: output });

// A two-way branch, declared the way a host's node library ships it.
const BRANCH_SPEC = {
    version: 1,
    clauses: [{ outputs: [{ handle: 'true', label: 'Yes' }, { handle: 'false', label: 'No' }] }],
};

beforeEach(() => setNodeOutputSpecs([{ handle: 'branch', outputs: BRANCH_SPEC }]));
afterEach(() => clearNodeOutputSpecs());

describe('computeLayout', () => {
    it('lays an empty graph out as nothing, not as an error', () => {
        expect(computeLayout([], [])).toEqual({ positions: {}, openOutputs: [], roots: [] });
    });

    it('stacks a chain one row apart in a single column', () => {
        const { positions, roots } = computeLayout(
            [node('a'), node('b'), node('c')],
            [edge('a', 'b'), edge('b', 'c')],
        );

        expect(roots).toEqual(['a']);
        expect([positions.a.y, positions.b.y, positions.c.y]).toEqual([0, LAYOUT.ROW_HEIGHT, 2 * LAYOUT.ROW_HEIGHT]);
        expect(new Set([positions.a.x, positions.b.x, positions.c.x]).size).toBe(1);
    });

    it('fans a branch into two columns and centres the parent over them', () => {
        const { positions } = computeLayout(
            [node('start'), node('if', 'branch'), node('yes'), node('no')],
            [edge('start', 'if'), edge('if', 'yes', 'true'), edge('if', 'no', 'false')],
        );

        // Declared order decides the column: `true` left, `false` right.
        expect(positions.no.x - positions.yes.x).toBe(LAYOUT.COLUMN_SPAN);
        expect(positions.if.x).toBe((positions.yes.x + positions.no.x) / 2);
        expect(positions.start.x).toBe(positions.if.x);
        expect(positions.yes.y).toBe(positions.no.y);
    });

    it('reports every handle without an edge as an append point, with its label', () => {
        const { openOutputs } = computeLayout(
            [node('if', 'branch'), node('yes')],
            [edge('if', 'yes', 'true')],
        );

        expect(openOutputs).toEqual([
            { from_node_key: 'if', from_output: 'false', label: 'No' },
            { from_node_key: 'yes', from_output: 'default', label: '' },
        ]);
    });

    it('gives a row exactly the height of its tallest card and leaves the other rows alone', () => {
        const nodes = [node('a'), node('b'), node('c')];
        const edges = [edge('a', 'b'), edge('b', 'c')];
        const gap = LAYOUT.ROW_HEIGHT - LAYOUT.NODE_HEIGHT;

        // One card at depth 1 measured taller than the standard card.
        const { positions } = computeLayout(nodes, edges, { nodeHeights: { b: LAYOUT.NODE_HEIGHT + 120 } });

        expect(positions.a.y).toBe(0);
        expect(positions.b.y).toBe(LAYOUT.ROW_HEIGHT);
        expect(positions.c.y).toBe(LAYOUT.ROW_HEIGHT + LAYOUT.NODE_HEIGHT + 120 + gap);

        // A card measured shorter than the standard never pulls a row closer.
        const short = computeLayout(nodes, edges, { nodeHeights: { a: 40 } });
        expect(short.positions.b.y).toBe(LAYOUT.ROW_HEIGHT);
    });

    it('takes a custom row height when the cards carry thumbnails', () => {
        const rowHeight = LAYOUT.ROW_HEIGHT + LAYOUT.THUMB_HEIGHT;
        const { positions } = computeLayout([node('a'), node('b')], [edge('a', 'b')], { rowHeight });

        expect(positions.b.y - positions.a.y).toBe(rowHeight);
    });

    it('ignores edges that point at nodes which are not on the canvas', () => {
        const { positions, roots, openOutputs } = computeLayout(
            [node('a')],
            [edge('a', 'ghost'), edge('ghost', 'a')],
        );

        expect(roots).toEqual(['a']);
        expect(positions).toEqual({ a: { x: 0, y: 0 } });
        // The dangling edge still occupies the handle: no "+" is drawn there.
        expect(openOutputs).toEqual([]);
    });

    it('terminates on a cycle, takes the first node as the root and still stacks the rest', () => {
        const { positions, roots } = computeLayout(
            [node('a'), node('b'), node('c')],
            [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
        );

        expect(roots).toEqual(['a']);
        expect([positions.a.y, positions.b.y, positions.c.y]).toEqual([0, LAYOUT.ROW_HEIGHT, 2 * LAYOUT.ROW_HEIGHT]);
    });

    it('keeps disconnected roots apart', () => {
        const { positions, roots } = computeLayout([node('a'), node('b')], []);

        expect(roots).toEqual(['a', 'b']);
        expect(positions.a.y).toBe(positions.b.y);
        expect(positions.b.x - positions.a.x).toBeGreaterThanOrEqual(LAYOUT.COLUMN_SPAN);
    });
});

describe('handle positions', () => {
    it('spreads handles evenly and falls back to the centre', () => {
        expect(handleY(0, 1)).toBe(0.5);
        expect(handleY(0, 2)).toBeCloseTo(1 / 3);
        expect(handleY(1, 2)).toBeCloseTo(2 / 3);
        expect(handleY(0, 0)).toBe(0.5);
    });

    it('puts the adder where the dot is, for every output a node has', () => {
        const branch = node('if', 'branch');

        expect(fractionForOutput(branch, 'true')).toBeCloseTo(1 / 3);
        expect(fractionForOutput(branch, 'false')).toBeCloseTo(2 / 3);
        // An output the node does not have lands in the middle, never off-card.
        expect(fractionForOutput(branch, 'maybe')).toBe(0.5);
        expect(fractionForOutput(node('plain'), 'default')).toBe(0.5);
    });
});
