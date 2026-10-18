/**
 * Plain CSS, not Tailwind utilities, in the shared components.
 *
 * This package ships `.vue` files that the hosts compile with their own
 * Tailwind build. Their `@source` does not reach `vendor/…/resources/js`, so
 * a utility class written here is generated in no host that doesn't use it
 * itself, and it looks right only by accident of a neighbouring addon (see
 * STATE/backlog/backlog-flow-canvas-utilities-auf-plain-css.md).
 *
 * Each file below lists the utilities the backlog measured as dead, plus the
 * dark: variants and arbitrary values on the same elements. None of them may
 * come back as a class in the template, and each file must carry a scoped
 * <style> block where the plain CSS lives.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const COMPONENTS = new URL('../../resources/js/components/', import.meta.url);

const TICKET_CLASSES = {
    'NodeLibrary.vue': ['justify-between', 'tracking-wider', 'm-0', 'mb-3', 'py-6', 'gap-1.5', 'dark:text-gray-400'],
    'Canvas.vue': ['size-full'],
    'AdderNode.vue': ['size-4'],
    'ControlBar.vue': ['text-base', 'px-1', 'leading-none', 'mx-0.5', 'h-4', 'w-px', 'bg-gray-200', 'dark:bg-gray-700'],
    'InsertableEdge.vue': ['size-3'],
    'NodeCard.vue': [
        'shrink-0', 'flex-wrap', 'justify-end', 'font-mono', 'ml-auto',
        'gap-x-1.5', 'gap-y-0.5', 'text-gray-300', 'dark:text-gray-600', 'text-[10px]',
    ],
    'PropertiesSection.vue': [
        'border-b', 'px-4', 'text-gray-400', 'border-gray-200', 'dark:border-gray-800', 'cursor-pointer', 'py-2.5', 'pb-4',
    ],
};

const read = (file) => readFileSync(new URL(file, COMPONENTS), 'utf8');

/** The template only: from `<template>` up to the script, without HTML comments. */
function templateOf(src) {
    const start = src.indexOf('<template>');
    const end = src.indexOf('<script');
    return src.slice(start, end).replace(/<!--[\s\S]*?-->/g, '');
}

/** Every token of every `class` and `:class` attribute value in the template. */
function classTokens(template) {
    const tokens = [];
    for (const match of template.matchAll(/(?:^|\s):?class\s*=\s*"([^"]*)"/g)) {
        tokens.push(...match[1].split(/[\s'"`,?(){}&|!]+/).filter(Boolean));
    }
    return tokens;
}

describe.each(Object.keys(TICKET_CLASSES))('%s', (file) => {
    const src = read(file);

    it('has a scoped <style> block for its plain CSS', () => {
        expect(src).toMatch(/<style\s[^>]*\bscoped\b[^>]*>/);
    });

    it('keeps no ticket utility in its template classes', () => {
        const found = classTokens(templateOf(src)).filter((token) => TICKET_CLASSES[file].includes(token));
        expect(found).toEqual([]);
    });
});
