<?php

namespace Goldnead\FlowCanvas\Tests\Feature;

use Goldnead\FlowCanvas\FlowCanvas;
use Goldnead\FlowCanvas\ServiceProvider;
use Goldnead\FlowCanvas\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;
use Statamic\Facades\Addon;
use Statamic\Providers\AddonServiceProvider;

/**
 * What a site gets when it installs this package.
 *
 * There is almost no PHP here, so what can go wrong is not logic but identity:
 * the provider Statamic boots, the two strings the Addons screen renders, the
 * class a host may use to ask "is it installed", and the promise that the
 * provider ships nothing next to what the hosts already build.
 */
class PackageIdentityTest extends TestCase
{
    private function composer(): array
    {
        return json_decode(file_get_contents($this->packageRoot().'/composer.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    #[Test]
    public function the_provider_boots_as_a_statamic_addon(): void
    {
        $provider = $this->app->getProvider(ServiceProvider::class);

        $this->assertInstanceOf(AddonServiceProvider::class, $provider);
    }

    #[Test]
    public function statamic_knows_the_package_by_name_and_slug(): void
    {
        $addon = Addon::get('goldnead/statamic-flow-canvas');

        // AddonTestCase builds the manifest entry from composer.json's name, slug
        // and provider, so those three are what a test can see. The display name
        // is checked on the manifest itself, below.
        $this->assertNotNull($addon, 'The addon is not in the manifest — extra.statamic or the provider is missing.');
        $this->assertSame('goldnead/statamic-flow-canvas', $addon->id());
        $this->assertSame('flow-canvas', $addon->slug());
        $this->assertSame('goldnead/statamic-flow-canvas', $addon->package());
    }

    #[Test]
    public function the_manifest_carries_what_the_marketplace_reads(): void
    {
        $composer = $this->composer();
        $statamic = $composer['extra']['statamic'] ?? [];

        $this->assertSame('statamic-addon', $composer['type']);
        $this->assertSame('MIT', $composer['license']);
        $this->assertFileExists($this->packageRoot().'/LICENSE');

        // The listing subtitle and the Packagist description are one sentence,
        // not two that drift apart.
        $this->assertSame('Flow Canvas', $statamic['name']);
        $this->assertSame($composer['description'], $statamic['description']);
        $this->assertSame('https://github.com/goldnead/statamic-flow-canvas', $statamic['url']);
        $this->assertSame('Adrian Goldner', $statamic['developer']);

        // v6 derives the version from the installed package; a hand-written one
        // is exactly what went wrong in 1.0.3 (see the changelog).
        $this->assertArrayNotHasKey('version', $composer);
        $this->assertArrayNotHasKey('version', $statamic);

        $this->assertSame([ServiceProvider::class], $composer['extra']['laravel']['providers']);
    }

    #[Test]
    public function a_host_can_check_for_the_package_without_touching_vendor(): void
    {
        $this->assertTrue(class_exists(FlowCanvas::class));
    }

    #[Test]
    public function the_provider_publishes_and_registers_nothing(): void
    {
        // The hosts compile the canvas into their own bundles. A second copy
        // published from here would be the drift this package exists to end.
        $this->assertSame([], ServiceProvider::pathsToPublish(ServiceProvider::class));
        $this->assertDirectoryDoesNotExist($this->packageRoot().'/resources/dist');
        $this->assertDirectoryDoesNotExist($this->packageRoot().'/config');
    }
}
