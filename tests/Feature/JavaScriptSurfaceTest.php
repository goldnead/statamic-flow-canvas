<?php

namespace Goldnead\FlowCanvas\Tests\Feature;

use Goldnead\FlowCanvas\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * The part of this package the hosts actually import.
 *
 * `statamic-automations` and `statamic-funnels` install `resources/js` as
 * `@goldnead/flow-canvas` straight from the vendor directory and import both
 * the barrel (`index.js`) and deep paths (`components/Canvas.vue`,
 * `composables/useHistory.js`). A renamed or moved file breaks their build,
 * not this package's — so the contract is checked here, where the change
 * happens.
 */
class JavaScriptSurfaceTest extends TestCase
{
    private function js(string $path = ''): string
    {
        return $this->packageRoot().'/resources/js'.($path === '' ? '' : '/'.$path);
    }

    private function manifest(): array
    {
        return json_decode(file_get_contents($this->js('package.json')), true, 512, JSON_THROW_ON_ERROR);
    }

    #[Test]
    public function every_declared_export_points_at_something_that_exists(): void
    {
        $exports = $this->manifest()['exports'];

        $this->assertSame('./index.js', $exports['.']);

        foreach ($exports as $entry => $target) {
            // "./components/*" -> the directory has to be there; a file -> the file.
            $path = str_ends_with($target, '/*') ? dirname($target) : $target;

            $this->assertFileExists($this->js(ltrim($path, './')), "exports[{$entry}] points at nothing");
        }
    }

    #[Test]
    public function the_barrel_only_re_exports_files_that_exist(): void
    {
        $index = file_get_contents($this->js('index.js'));

        preg_match_all("/from '(\.\/[^']+)'/", $index, $matches);

        $this->assertNotEmpty($matches[1]);

        foreach ($matches[1] as $relative) {
            $this->assertFileExists($this->js(substr($relative, 2)), "index.js re-exports {$relative}, which is gone");
        }
    }

    #[Test]
    public function the_deep_paths_the_hosts_import_are_still_there(): void
    {
        // Lifted from the hosts' `resources/js` (grep for `@goldnead/flow-canvas/`),
        // not from this package's own idea of its surface.
        foreach ([
            'components/Canvas.vue',
            'components/NodeCard.vue',
            'components/NodeLibrary.vue',
            'components/ControlBar.vue',
            'components/AdderNode.vue',
            'components/InsertableEdge.vue',
            'components/PropertiesSection.vue',
            'composables/useAutoLayout.js',
            'composables/useAutosave.js',
            'composables/useHistory.js',
            'composables/useKeyValueRows.js',
            'composables/useNodeOutputs.js',
            'composables/useNodeValidation.js',
            'canvas.css',
            'canvas-theme.css',
        ] as $path) {
            $this->assertFileExists($this->js($path));
        }
    }

    #[Test]
    public function the_hosts_own_vue_and_vue_flow(): void
    {
        $manifest = $this->manifest();

        // One Vue and one flow library on the page: everything the package
        // needs at runtime is a peer, and the dev copy exists only so this
        // package's own tests resolve. The two lists must agree, or a host
        // installs a version the tests never saw.
        $this->assertArrayNotHasKey('dependencies', $manifest);
        $this->assertSame($manifest['peerDependencies'], $manifest['devDependencies']);
        $this->assertArrayHasKey('vue', $manifest['peerDependencies']);
        $this->assertArrayHasKey('@vue-flow/core', $manifest['peerDependencies']);
    }
}
