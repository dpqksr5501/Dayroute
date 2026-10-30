# Validation record

검증일: 2026-10-31 (Asia/Seoul). Windows 로컬 환경, Codex in-app Chromium.

## Confirmed

- TypeScript strict build and Vite production bundle.
- Node built-in test runner: 5 domain tests passed. Midnight rollover, final-leg exclusion, independent cloning, Korean/emoji snapshot round trips, import rejection of invalid data, unknown pin distance handling.
- Browser: create a course, search a built-in place, add it, edit a note, immediately reload, reopen and confirm the note persists.
- Browser: add a second stop, reorder through the up button, preview the resulting order and schedule.
- Browser: export an individual course JSON, import the same file and verify a new independent course appears. Test-created courses were removed using the app.
- Browser: interactive map tiles and pins, focus a place, desktop split layout, mobile list/map switching. No reported console errors during the normal online flow.
- Browser: version change detected, save-and-update applied, existing course library preserved, latest-version and offline-ready states shown.
- Cover update: 11 domain/storage tests verify legacy backup compatibility, photo backup/clone retention, photo exclusion from URL shares, rejection of remote/SVG/oversized cover payloads, finite coordinate sketches and missing-pin gaps, and preservation of previous data on storage-quota failure.
- Browser: upload a locally generated 1,800×1,100 PNG fixture; confirm re-encoded 1,280×782 image, persistence after reload, export/import with the photo intact, rejection of an invalid image while retaining the current photo, and deletion back to a 3-pin SVG cover. The test-imported course and fixture cover were removed through the UI.
- Touch controls: source configuration explicitly enables touch zoom/rotate/pitch, drag pan/rotate, double-click zoom and keyboard controls. Camera-mode synchronization follows actual pitch, manual input stops the tour, mobile control targets are enlarged, and safe-area spacing is applied. Native multitouch remains untested on physical devices.
- Browser at 390px: no horizontal overflow, map zoom controls measure 40×40px, 3D→2D toggle updates the displayed mode, and Shift+ArrowUp changes the actual camera pitch and returns the mode indicator to 3D. This checks camera/UI synchronization, not hardware multitouch recognition.
- Browser: stop only the owned local production server, reload and open a stored course. Repeat reload and open a different course. Both worked after the cache fix below. External map/font servers remained online; this is an origin-unavailable test, not a full device airplane-mode test.

## Issues found and fixed

1. MapLibre's stylesheet changed the map container to `position: relative`, leaving its height at zero. DOM measurements confirmed the container was 0px high while the map shell was over 500px. A specific map-container selector now fixes the absolute positioning and full height. Verified tile/pin visibility and mobile switching.
2. Initial offline reload returned the app HTML but did not boot the JS. Static-file cache matches were sensitive to request `Vary` differences. The worker now matches only its own allowlisted same-origin static assets in its versioned cache with `ignoreVary: true`. After installing this build, two repeated origin-unavailable reload/open flows passed. This is a cache-matching implementation fix, not storage cleanup. All old app caches are removed only during normal activation of a newer worker.

## Remaining checks before public launch

- Physical iPhone/Android installation, storage-pressure eviction, private-browsing restrictions, full airplane-mode restart, low-end GPU and prolonged mobile battery behavior.
- Live API integrations: nationwide business search, actual road routes, opening hours, weather, photorealistic 3D. None are enabled or claimed to be current.
- HTTPS hosting deployment, shared-link behavior between independent physical devices, URL length limits in messaging apps.
- Account authentication, collaborative edits and server-side synchronization are future features.
- Accessibility contrast audit, real screen reader, public-scale provider availability and terms review.

## Static map previews and Vercel release

- Frozen pnpm 11.25.0 dependency installation, Node.js 24 production build, and 14 domain/storage/map-preview tests passed.
- Browser: all three library cards rendered actual OpenFreeMap map images with all numbered stops visible. Cards are images, not interactive map instances. Explicit attribution is preserved next to each image.
- Course entry starts with a north-up 2D overview fitted to every located stop. DOM bounds confirmed all three markers fit inside the map viewport. Selecting a stop enters a closer oblique view; Whole route resets the overview and clears selection, allowing the same stop to be selected again.
- Mobile entry at 390px also starts on the overview with every marker inside the map and no horizontal overflow. Overview padding reserves space for the upper/right map controls. Idle inspection found zero hidden thumbnail map instances after their disposal timer, while the one interactive map remained active.
- Thumbnail rendering is shared and sequential, lazy for near-viewport cards, capped at 24 queued jobs and 32 in-memory results. Work for departed cards is skipped, and the offscreen WebGL renderer is disposed after 20 idle seconds. Thumbnails are not written into saved course data.
- A failed map request uses the existing coordinate diagram with an explicit failure indicator. User-selected photos retain priority and are not sent to the thumbnail renderer.
- Vercel project is configured for Vite static output, Node 24, pinned pnpm, and non-cached version metadata/service-worker updates. Browser data and photos are not part of the source deployment.

No paid API keys, account sign-ups, system-wide tool installations, unrelated process termination, or engine builds were performed.
