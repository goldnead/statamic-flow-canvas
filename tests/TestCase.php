<?php

namespace Goldnead\FlowCanvas\Tests;

use Goldnead\FlowCanvas\ServiceProvider;
use Statamic\Testing\AddonTestCase;
use Statamic\Testing\Concerns\PreventsSavingStacheItemsToDisk;

abstract class TestCase extends AddonTestCase
{
    use PreventsSavingStacheItemsToDisk;

    protected string $addonServiceProvider = ServiceProvider::class;

    /** The package root, for the tests that read the manifests. */
    protected function packageRoot(): string
    {
        return dirname(__DIR__);
    }
}
