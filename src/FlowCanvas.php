<?php

namespace Goldnead\FlowCanvas;

/**
 * The package is JavaScript; this class exists so Composer has something to
 * autoload and so a host can assert the package is installed without reaching
 * into a vendor path.
 */
final class FlowCanvas
{
    /*
     * There used to be a VERSION constant here. It said 1.0.0 while v1.2.0 was
     * shipped, because nothing made it move when a tag did — and a version
     * number that has to be copied by hand drifts by default rather than by
     * accident. Anybody building a capability check on it got the wrong answer.
     *
     * Removed rather than synced: nothing in the family read it (grepped), and
     * the one thing this class is for — "is the package installed" — is
     * answered by `class_exists(FlowCanvas::class)`, which cannot go stale.
     * Composer already knows the version, and it is right.
     */
}
