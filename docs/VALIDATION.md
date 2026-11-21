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

## 당시 남겨 둔 검증 항목 (2026-10-31)

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

## Transit routing and live arrival stitching (2026-11-07)

- Added `TransitStep` and `TransitLeg` domain models with strict validation (`validTransit`, `validTransitStep`), schedule integration (`transitFor`, `carFor`, `legMinutes`), and share/backup round-tripping.
- Added `/api/transport` actions for multi-provider transit routing (`action=transit` supporting TMAP Transit and ODSay), road driving (`action=car`), live POI search (`action=pois`), reverse geocoding (`action=reverse-geocode`), and first-leg boarding station live arrival matching (`action=transit-live` supporting Seoul TOPIS, Gyeonggi GBIS + Gyeonggi OpenAPI `BusStation` fallback, and Seoul real-time subway arrivals).
- Fixed Seoul TOPIS server-to-server endpoint protocol (`http://ws.bus.go.kr`) and added dual-source Gyeonggi station resolution (`apis.data.go.kr` with `openapi.gg.go.kr/BusStation` fallback), verified live against Seoul (Seongsu) and Gyeonggi (Suwon Hwaseong Haenggung) coordinates.
- Enhanced 3D map quality in `MapView.tsx` with directional lighting (`setLight`), height-interpolated vertical-gradient building extrusions, cased road/transit polylines, transit boarding node markers, and an explicit 2D/3D camera toggle.
- Verified with 20 passing unit tests (`tests/*.test.ts`), strict TypeScript check (`tsc -b`), and Vite production bundle build.

## 앱 내 경로 흐름과 확인 범위 (2026-11-21)

| 항목 | 확인한 내용 | 추가 확인 |
| --- | --- | --- |
| 후보 비교와 일정 적용 | 코드에서 구간 선택, 후보 조회·필터·정렬, 지도 미리보기와 명시적 일정 반영 흐름을 확인했습니다. 로컬 기준 `43a408d`에서 자동 테스트 38개가 통과했습니다. | 운영 행궁동 예시 코스에서는 후보 화면과 호출 한도 안내까지 관찰했습니다. 신규 후보 수신부터 적용·재로드까지의 전체 확인은 남았습니다. |
| 실시간 도착정보 | 앞선 운영 점검에서 서울 성동13 버스와 성수역 2호선 응답을 각각 확인했습니다. | 두 예시 외 구간과 제공처 장애 시 동작은 별도로 확인합니다. 같은 지하철 노선의 양방향 응답을 포함한 모의 사례에서 원하는 방면을 특정할 근거가 부족한 경우를 검토했습니다. 방향 매칭 변경은 적용 전입니다. |
| 저장·가져오기 크기 | 한도 근처의 동일 데이터를 간결한 JSON으로 계산하면 4,933,222바이트, 들여쓴 백업 파일은 5,062,638바이트였습니다. 가져오기 화면의 파일 크기 제한은 5,000,000바이트입니다. | 한도 근처의 전체 백업은 내보내기에서 가져오기까지 왕복 검사가 필요합니다. 이 차이를 해결하는 코드 변경은 적용 전입니다. |
| 외부 지도 | 네이버는 장소명, 카카오는 장소명과 좌표를 받는 링크 생성 코드를 확인했습니다. | 외부 페이지의 위치 해석과 앱 전환은 기기에서 별도로 확인합니다. |

검사 범위는 자동 테스트, 운영 설정 상태, 실제 사용자 흐름으로 나눕니다. `pnpm verify:deployment`는 HTML·번들·헤더·교통 함수의 상태를 확인합니다. `--arrivals` 모드는 일부 도착정보를 추가로 확인합니다. [휴대폰 테스트 가이드](PHONE_TESTING.md)의 시나리오로 신규 후보 수신, 앱 내 후보 미리보기와 일정 반영을 이어서 점검할 수 있습니다.
