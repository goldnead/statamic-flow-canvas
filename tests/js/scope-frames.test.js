/**
 * Scope frames: which nodes form a loop body, where it ends, how bodies nest,
 * what a folded body leaves behind, and the geometry the canvas draws.
 *
 * Everything here is derived on every render and never saved, so a wrong
 * answer is a frame around the wrong cards or a line back to the wrong node.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    SCOPE_BLOCK_PREFIX,
    SCOPE_BLOCK_TYPE,
    SCOPE_FRAME,
    collapseScopes,
    computeScopeFrames,
    scopeFrameRects,
    scopeLayoutInsets,
    scopeReturnPath,
} from '../../resources/js/composables/useScopeFrames.js';
import { LAYOUT, computeLayout } from '../../resources/js/composables/useAutoLayout.js';
import { clearNodeOutputSpecs, setNodeOutputSpecs } from '../../resources/js/composables/useNodeOutputs.js';

const node = (key, type = 'step') => ({ node_key: key, type, label: key, config: {} });
const edge = (from, to, output = 'default') => ({ from_node_key: from, to_node_key: to, from_output: output });

const SCOPES = { loop: { output: 'loop', continuation: 'done' } };

const LOOP_SPEC = {
    version: 1,
    clauses: [{ outputs: [{ handle: 'loop', label: 'For each item' }, { handle: 'done', label: 'After loop' }] }],
    primary: 'done',
};
const BRANCH_SPEC = {
    version: 1,
    clauses: [{ outputs: [{ handle: 'true', label: 'Yes' }, { handle: 'false', label: 'No' }] }],
};

beforeEach(() => setNodeOutputSpecs([
    { handle: 'loop', outputs: LOOP_SPEC },
    { handle: 'branch', outputs: BRANCH_SPEC },
]));
afterEach(() => clearNodeOutputSpecs());

/** trigger → a → loop ⟳ [b → c → d], done → e */
function simpleLoop() {
    return {
        nodes: [node('t'), node('a'), node('l', 'loop'), node('b'), node('c'), node('d'), node('e')],
        edges: [
            edge('t', 'a'),
            edge('a', 'l'),
            edge('l', 'b', 'loop'),
            edge('b', 'c'),
            edge('c', 'd'),
            edge('l', 'e', 'done'),
        ],
    };
}

/**
 * Outer loop over choirs, inner loop over members with a branch inside:
 *   o ⟳ [ log → i ⟳ [ br → yes | no ], i done → fin ], o done → report
 */
function nestedLoops() {
    return {
        nodes: [
            node('start'), node('o', 'loop'), node('log'), node('i', 'loop'),
            node('br', 'branch'), node('yes'), node('no'), node('fin'), node('report'),
        ],
        edges: [
            edge('start', 'o'),
            edge('o', 'log', 'loop'),
            edge('log', 'i'),
            edge('i', 'br', 'loop'),
            edge('br', 'yes', 'true'),
            edge('br', 'no', 'false'),
            edge('i', 'fin', 'done'),
            edge('o', 'report', 'done'),
        ],
    };
}

describe('computeScopeFrames', () => {
    it('finds nothing when the host declares no scopes', () => {
        const { nodes, edges } = simpleLoop();
        expect(computeScopeFrames(nodes, edges, {})).toEqual([]);
        expect(computeScopeFrames(nodes, edges)).toEqual([]);
    });

    it('takes the body from the loop output and stops before the continuation', () => {
        const { nodes, edges } = simpleLoop();
        const [frame] = computeScopeFrames(nodes, edges, SCOPES);

        expect(frame.id).toBe('l');
        expect(frame.owner).toBe('l');
        expect(frame.entries).toEqual(['b']);
        expect(frame.members).toEqual(['b', 'c', 'd']);
        expect(frame.members).not.toContain('e');
        expect(frame.terminals).toEqual(['d']);
        expect(frame.parent).toBeNull();
        expect(frame.depth).toBe(0);
    });

    it('draws no frame for a loop with nothing on its body output', () => {
        const nodes = [node('l', 'loop'), node('e')];
        const edges = [edge('l', 'e', 'done')];
        expect(computeScopeFrames(nodes, edges, SCOPES)).toEqual([]);
    });

    it('ends the body where a body path runs into the flow after the loop', () => {
        // b → c, and c also leads into e, which is where `done` goes.
        const { nodes, edges } = simpleLoop();
        edges.push(edge('c', 'e'));
        const [frame] = computeScopeFrames(nodes, edges, SCOPES);

        expect(frame.members).toEqual(['b', 'c', 'd']);
        expect(frame.members).not.toContain('e');
    });

    it('finds every end of a branching body', () => {
        const nodes = [node('l', 'loop'), node('br', 'branch'), node('y'), node('n'), node('n2')];
        const edges = [
            edge('l', 'br', 'loop'),
            edge('br', 'y', 'true'),
            edge('br', 'n', 'false'),
            edge('n', 'n2'),
        ];
        const [frame] = computeScopeFrames(nodes, edges, SCOPES);

        expect(frame.members.sort()).toEqual(['br', 'n', 'n2', 'y']);
        expect(frame.terminals.sort()).toEqual(['n2', 'y']);
    });

    it('nests an inner loop inside the outer one, outermost first', () => {
        const { nodes, edges } = nestedLoops();
        const frames = computeScopeFrames(nodes, edges, SCOPES);

        expect(frames.map((f) => f.id)).toEqual(['o', 'i']);
        const [outer, inner] = frames;

        expect(outer.members.sort()).toEqual(['br', 'fin', 'i', 'log', 'no', 'yes']);
        expect(inner.members.sort()).toEqual(['br', 'no', 'yes']);
        expect(inner.parent).toBe('o');
        expect(inner.depth).toBe(1);
        expect(outer.depth).toBe(0);
    });

    it('sends the ends of an inner body back to the inner loop, not the outer one', () => {
        const [outer, inner] = computeScopeFrames(...Object.values(nestedLoops()), SCOPES);

        expect(inner.terminals.sort()).toEqual(['no', 'yes']);
        // The outer body ends after the inner loop's continuation…
        expect(outer.terminals).toEqual(['fin']);
    });

    it('counts an inner loop with no continuation as the end of the outer body', () => {
        const { nodes, edges } = nestedLoops();
        const withoutFin = edges.filter((e) => e.to_node_key !== 'fin');
        const [outer] = computeScopeFrames(nodes.filter((n) => n.node_key !== 'fin'), withoutFin, SCOPES);

        expect(outer.terminals).toEqual(['i']);
    });

    it('survives a hand-wired edge back into the loop without looping forever', () => {
        const { nodes, edges } = simpleLoop();
        edges.push(edge('d', 'l'));
        const [frame] = computeScopeFrames(nodes, edges, SCOPES);

        expect(frame.members).toEqual(['b', 'c', 'd']);
        expect(frame.members).not.toContain('l');
        // d already shows its way back; no second, drawn one.
        expect(frame.terminals).toEqual([]);
    });

    it('survives a cycle inside the body', () => {
        const { nodes, edges } = simpleLoop();
        edges.push(edge('d', 'b'));
        const [frame] = computeScopeFrames(nodes, edges, SCOPES);

        expect(frame.members).toEqual(['b', 'c', 'd']);
        expect(frame.terminals).toEqual([]);
    });

    it('survives two loops that hold each other', () => {
        const nodes = [node('x', 'loop'), node('y', 'loop'), node('s')];
        const edges = [edge('x', 'y', 'loop'), edge('y', 's', 'loop'), edge('s', 'x')];
        const frames = computeScopeFrames(nodes, edges, SCOPES);

        expect(frames).toHaveLength(2);
        const depths = frames.map((f) => f.depth);
        expect(Math.max(...depths)).toBeLessThanOrEqual(1);
        // Exactly one of them is the parent of the other, never both.
        expect(frames.filter((f) => f.parent !== null)).toHaveLength(1);
    });

    it('ignores edges to nodes that do not exist', () => {
        const { nodes, edges } = simpleLoop();
        edges.push(edge('d', 'ghost'));
        const [frame] = computeScopeFrames(nodes, edges, SCOPES);
        expect(frame.members).toEqual(['b', 'c', 'd']);
        expect(frame.terminals).toEqual(['d']);
    });
});

describe('collapseScopes', () => {
    it('changes nothing when nothing is folded', () => {
        const { nodes, edges } = simpleLoop();
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        const view = collapseScopes(nodes, edges, frames, []);

        expect(view.nodes).toBe(nodes);
        expect(view.edges).toBe(edges);
        expect(view.blocks).toEqual([]);
    });

    it('replaces a folded body with one block on the loop output', () => {
        const { nodes, edges } = simpleLoop();
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        const view = collapseScopes(nodes, edges, frames, ['l']);
        const blockId = `${SCOPE_BLOCK_PREFIX}l`;

        expect(view.nodes.map((n) => n.node_key)).toEqual(['t', 'a', 'l', 'e', blockId]);
        expect(view.nodes.at(-1).type).toBe(SCOPE_BLOCK_TYPE);
        expect([...view.hidden].sort()).toEqual(['b', 'c', 'd']);
        expect(view.edges).toContainEqual(expect.objectContaining({ from_node_key: 'l', from_output: 'loop', to_node_key: blockId }));
        expect(view.edges).toContainEqual(expect.objectContaining({ from_node_key: 'l', from_output: 'done', to_node_key: 'e' }));
        expect(view.edges.some((e) => ['b', 'c', 'd'].includes(e.to_node_key) || ['b', 'c', 'd'].includes(e.from_node_key))).toBe(false);
    });

    it('does not touch the saved graph it was given', () => {
        const { nodes, edges } = simpleLoop();
        const before = JSON.stringify({ nodes, edges });
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        collapseScopes(nodes, edges, frames, ['l']);
        expect(JSON.stringify({ nodes, edges })).toBe(before);
    });

    it('reroutes an edge that leaves the body onto the block', () => {
        const nodes = [node('l', 'loop'), node('b'), node('x')];
        const edges = [edge('l', 'b', 'loop'), edge('b', 'x', 'default')];
        // x is not on `done`, so it is part of the body; make it leave by
        // wiring done to it as well.
        edges.push(edge('l', 'x', 'done'));
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        const view = collapseScopes(nodes, edges, frames, ['l']);

        expect(view.edges).toContainEqual(expect.objectContaining({ from_node_key: `${SCOPE_BLOCK_PREFIX}l`, to_node_key: 'x' }));
    });

    it('folds an outer body over a folded inner one as a single block', () => {
        const { nodes, edges } = nestedLoops();
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        const view = collapseScopes(nodes, edges, frames, ['o', 'i']);

        expect(view.blocks.map((b) => b.id)).toEqual([`${SCOPE_BLOCK_PREFIX}o`]);
        expect(view.hidden.has('i')).toBe(true);
    });

    it('folds only the inner body when only it is folded', () => {
        const { nodes, edges } = nestedLoops();
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        const view = collapseScopes(nodes, edges, frames, ['i']);

        expect(view.blocks.map((b) => b.id)).toEqual([`${SCOPE_BLOCK_PREFIX}i`]);
        expect([...view.hidden].sort()).toEqual(['br', 'no', 'yes']);
        expect(view.nodes.map((n) => n.node_key)).toContain('fin');
    });
});

describe('layout with frames', () => {
    it('leaves room above a body and around its column', () => {
        const { nodes, edges } = simpleLoop();
        const frames = computeScopeFrames(nodes, edges, SCOPES);
        const insets = scopeLayoutInsets(frames);

        expect(insets).toEqual({ b: { x: SCOPE_FRAME.INSET_X, top: SCOPE_FRAME.INSET_TOP } });

        const plain = computeLayout(nodes, edges);
        const framed = computeLayout(nodes, edges, { insets });

        // Loop and everything above it stay where they were.
        expect(framed.positions.l.y).toBe(plain.positions.l.y);
        // The body's first row moves down by the room for the title bar.
        expect(framed.positions.b.y - plain.positions.b.y).toBe(SCOPE_FRAME.INSET_TOP);
        // The column after the body moves right by the room on both sides.
        expect(framed.positions.e.x - plain.positions.e.x).toBe(2 * SCOPE_FRAME.INSET_X);
    });

    it('lays a graph out exactly as before without insets', () => {
        const { nodes, edges } = nestedLoops();
        expect(computeLayout(nodes, edges, { insets: {} })).toEqual(computeLayout(nodes, edges));
    });

    it('adds up the room for nested bodies', () => {
        const frames = computeScopeFrames(...Object.values(nestedLoops()), SCOPES);
        const insets = scopeLayoutInsets(frames);
        expect(insets.log).toEqual({ x: SCOPE_FRAME.INSET_X, top: SCOPE_FRAME.INSET_TOP });
        expect(insets.br).toEqual({ x: SCOPE_FRAME.INSET_X, top: SCOPE_FRAME.INSET_TOP });
    });
});

describe('scopeFrameRects', () => {
    const box = (x, y, width = LAYOUT.NODE_WIDTH, height = LAYOUT.NODE_HEIGHT) => ({ x, y, width, height });

    it('wraps the body cards and leaves room for the title bar', () => {
        const frames = computeScopeFrames(...Object.values(simpleLoop()), SCOPES);
        const boxes = { l: box(0, 0), b: box(0, 300), c: box(0, 500), d: box(0, 700), e: box(400, 300) };
        const { l } = scopeFrameRects(frames, boxes);

        expect(l.x).toBe(-SCOPE_FRAME.PAD_X);
        expect(l.y).toBe(300 - SCOPE_FRAME.TITLE_HEIGHT - SCOPE_FRAME.TITLE_GAP);
        expect(l.width).toBe(LAYOUT.NODE_WIDTH + 2 * SCOPE_FRAME.PAD_X);
        expect(l.y + l.height).toBe(700 + LAYOUT.NODE_HEIGHT + SCOPE_FRAME.PAD_BOTTOM);
        // The owner and the continuation stay outside.
        expect(l.y).toBeGreaterThan(LAYOUT.NODE_HEIGHT);
        expect(l.x + l.width).toBeLessThan(400);
    });

    it('holds the "+" hanging under the last card', () => {
        const frames = computeScopeFrames(...Object.values(simpleLoop()), SCOPES);
        const boxes = { l: box(0, 0), b: box(0, 300), c: box(0, 500), d: box(0, 700) };
        const extras = { d: [{ x: 102, y: 850, width: 36, height: 36 }] };
        const { l } = scopeFrameRects(frames, boxes, { extras });
        expect(l.y + l.height).toBe(886 + SCOPE_FRAME.PAD_BOTTOM);
    });

    it('wraps an inner frame and its return lane inside the outer one', () => {
        const frames = computeScopeFrames(...Object.values(nestedLoops()), SCOPES);
        const boxes = {
            o: box(0, 0), log: box(0, 300), i: box(0, 500),
            br: box(0, 800), yes: box(-160, 1000), no: box(160, 1000),
            fin: box(400, 800), report: box(800, 300),
        };
        const rects = scopeFrameRects(frames, boxes);
        const { o, i } = rects;

        expect(o.x).toBeLessThanOrEqual(i.x - SCOPE_FRAME.LANE - SCOPE_FRAME.PAD_X);
        expect(o.y).toBeLessThan(i.y);
        expect(o.y + o.height).toBeGreaterThan(i.y + i.height);
        expect(o.x + o.width).toBeGreaterThanOrEqual(400 + LAYOUT.NODE_WIDTH);
    });

    it('draws no frame for a folded body', () => {
        const frames = computeScopeFrames(...Object.values(simpleLoop()), SCOPES);
        const boxes = { l: box(0, 0), b: box(0, 300), c: box(0, 500), d: box(0, 700) };
        expect(scopeFrameRects(frames, boxes, { collapsed: ['l'] })).toEqual({});
    });
});

describe('scopeReturnPath', () => {
    const rect = { x: -20, y: 250, width: 280, height: 600 };
    const owner = { x: 0, y: 0, width: 240, height: 140 };

    it('runs from the end card, outside the frame, into the side of the loop', () => {
        const d = scopeReturnPath(rect, owner, { x: 0, y: 700, width: 240, height: 100 });
        const lane = rect.x - SCOPE_FRAME.LANE;

        expect(d.startsWith('M 0 750')).toBe(true);
        expect(d).toContain(`${lane} `);
        expect(d.endsWith('L -2 70')).toBe(true);
    });

    it('takes the bottom lane from a card that is not in the leftmost column', () => {
        const d = scopeReturnPath(rect, owner, { x: 300, y: 500, width: 240, height: 140 });
        const bottom = rect.y + rect.height - SCOPE_FRAME.PAD_BOTTOM / 2;
        expect(d).toContain(`${bottom}`);
        expect(d.startsWith('M 300 570')).toBe(true);
    });
});
