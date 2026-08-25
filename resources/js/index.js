/**
 * The shared node-graph editor.
 *
 * One editor, consumed twice, so the two never drift apart. What a node
 * *means* stays with the host addon; everything here is about drawing a graph
 * and letting somebody rearrange it.
 */

export { default as Canvas } from './components/Canvas.vue';
export { default as NodeCard } from './components/NodeCard.vue';
export { default as NodeLibrary } from './components/NodeLibrary.vue';
export { default as ControlBar } from './components/ControlBar.vue';
export { default as AdderNode } from './components/AdderNode.vue';
export { default as InsertableEdge } from './components/InsertableEdge.vue';
export { default as PropertiesSection } from './components/PropertiesSection.vue';

export { createNodeIcon, NODE_ICON, NODE_KINDS } from './composables/useNodeIcon.js';
export * from './composables/useAutoLayout.js';
export * from './composables/useHistory.js';
export * from './composables/useAutosave.js';
export * from './composables/useNodeOutputs.js';
export * from './composables/useNodeValidation.js';
export * from './composables/useKeyValueRows.js';
