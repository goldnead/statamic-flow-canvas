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
    //
}
