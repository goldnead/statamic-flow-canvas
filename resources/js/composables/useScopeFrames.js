/**
 * Scope frames: the body of a loop, drawn as one thing.
 *
 * A host's graph may have nodes whose one output does not continue the flow
 * but opens a body that runs repeatedly — an automation's Loop runs the nodes
 * behind its `loop` output once per item and then carries on through `done`.
 * The data model has no loop-back edge on purpose, so on a plain canvas the
 * body is just a long chain hanging under the node, and nothing says where it
 * ends or that it comes back.
 *
 * This module works out, from the graph alone, which nodes form such a body,
 * which of them end it, and how bodies nest. The canvas draws a frame around
 * each body, a dashed line from its ends back to the owner, and can fold the
 * whole body into one block. None of it is saved: the frames are derived on
 * every render, exactly like the positions in `useAutoLayout.js`.
 *
 * Which nodes open a body is the host's to say, as data — this package knows
 * no node type by name:
 *
 *     { loop: { output: 'loop', continuation: 'done' } }
 *
 * Pure and framework-free, like the layout, so it is unit-testable.
 */

import { LAYOUT, computeLayout } from './useAutoLayout.js';

/** Ids of the synthetic nodes the canvas adds for scopes. Never saved. */
export const SCOPE_FRAME_PREFIX = '__frame__';
export const SCOPE_BLOCK_PREFIX = '__block__';

/** The node type a folded body is laid out as. Unknown to every host. */
export const SCOPE_BLOCK_TYPE = '__scope_block__';

/** A framed loop, laid out as one wide node by the outer layout. */
export const SCOPE_UNIT_PREFIX = '__unit__';
const SCOPE_UNIT_TYPE = '__scope_unit__';

/**
 * Geometry of a frame, in flow coordinates.
 *
 * The owner (the Loop card) is the frame's head: the frame starts just above
 * it, the body hangs below it, and whatever follows the loop is laid out
 * underneath the whole frame.
 */
export const SCOPE_FRAME = {
    HEAD: 36, // frame top to the owner card: the strip with the fold button
    PAD_L: 44, // frame edge to the leftmost card; the way back runs in here
    // Frame edge to the rightmost card. Wider than the continuation's lane
    // (DONE_LANE), so a nested loop's continuation runs well inside the frame
    // around it rather than on its border.
    PAD_R: 48,
    PAD_BOTTOM: 36, // below the lowest card or "+"; the bottom lane runs in here
    INTO: 92, // owner card to the first body row: the pill, then the "+"
    BODY_GAP: 40, // row gap inside a body, half the canvas's usual one
    LANE_IN: 20, // the way back's lane, from the frame's left edge
    BOTTOM_LANE: 16, // the bottom lane, from the frame's bottom edge
    ADDER_DROP: 34, // an open output's "+" below its card (10 gap + 24 button)
    DONE_LANE: 24, // the continuation's lane, outside the frame's right edge
    DONE_TURN: 30, // below the frame, where the continuation turns in
    BELOW: 112, // frame bottom to the step after the loop
    DONE_ADDER: 60, // frame bottom to an open continuation's "+"
};

function edgeList(nodes, edges) {
    const known = new Set(nodes.map((n) => n.node_key));
    const out = new Map();
    for (const e of edges ?? []) {
        if (!known.has(e.from_node_key) || !known.has(e.to_node_key)) continue;
        if (!out.has(e.from_node_key)) out.set(e.from_node_key, []);
        out.get(e.from_node_key).push({ to: e.to_node_key, output: e.from_output || 'default' });
    }
    return out;
}

function targets(out, key, output) {
    return (out.get(key) ?? []).filter((e) => e.output === output).map((e) => e.to);
}

/** Breadth-first from `starts`, never entering a key in `blocked`. */
function reach(out, starts, blocked) {
    const seen = new Set();
    const order = [];
    const queue = starts.filter((k) => !blocked.has(k));
    while (queue.length) {
        const key = queue.shift();
        if (seen.has(key) || blocked.has(key)) continue;
        seen.add(key);
        order.push(key);
        for (const e of out.get(key) ?? []) {
            if (!seen.has(e.to) && !blocked.has(e.to)) queue.push(e.to);
        }
    }
    return order;
}

/**
 * Every scope body in the graph.
 *
 * A body is what can be reached from the owner's body output, stopping at the
 * owner itself (a hand-wired edge back into a loop must not make the loop its
 * own member, and a cycle must not run forever) and at anything that is also
 * reached from the owner's continuation: where a body path runs into the flow
 * after the loop, the body has ended.
 *
 * @param {Array}  nodes   [{ node_key, type, label, ... }]
 * @param {Array}  edges   [{ from_node_key, from_output, to_node_key }]
 * @param {Object} scopes  type → { output, continuation? }
 * @returns {Array<{
 *   id: string, owner: string, output: string,
 *   entries: string[], members: string[], terminals: string[],
 *   parent: string|null, depth: number,
 * }>} outermost first; `members` includes the members of nested bodies.
 */
export function computeScopeFrames(nodes = [], edges = [], scopes = {}) {
    if (!nodes.length || !scopes || !Object.keys(scopes).length) return [];

    const out = edgeList(nodes, edges);
    const frames = [];

    for (const n of nodes) {
        const scope = scopes[n.type];
        if (!scope) continue;

        const output = scope.output ?? 'loop';
        const entries = targets(out, n.node_key, output).filter((k) => k !== n.node_key);
        if (!entries.length) continue;

        const owner = new Set([n.node_key]);
        const after = scope.continuation
            ? new Set(reach(out, targets(out, n.node_key, scope.continuation), owner))
            : new Set();
        const members = reach(out, entries, new Set([...owner, ...after]));
        if (!members.length) continue;

        const inBody = new Set(members);
        frames.push({
            id: n.node_key,
            owner: n.node_key,
            output,
            entries: entries.filter((k) => inBody.has(k)),
            members,
            terminals: [],
            parent: null,
            depth: 0,
        });
    }

    // Nesting: a frame's parent is the smallest other frame holding its owner.
    // In a cyclic hand-wired graph two frames can hold each other's owners;
    // the larger one is then the parent, so the chain always ends.
    const byId = new Map(frames.map((f) => [f.id, f]));
    for (const f of frames) {
        let best = null;
        for (const g of frames) {
            if (g === f || !g.members.includes(f.owner)) continue;
            const mutual = f.members.includes(g.owner);
            if (mutual && (g.members.length < f.members.length || (g.members.length === f.members.length && g.id > f.id))) continue;
            if (!best || g.members.length < best.members.length) best = g;
        }
        f.parent = best ? best.id : null;
    }
    for (const f of frames) {
        let depth = 0;
        const seen = new Set([f.id]);
        let p = f.parent ? byId.get(f.parent) : null;
        while (p && !seen.has(p.id)) {
            seen.add(p.id);
            depth++;
            p = p.parent ? byId.get(p.parent) : null;
        }
        f.depth = depth;
    }

    // Where a body ends. A step ends it when nothing inside the body follows
    // it — but a step inside a nested body goes back to the nested owner, not
    // to this one, and the nested owner's own body output is not a way on.
    // So the ends are looked for among this frame's own steps, with a nested
    // owner counting as a step whose continuation leads nowhere in the body.
    // A step wired back to the owner by hand already shows its way back and
    // gets no drawn line on top.
    for (const f of frames) {
        const inBody = new Set(f.members);
        const nested = frames.filter((g) => g !== f && isInside(g, f, byId));
        const innerSteps = new Set(nested.flatMap((g) => g.members));
        const nestedOutput = new Map(nested.map((g) => [g.owner, g.output]));

        f.terminals = f.members.filter((key) => {
            if (innerSteps.has(key)) return false;
            const next = (out.get(key) ?? []).filter((e) => e.output !== nestedOutput.get(key));
            if (next.some((e) => e.to === f.owner)) return false;
            return !next.some((e) => inBody.has(e.to));
        });
    }

    return frames.sort((a, b) => a.depth - b.depth);
}

/** Whether frame `g` sits somewhere inside frame `f`. */
function isInside(g, f, byId) {
    const seen = new Set();
    let p = g.parent ? byId.get(g.parent) : null;
    while (p && !seen.has(p.id)) {
        if (p.id === f.id) return true;
        seen.add(p.id);
        p = p.parent ? byId.get(p.parent) : null;
    }
    return false;
}

/**
 * The graph as it is drawn with some bodies folded.
 *
 * A folded body leaves one synthetic block in its place: the owner's body
 * output leads to it, an edge from outside into the body lands on it, and an
 * edge from the body to outside leaves from it. A fold inside a folded body
 * changes nothing further — the outer block already hides it.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Array} frames     from computeScopeFrames()
 * @param {Iterable<string>} collapsed  frame ids
 * @returns {{ nodes: Array, edges: Array, hidden: Set<string>, blocks: Array<{ id: string, frame: object }> }}
 */
export function collapseScopes(nodes = [], edges = [], frames = [], collapsed = []) {
    const folded = new Set(collapsed);
    const byId = new Map(frames.map((f) => [f.id, f]));
    const hidden = new Set();
    const blocks = [];
    const blockOf = new Map(); // hidden key → block id

    for (const f of frames) {
        if (!folded.has(f.id)) continue;
        // Only the outermost fold counts; one inside it is hidden with it.
        let p = f.parent ? byId.get(f.parent) : null;
        let insideFold = false;
        const seen = new Set();
        while (p && !seen.has(p.id)) {
            seen.add(p.id);
            if (folded.has(p.id)) insideFold = true;
            p = p.parent ? byId.get(p.parent) : null;
        }
        if (insideFold || hidden.has(f.owner)) continue;

        const id = `${SCOPE_BLOCK_PREFIX}${f.id}`;
        blocks.push({ id, frame: f });
        for (const key of f.members) {
            hidden.add(key);
            blockOf.set(key, id);
        }
    }

    if (!blocks.length) return { nodes, edges, hidden, blocks };

    const visibleNodes = nodes.filter((n) => !hidden.has(n.node_key));
    for (const b of blocks) {
        visibleNodes.push({ node_key: b.id, type: SCOPE_BLOCK_TYPE, label: '', config: {} });
    }

    const seen = new Set();
    const visibleEdges = [];
    const push = (e) => {
        const sig = `${e.from_node_key}::${e.from_output || 'default'}::${e.to_node_key}`;
        if (seen.has(sig) || e.from_node_key === e.to_node_key) return;
        seen.add(sig);
        visibleEdges.push(e);
    };

    for (const b of blocks) {
        push({ from_node_key: b.frame.owner, from_output: b.frame.output, to_node_key: b.id, synthetic: true });
    }

    for (const e of edges) {
        const fromBlock = blockOf.get(e.from_node_key);
        const toBlock = blockOf.get(e.to_node_key);
        if (!fromBlock && !toBlock) {
            push(e);
            continue;
        }
        if (fromBlock && toBlock) continue; // inside one body (or between two folded ones)
        if (toBlock) {
            const block = blocks.find((b) => b.id === toBlock);
            // The owner's own body edge is already drawn to the block.
            if (e.from_node_key === block.frame.owner) continue;
            push({ ...e, to_node_key: toBlock, synthetic: true });
            continue;
        }
        const block = blocks.find((b) => b.id === fromBlock);
        if (e.to_node_key === block.frame.owner) continue; // a hand-wired way back
        push({ from_node_key: fromBlock, from_output: 'default', to_node_key: e.to_node_key, synthetic: true });
    }

    return { nodes: visibleNodes, edges: visibleEdges, hidden, blocks };
}

/**
 * The frames as they are drawn with some bodies folded: which frames are
 * visible at all, and which cards each one holds.
 *
 * A folded frame is still drawn — around its owner and the block that stands
 * in for its body — so a folded loop still reads as a loop. A frame folded
 * inside a folded one is not drawn: its owner is hidden with the outer body.
 *
 * @param {Array} frames  from computeScopeFrames()
 * @param {{ hidden: Set<string>, blocks: Array }} view  from collapseScopes()
 * @param {Iterable<string>} collapsed
 * @returns {Array<{ id, owner, output, members: string[], entries: string[], terminals: string[], parent, depth, collapsed: boolean, count: number }>}
 */
export function visibleScopeFrames(frames = [], view = { hidden: new Set(), blocks: [] }, collapsed = []) {
    const folded = new Set(collapsed);
    const blockOf = new Map(view.blocks.map((b) => [b.frame.id, b.id]));
    const result = [];

    for (const f of frames) {
        if (view.hidden.has(f.owner)) continue;
        const count = f.members.length;

        if (folded.has(f.id) && blockOf.has(f.id)) {
            const block = blockOf.get(f.id);
            result.push({ ...f, members: [block], entries: [block], terminals: [block], collapsed: true, count });
            continue;
        }

        const members = f.members.filter((k) => !view.hidden.has(k));
        for (const g of frames) {
            if (g !== f && blockOf.has(g.id) && members.includes(g.owner)) members.push(blockOf.get(g.id));
        }
        result.push({
            ...f,
            members,
            entries: f.entries.filter((k) => !view.hidden.has(k)),
            terminals: f.terminals.filter((k) => !view.hidden.has(k)),
            collapsed: false,
            count,
        });
    }

    return result;
}

/**
 * Lays the graph out with every frame as one compound node.
 *
 * Innermost first, each frame's body is laid out on its own, with a compact
 * row gap; the owner sits on top of it, centred over the body's entry, and
 * the frame is the box around both. In the layout one level up the frame is a
 * single wide, tall node: whatever follows the loop — its continuation, and
 * any edge leaving the body — hangs below the whole frame instead of beside
 * its content, and neighbouring columns keep clear of it.
 *
 * @param {Array} nodes   the graph as drawn (collapseScopes().nodes)
 * @param {Array} edges   likewise
 * @param {Array} frames  from visibleScopeFrames()
 * @param {{ nodeHeights?: Object<string, number>, rowHeight?: number,
 *           openKeys?: Set<string>, outputCount?: (key: string) => number }} [options]
 *   `openKeys`: cards with an open output, whose "+" hangs below them.
 *   `outputCount`: how many outputs a card has; a row under a card that
 *   branches keeps the usual gap, for the branch pills.
 * @returns {{ positions: Object<string, {x:number,y:number}>, rects: Object<string, {x:number,y:number,width:number,height:number}> }}
 */
export function layoutScoped(nodes = [], edges = [], frames = [], options = {}) {
    const { nodeHeights = {}, rowHeight = LAYOUT.ROW_HEIGHT, openKeys = new Set(), outputCount = () => 1 } = options;
    const byKey = new Map(nodes.map((n) => [n.node_key, n]));
    const defaultGap = Math.max(0, rowHeight - LAYOUT.NODE_HEIGHT);
    const heightOf = (key) => {
        const measured = nodeHeights?.[key];
        return Number.isFinite(measured) && measured > 0 ? measured : LAYOUT.NODE_HEIGHT;
    };

    const repOf = new Map(); // node key → the outermost unit built so far that holds it
    const rep = (key) => repOf.get(key) ?? key;
    const units = new Map(); // unit key → { w, h, tail, anchorX, rel, rects }

    function layoutKeys(keys, gapFor) {
        const set = new Set(keys);
        const subNodes = keys.map((k) => (units.has(k) ? { node_key: k, type: SCOPE_UNIT_TYPE, config: {} } : byKey.get(k)));
        const subEdges = [];
        const seen = new Set();
        for (const e of edges) {
            const a = rep(e.from_node_key);
            const b = rep(e.to_node_key);
            if (a === b || !set.has(a) || !set.has(b)) continue;
            const out = units.has(a) ? 'default' : (e.from_output || 'default');
            const sig = `${a}::${out}::${b}`;
            if (seen.has(sig)) continue;
            seen.add(sig);
            subEdges.push({ from_node_key: a, from_output: out, to_node_key: b });
        }

        const heights = {};
        const insets = {};
        const gaps = {};
        for (const k of keys) {
            const unit = units.get(k);
            if (unit) {
                heights[k] = unit.h;
                insets[k] = { left: unit.anchorX, right: unit.w - unit.anchorX - LAYOUT.NODE_WIDTH };
                gaps[k] = SCOPE_FRAME.BELOW;
            } else {
                heights[k] = heightOf(k);
                gaps[k] = gapFor(k);
            }
        }

        return computeLayout(subNodes, subEdges, { rowHeight, nodeHeights: heights, insets, gaps }).positions;
    }

    const ordered = frames.filter((f) => byKey.has(f.owner)).sort((a, b) => b.depth - a.depth);

    for (const f of ordered) {
        if (repOf.has(f.owner)) continue; // two frames holding each other: the outer one wins
        const members = [...new Set(f.members.filter((k) => byKey.has(k)).map(rep))].filter((k) => k !== f.owner);
        if (!members.length) continue;

        const entries = [...new Set(f.entries.map(rep))].filter((k) => members.includes(k));
        const keys = [...new Set([...entries, ...members])];
        const positions = layoutKeys(keys, (k) => (outputCount(k) > 1 ? defaultGap : SCOPE_FRAME.BODY_GAP));

        let minX = Infinity;
        let maxX = -Infinity;
        let maxY = 0;
        for (const k of keys) {
            const p = positions[k];
            if (!p) continue;
            const unit = units.get(k);
            const left = unit ? p.x - unit.anchorX : p.x;
            const width = unit ? unit.w : LAYOUT.NODE_WIDTH;
            const height = unit ? unit.h + unit.tail : heightOf(k) + (openKeys.has(k) ? SCOPE_FRAME.ADDER_DROP : 0);
            minX = Math.min(minX, left);
            maxX = Math.max(maxX, left + width);
            maxY = Math.max(maxY, p.y + height);
        }
        if (!Number.isFinite(minX)) continue;

        const entryX = entries.map((k) => positions[k]?.x).filter(Number.isFinite);
        const ownerX = entryX.length ? (Math.min(...entryX) + Math.max(...entryX)) / 2 : minX;
        const left = Math.min(minX, ownerX) - SCOPE_FRAME.PAD_L;
        const right = Math.max(maxX, ownerX + LAYOUT.NODE_WIDTH) + SCOPE_FRAME.PAD_R;
        const bodyY = SCOPE_FRAME.HEAD + heightOf(f.owner) + SCOPE_FRAME.INTO;
        const height = bodyY + maxY + SCOPE_FRAME.PAD_BOTTOM;

        const rel = new Map([[f.owner, { x: ownerX - left, y: SCOPE_FRAME.HEAD }]]);
        const rects = new Map();
        for (const k of keys) {
            const p = positions[k];
            if (!p) continue;
            const unit = units.get(k);
            if (!unit) {
                rel.set(k, { x: p.x - left, y: p.y + bodyY });
                continue;
            }
            const ox = p.x - unit.anchorX - left;
            const oy = p.y + bodyY;
            for (const [kk, r] of unit.rel) rel.set(kk, { x: r.x + ox, y: r.y + oy });
            for (const [id, r] of unit.rects) rects.set(id, { ...r, x: r.x + ox, y: r.y + oy });
        }
        rects.set(f.id, { x: 0, y: 0, width: Math.round(right - left), height: Math.round(height) });

        const key = `${SCOPE_UNIT_PREFIX}${f.id}`;
        units.set(key, {
            w: right - left,
            h: height,
            // An open continuation's "+" hangs below the frame; a frame
            // around this one has to hold it.
            tail: openKeys.has(f.owner) ? SCOPE_FRAME.DONE_ADDER + 24 : 0,
            anchorX: ownerX - left,
            rel,
            rects,
        });
        for (const k of rel.keys()) repOf.set(k, key);
    }

    const top = [...new Set(nodes.map((n) => rep(n.node_key)))];
    const placed = layoutKeys(top, () => defaultGap);

    const positions = {};
    const rects = {};
    for (const k of top) {
        const p = placed[k];
        if (!p) continue;
        const unit = units.get(k);
        if (!unit) {
            positions[k] = { x: p.x, y: p.y };
            continue;
        }
        const ox = p.x - unit.anchorX;
        for (const [kk, r] of unit.rel) positions[kk] = { x: Math.round(r.x + ox), y: Math.round(r.y + p.y) };
        for (const [id, r] of unit.rects) rects[id] = { ...r, x: Math.round(r.x + ox), y: Math.round(r.y + p.y) };
    }

    return { positions, rects };
}

function roundedPath(points, radius = 10) {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const next = points[i + 1];
        const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        if (!r) {
            d += ` L ${cur.x} ${cur.y}`;
            continue;
        }
        const a = { x: cur.x - ((cur.x - prev.x) / inLen) * r, y: cur.y - ((cur.y - prev.y) / inLen) * r };
        const b = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
        d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`;
    }
    const last = points[points.length - 1];
    return `${d} L ${last.x} ${last.y}`;
}

/**
 * The dashed way back from the end of a body to its owner, as SVG path data in
 * flow coordinates.
 *
 * It runs inside its own frame, in the frame's left padding: out of the left
 * edge of each end card (along the frame's bottom lane first when the card is
 * not in the leftmost column, so it never cuts across a neighbouring branch),
 * up the lane and into the owner's left edge. A nested frame sits inside its
 * parent's padding, so an inner lane and an outer lane are always
 * `PAD_L` apart and never meet. Several ends share one lane, which reads as it
 * should: they all go back to the same place.
 *
 * @param {{x:number,y:number,width:number,height:number}} rect   the frame
 * @param {{x:number,y:number,width:number,height:number}} owner  the owner's card
 * @param {{x:number,y:number,width:number,height:number,anchorY?:number}} end
 *   the end card, or a nested frame (then `anchorY` says where to leave it)
 * @returns {string}
 */
export function scopeReturnPath(rect, owner, end) {
    const laneX = rect.x + SCOPE_FRAME.LANE_IN;
    const ownerY = Math.round(owner.y + Math.min(owner.height, 140) / 2);
    const endY = Math.round(end.anchorY ?? end.y + Math.min(end.height, 140) / 2);
    const leftmost = end.x - rect.x <= SCOPE_FRAME.PAD_L + 1;

    const points = [{ x: end.x, y: endY }];
    if (!leftmost) {
        const bottom = rect.y + rect.height - SCOPE_FRAME.BOTTOM_LANE;
        points.push({ x: end.x - 16, y: endY }, { x: end.x - 16, y: bottom }, { x: laneX, y: bottom });
    } else {
        points.push({ x: laneX, y: endY });
    }
    points.push({ x: laneX, y: ownerY }, { x: owner.x - 4, y: ownerY });

    return roundedPath(points);
}

/**
 * Where the continuation of a framed loop runs: out of the owner's side, down
 * outside the frame's right edge, and in under the frame to the step after
 * the loop — so that step reads as coming after the loop, not beside it.
 *
 * @param {{x:number,y:number,width:number,height:number}} rect  the frame
 * @param {{x:number,y:number}} source  the owner's side handle
 * @param {{x:number,y:number}} target  the top of the next step (or its "+")
 * @returns {{ path: string, pill: {x:number,y:number}, insert: {x:number,y:number} }}
 *   the path, where its label sits (under the frame) and where its "+" sits
 *   (on the last stretch into the next step)
 */
export function scopeDoneRoute(rect, source, target) {
    const laneX = rect.x + rect.width + SCOPE_FRAME.DONE_LANE;
    const turnY = rect.y + rect.height + SCOPE_FRAME.DONE_TURN;
    const points = [
        { x: source.x, y: source.y },
        { x: laneX, y: source.y },
        { x: laneX, y: turnY },
        { x: target.x, y: turnY },
        { x: target.x, y: target.y },
    ];

    return {
        path: roundedPath(points, 12),
        pill: { x: Math.round((laneX + target.x) / 2), y: turnY },
        insert: { x: target.x, y: Math.round((turnY + target.y) / 2) },
    };
}
