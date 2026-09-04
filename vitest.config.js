import { defineConfig } from 'vitest/config';

/**
 * Vitest for the pure logic in `resources/js/composables`.
 *
 * Deliberately `vitest.config.js`, not `vite.config.js`: this package has no
 * build. The hosts (`statamic-automations`, `statamic-funnels`) compile the
 * canvas inside their own Vite pipelines, with the Statamic plugin and the
 * `vue`/`@vue-flow/*` dedupe that puts one Vue on the page. A vite.config here
 * would claim a bundle that does not exist.
 *
 * The composables under test import nothing but `vue` and each other, so they
 * run against the source files as they are, under Node.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/js/**/*.test.js'],
    },
});
