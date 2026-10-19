<?php

namespace Goldnead\FlowCanvas\Tests\Feature;

use Goldnead\FlowCanvas\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * The canvas writes its words as `__('Node library')` in the components. A
 * word that is not in the German file reaches the screen as the English key.
 */
class TranslationsTest extends TestCase
{
    #[Test]
    public function every_word_the_components_use_has_a_german_line(): void
    {
        $german = json_decode(file_get_contents($this->packageRoot().'/resources/lang/de.json'), true, 512, JSON_THROW_ON_ERROR);

        $used = [];
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->packageRoot().'/resources/js', \FilesystemIterator::SKIP_DOTS));

        foreach ($files as $file) {
            $path = $file->getPathname();

            if (str_contains($path, 'node_modules') || ! preg_match('/\.(vue|js)$/', $path)) {
                continue;
            }

            preg_match_all('/__\(\s*([\'"])(.+?)\1/', file_get_contents($path), $found);
            array_push($used, ...$found[2]);
        }

        $this->assertNotEmpty($used);
        $this->assertSame([], array_values(array_diff(array_unique($used), array_keys($german))));
    }

    #[Test]
    public function the_provider_registers_the_german_dictionary(): void
    {
        app()->setLocale('de');

        $this->assertSame('Bausteine', __('Node library'));
        $this->assertSame('Bereit', __('Ready'));
    }
}
