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

/** Ids of the synthetic nodes the canvas adds for scopes. Never saved. */
export const SCOPE_FRAME_PREFIX = '__frame__';
export const SCOPE_BLOCK_PREFIX = '__block__';

/** The node type a folded body is laid out as. Unknown to every host. */
export const SCOPE_BLOCK_TYPE = '__scope_block__';

/** Geometry of a frame, in flow coordinates. */
export const SCOPE_FRAME = {
    PAD_X: 20, // frame edge to the outermost card, left and right
    PAD_BOTTOM: 28, // below the lowest card or "+"; the return lane runs in it
    TITLE_HEIGHT: 36, // the title bar
    TITLE_GAP: 12, // title bar to the first card
    LANE: 18, // how far left of the frame the return line runs
    /**
     * Extra room the layout leaves around a body so frames, and the return
     * line outside a frame's left edge, never reach into a neighbouring
     * column. The layout's normal column gap is 80px.
     */
    INSET_X: 44,
    /**
     * Extra room above a body's first row, for the title bar — enough that
     * the "+" halfway along the edge into the body sits above the frame, not
     * on its border.
     */
    INSET_TOP: 72,
    /** Extra room above a folded body's block. */
    BLOCK_TOP: 40,
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
 * The spacing the layout leaves around each visible body: `INSET_X` either
 * side of the subtree its entry roots, `INSET_TOP` above its first row.
 *
 * @returns {{ insets: Object<string, {x: number, top: number}> }}
 */
export function scopeLayoutInsets(frames = [], hidden = new Set()) {
    const insets = {};
    for (const f of frames) {
        if (hidden.has(f.owner)) continue;
        for (const entry of f.entries) {
            if (hidden.has(entry)) continue;
            const prev = insets[entry] ?? { x: 0, top: 0 };
            insets[entry] = {
                x: prev.x + SCOPE_FRAME.INSET_X,
                top: prev.top + SCOPE_FRAME.INSET_TOP,
            };
        }
    }
    return insets;
}

/**
 * The rectangle of every visible, unfolded frame, innermost first so an outer
 * frame can wrap the inner ones.
 *
 * @param {Array} frames
 * @param {Object<string, {x:number,y:number,width:number,height:number}>} boxes
 *   The drawn box of each visible card. `extras[key]` may add further boxes
 *   that belong to a card — its "+" adders hanging below it.
 * @param {{ collapsed?: Iterable<string>, hidden?: Set<string>, extras?: Object<string, Array> }} [options]
 * @returns {Object<string, {x:number,y:number,width:number,height:number}>}
 */
export function scopeFrameRects(frames = [], boxes = {}, { collapsed = [], hidden = new Set(), extras = {} } = {}) {
    const folded = new Set(collapsed);
    const rects = {};
    const ordered = [...frames].sort((a, b) => b.depth - a.depth);

    for (const f of ordered) {
        if (folded.has(f.id) || hidden.has(f.owner)) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const take = (b) => {
            if (!b) return;
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            maxX = Math.max(maxX, b.x + b.width);
            maxY = Math.max(maxY, b.y + b.height);
        };
        for (const key of f.members) {
            if (hidden.has(key)) continue;
            take(boxes[key]);
            for (const extra of extras[key] ?? []) take(extra);
        }
        for (const inner of frames) {
            // An inner frame's return line runs outside its left edge, so
            // the outer frame has to hold that lane as well.
            if (inner.parent === f.id && rects[inner.id]) {
                const r = rects[inner.id];
                take({ ...r, x: r.x - SCOPE_FRAME.LANE, width: r.width + SCOPE_FRAME.LANE });
            }
            if (inner.parent === f.id && folded.has(inner.id)) take(boxes[`${SCOPE_BLOCK_PREFIX}${inner.id}`]);
        }
        if (!Number.isFinite(minX)) continue;

        const top = minY - SCOPE_FRAME.TITLE_HEIGHT - SCOPE_FRAME.TITLE_GAP;
        rects[f.id] = {
            x: Math.round(minX - SCOPE_FRAME.PAD_X),
            y: Math.round(top),
            width: Math.round(maxX - minX + 2 * SCOPE_FRAME.PAD_X),
            height: Math.round(maxY - top + SCOPE_FRAME.PAD_BOTTOM),
        };
    }

    return rects;
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
 * It leaves each end card on its left edge, runs down the frame's bottom lane
 * when the card is not in the body's leftmost column (so it never cuts across
 * a neighbouring branch), goes up outside the frame's left edge and enters the
 * owner from the left, pointing at it. Several ends share the same lane, which
 * reads as they should: they all go back to the same place.
 *
 * @param {{x:number,y:number,width:number,height:number}} rect   the frame
 * @param {{x:number,y:number,width:number,height:number}} owner  the owner's card
 * @param {{x:number,y:number,width:number,height:number}} end    the end card
 * @returns {string}
 */
export function scopeReturnPath(rect, owner, end) {
    const laneX = rect.x - SCOPE_FRAME.LANE;
    const ownerY = Math.round(owner.y + Math.min(owner.height, 140) / 2);
    const endY = Math.round(end.y + Math.min(end.height, 140) / 2);
    const leftmost = end.x - rect.x <= SCOPE_FRAME.PAD_X + 1;

    const points = [{ x: end.x, y: endY }];
    if (!leftmost) {
        const bottom = rect.y + rect.height - SCOPE_FRAME.PAD_BOTTOM / 2;
        points.push({ x: end.x - 14, y: endY }, { x: end.x - 14, y: bottom }, { x: laneX, y: bottom });
    } else {
        points.push({ x: laneX, y: endY });
    }
    points.push({ x: laneX, y: ownerY }, { x: owner.x - 2, y: ownerY });

    return roundedPath(points);
}
