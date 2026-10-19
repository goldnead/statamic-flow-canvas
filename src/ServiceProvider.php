<?php

namespace Goldnead\FlowCanvas;

use Statamic\Providers\AddonServiceProvider;

/**
 * Deliberately empty.
 *
 * This package is JavaScript that two host addons compile into their own
 * bundles (`@goldnead/flow-canvas` from `resources/js`). Nothing here has to
 * be published, no script has to be registered, and the hosts already do
 * both for the code they build. The provider exists for one reason: Statamic
 * lists a package on the Addons screen only when `extra.statamic` is set AND
 * `extra.laravel.providers[0]` names a class that exists — a manifest entry
 * without a provider is skipped without a word. So this is what makes the
 * package visible where a site owner looks for what is installed, and it is
 * all it does.
 *
 * Keep it that way. A `$vite`, `$scripts` or `$publishables` entry here would
 * ship the canvas a second time next to the host's copy, and the two would
 * drift — which is the one thing this package exists to prevent.
 */
class ServiceProvider extends AddonServiceProvider
{
    // Statamic would publish `resources/lang` as a namespaced group; this
    // package has only JSON words and publishes nothing.
    protected $translations = false;

    /**
     * The one thing it does carry: the canvas' own words. They are written
     * in the components as `__('Node library')`, and the browser asks
     * Statamic's dictionary for them, so a host that does not ship them (or a
     * site that does not have them) shows the English key. The German file
     * sits next to the code that uses the words.
     */
    public function bootAddon(): void
    {
        $this->loadJsonTranslationsFrom(__DIR__.'/../resources/lang');
    }
}
