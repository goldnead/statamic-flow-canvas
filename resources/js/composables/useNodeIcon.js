/**
 * Node handle → Statamic icon, as a lookup the host fills in.
 *
 * The *mapping* is domain (only `statamic-automations` knows that `send_email`
 * should be an envelope); the *lookup* is not, and the card and the palette
 * have to agree on it or the same node wears two faces.
 *
 * Every name a host passes must be a real icon shipped by `@statamic/cms`
 * (`resources/svg/icons/*.svg`). An invented name renders as nothing at all,
 * which looks like a broken build rather than a wrong string.
 */

const ULTIMATE_FALLBACK = 'node-connect';

/**
 * @param {Object<string, string>} handleIcons  node handle → icon name
 * @param {Object<string, string>} kindFallbacks kind → icon name
 * @returns {(handle: string, kind?: string) => string}
 */
export function createNodeIcon(handleIcons = {}, kindFallbacks = {}) {
    return function nodeIcon(handle, kind = null) {
        return handleIcons[handle] ?? kindFallbacks[kind] ?? ULTIMATE_FALLBACK;
    };
}

/** The key the canvas provides its resolver under. */
export const NODE_ICON = Symbol('flow-canvas:node-icon');

/** The key the canvas provides its kind descriptors under. */
export const NODE_KINDS = Symbol('flow-canvas:node-kinds');
