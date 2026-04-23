<?php

/*
 * Copyright (C) 2026 CROWDAQ
 *
 * This file is part of the CROWDAQ Xibo Plugin.
 *
 * The CROWDAQ Xibo Plugin is free software: you can redistribute it
 * and/or modify it under the terms of the GNU Affero General Public
 * License as published by the Free Software Foundation, either
 * version 3 of the License, or (at your option) any later version.
 *
 * See the LICENSE file at the repo root for the full text.
 */

declare(strict_types=1);

namespace CROWDAQ\Xibo\Widget;

/**
 * CROWDAQ widget stub.
 *
 * Xibo 4.x is XML-first for custom modules — most widgets do not need a
 * PHP class at all and are fully defined by the module XML + Twig stencil.
 * This class is kept as an opt-in data-provider hook for the case where
 * the widget needs to fetch CROWDAQ content server-side (rather than
 * from the player) — for example to honour a backend cache or to resolve
 * display-tag-scoped feeds.
 *
 * The real method signatures and the parent class to extend will be
 * chosen in follow-up iterations. Xibo pre-v4 used
 * `\Xibo\Widget\ModuleWidget`; Xibo v4 moved the authoring surface into
 * the data-provider interface (`\Xibo\Widget\Provider\*`). We deliberately
 * DO NOT extend either here in the scaffold iter — extending a class that
 * does not yet exist in vendor/ would make the scaffold fail static
 * analysis. The implementation iter will add the correct `extends` /
 * `implements` clause along with a dev-only require on xibo-cms.
 *
 * @todo iter "Define CROWDAQ data source contract" — bind to the agreed
 *       data-source interface.
 * @todo iter "MVP CROWDAQ widget rendering" — implement init/getData/render.
 */
final class CrowdaqWidget
{
    /**
     * Initialise the widget. Called once per render by the CMS.
     *
     * TODO: wire up the Xibo module lifecycle (settings load, stencil
     * location resolution, etc.).
     */
    public function init(): void
    {
        // placeholder
    }

    /**
     * Fetch CROWDAQ payload for the current render.
     *
     * TODO: call the CROWDAQ backend per the data-source contract iter
     * and return a normalised array the Twig stencil can consume.
     *
     * @return array<string, mixed>
     */
    public function getData(): array
    {
        return [
            'items' => [],
            'source' => 'stub',
        ];
    }

    /**
     * Render the Twig stencil with the fetched payload.
     *
     * TODO: use Xibo's render pipeline — this stub returns a bare string
     * purely so the method has a defined body for static analysers.
     */
    public function render(): string
    {
        return '<!-- CROWDAQ widget: scaffold stub -->';
    }
}
