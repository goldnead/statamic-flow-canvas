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
    layoutScoped,
    scopeDoneRoute,
    scopeReturnPath,
    visibleScopeFrames,
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

describe('computeLayout options the frames use', () => {
    it('lays a graph out exactly as before without insets or gaps', () => {
        const { nodes, edges } = nestedLoops();
        expect(computeLayout(nodes, edges, { insets: {}, gaps: {} })).toEqual(computeLayout(nodes, edges));
    });

    it('keeps left and right room apart', () => {
        const nodes = [node('r'), node('a'), node('b')];
        const edges = [edge('r', 'a'), edge('r', 'b')];
        const plain = computeLayout(nodes, edges).positions;
        const wide = computeLayout(nodes, edges, { insets: { a: { left: 100, right: 300 } } }).positions;

        expect(wide.a.x - plain.a.x).toBe(100);
        expect(wide.b.x - plain.b.x).toBe(400);
    });

    it('takes the largest gap a row asks for', () => {
        const { nodes, edges } = simpleLoop();
        const plain = computeLayout(nodes, edges).positions;
        const tight = computeLayout(nodes, edges, { gaps: { b: 20 } }).positions;
        const gap = LAYOUT.ROW_HEIGHT - LAYOUT.NODE_HEIGHT;

        expect(tight.c.y - tight.b.y).toBe(LAYOUT.NODE_HEIGHT + 20);
        expect(tight.b.y).toBe(plain.b.y);
        expect(tight.d.y - tight.c.y).toBe(LAYOUT.NODE_HEIGHT + gap);
    });
});

/** The frames and the layout the canvas draws, for a graph and its folds. */
function drawn({ nodes, edges }, collapsed = [], options = {}) {
    const frames = computeScopeFrames(nodes, edges, SCOPES);
    const view = collapseScopes(nodes, edges, frames, collapsed);
    const shown = visibleScopeFrames(frames, view, collapsed);
    return { frames, view, shown, ...layoutScoped(view.nodes, view.edges, shown, options) };
}

const bottom = (r) => r.y + r.height;
const inside = (outer, inner) =>
    inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

describe('visibleScopeFrames', () => {
    it('keeps a folded frame, around its owner and the block', () => {
        const { shown, view } = drawn(simpleLoop(), ['l']);
        expect(shown).toHaveLength(1);
        expect(shown[0].collapsed).toBe(true);
        expect(shown[0].members).toEqual([view.blocks[0].id]);
        expect(shown[0].terminals).toEqual([view.blocks[0].id]);
        expect(shown[0].count).toBe(3);
    });

    it('drops a frame folded away inside a folded one', () => {
        const { shown } = drawn(nestedLoops(), ['o', 'i']);
        expect(shown.map((f) => f.id)).toEqual(['o']);
    });

    it('puts a folded inner block among the outer members', () => {
        const { shown } = drawn(nestedLoops(), ['i']);
        const outer = shown.find((f) => f.id === 'o');
        expect(outer.members).toContain(`${SCOPE_BLOCK_PREFIX}i`);
        expect(outer.members).not.toContain('br');
    });
});

describe('layoutScoped', () => {
    const box = (p, h = LAYOUT.NODE_HEIGHT) => ({ x: p.x, y: p.y, width: LAYOUT.NODE_WIDTH, height: h });

    it('makes the loop card the head of its frame', () => {
        const { positions, rects } = drawn(simpleLoop());
        const frame = rects.l;

        expect(positions.l.y - frame.y).toBe(SCOPE_FRAME.HEAD);
        expect(inside(frame, box(positions.l))).toBe(true);
        for (const k of ['b', 'c', 'd']) expect(inside(frame, box(positions[k]))).toBe(true);
        for (const k of ['t', 'a', 'e']) expect(inside(frame, box(positions[k]))).toBe(false);
    });

    it('lays out what follows the loop below the whole frame, never beside it', () => {
        const { positions, rects } = drawn(simpleLoop());
        expect(positions.e.y).toBe(bottom(rects.l) + SCOPE_FRAME.BELOW);
        // …straight under the loop card.
        expect(positions.e.x).toBe(positions.l.x);
    });

    it('does the same for a nested loop inside its outer body', () => {
        const { positions, rects } = drawn(nestedLoops());
        expect(positions.fin.y).toBe(bottom(rects.i) + SCOPE_FRAME.BELOW);
        expect(positions.report.y).toBe(bottom(rects.o) + SCOPE_FRAME.BELOW);
        expect(inside(rects.o, rects.i)).toBe(true);
        expect(inside(rects.o, box(positions.fin))).toBe(true);
    });

    it('packs a body with half the usual row gap, but not under a branch', () => {
        const { positions } = drawn(simpleLoop());
        expect(positions.c.y - positions.b.y).toBe(LAYOUT.NODE_HEIGHT + SCOPE_FRAME.BODY_GAP);

        const nested = drawn(nestedLoops(), [], { outputCount: (k) => (k === 'br' ? 2 : 1) }).positions;
        expect(nested.yes.y - nested.br.y).toBe(LAYOUT.ROW_HEIGHT);
    });

    it('starts the body straight under the loop card', () => {
        const { positions } = drawn(simpleLoop());
        expect(positions.b.x).toBe(positions.l.x);
        expect(positions.b.y - positions.l.y).toBe(LAYOUT.NODE_HEIGHT + SCOPE_FRAME.INTO);
    });

    it('holds an open "+" under the last card inside the frame', () => {
        const without = drawn(simpleLoop()).rects.l;
        const withAdder = drawn(simpleLoop(), [], { openKeys: new Set(['d']) }).rects.l;
        expect(withAdder.height - without.height).toBe(SCOPE_FRAME.ADDER_DROP);
    });

    it('keeps a neighbouring column clear of a frame', () => {
        // r splits into a loop and a plain step next to it.
        const nodes = [node('r', 'branch'), node('l', 'loop'), node('b'), node('x')];
        const edges = [edge('r', 'l', 'true'), edge('l', 'b', 'loop'), edge('r', 'x', 'false')];
        const { positions, rects } = drawn({ nodes, edges });
        expect(positions.x.x).toBeGreaterThanOrEqual(rects.l.x + rects.l.width + SCOPE_FRAME.DONE_LANE);
    });

    it('draws a folded loop as a small frame with the block inside', () => {
        const { positions, rects, view } = drawn(simpleLoop(), ['l']);
        const block = view.blocks[0].id;
        expect(inside(rects.l, box(positions[block], 60))).toBe(true);
        expect(positions.e.y).toBe(bottom(rects.l) + SCOPE_FRAME.BELOW);
    });

    it('survives two loops that hold each other', () => {
        const nodes = [node('x', 'loop'), node('y', 'loop'), node('s')];
        const edges = [edge('x', 'y', 'loop'), edge('y', 's', 'loop'), edge('s', 'x')];
        const { positions } = drawn({ nodes, edges });
        expect(Object.keys(positions).sort()).toEqual(['s', 'x', 'y']);
    });
});

describe('scopeReturnPath', () => {
    const rect = { x: -44, y: -36, width: 332, height: 900 };
    const owner = { x: 0, y: 0, width: 240, height: 140 };
    const lane = rect.x + SCOPE_FRAME.LANE_IN;

    it('runs inside its own frame, from the end card into the side of the loop', () => {
        const d = scopeReturnPath(rect, owner, { x: 0, y: 700, width: 240, height: 100 });

        expect(d.startsWith('M 0 750')).toBe(true);
        expect(d).toContain(`${lane} `);
        expect(lane).toBeGreaterThan(rect.x);
        expect(d.endsWith('L -4 70')).toBe(true);
    });

    it('takes the bottom lane, inside the frame, from a card that is not leftmost', () => {
        const d = scopeReturnPath(rect, owner, { x: 300, y: 500, width: 240, height: 140 });
        expect(d).toContain(`${bottom(rect) - SCOPE_FRAME.BOTTOM_LANE}`);
        expect(d.startsWith('M 300 570')).toBe(true);
    });

    it('leaves a nested frame where it is told to', () => {
        const d = scopeReturnPath(rect, owner, { x: 0, y: 300, width: 300, height: 400, anchorY: 672 });
        expect(d.startsWith('M 0 672')).toBe(true);
    });

    it('keeps an inner lane and an outer lane apart', () => {
        const outer = drawn(nestedLoops()).rects;
        expect(outer.i.x + SCOPE_FRAME.LANE_IN - (outer.o.x + SCOPE_FRAME.LANE_IN)).toBeGreaterThanOrEqual(SCOPE_FRAME.PAD_L);
    });
});

describe('scopeDoneRoute', () => {
    it('runs outside the frame and in under it', () => {
        const rect = { x: 0, y: 0, width: 300, height: 800 };
        const { path, pill, insert } = scopeDoneRoute(rect, { x: 260, y: 90 }, { x: 150, y: 912 });
        const laneX = 300 + SCOPE_FRAME.DONE_LANE;
        const turnY = 800 + SCOPE_FRAME.DONE_TURN;

        expect(path.startsWith('M 260 90')).toBe(true);
        expect(path).toContain(`${laneX} `);
        expect(path.endsWith('L 150 912')).toBe(true);
        expect(pill.y).toBe(turnY);
        expect(pill.y).toBeGreaterThan(bottom(rect));
        expect(insert).toEqual({ x: 150, y: Math.round((turnY + 912) / 2) });
    });
});
