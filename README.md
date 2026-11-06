# Dayroute

좋아하는 장소를 모아, 함께 보낼 하루를 계획하는 웹앱입니다. 서울·경기 코스를 만들고 보관했다가 다음 약속에 다시 사용할 수 있습니다.

## 실행

이 컴퓨터에서는 루트의 **`Start-Dayroute.cmd`를 더블클릭**하고, 표시되는 `http://127.0.0.1:5173`을 브라우저에서 여세요. 이미 서버가 실행 중이면 기존 주소를 사용하세요. 창에서 Ctrl+C를 누르면 서버를 종료합니다.

일반 개발 환경에서는 Node.js 24 LTS와 pnpm이 필요합니다. VS Code로 이 폴더를 열면 됩니다. 별도 Visual Studio 워크로드·DB·Docker는 필요하지 않습니다.

```sh
pnpm install --ignore-scripts
pnpm dev
pnpm test
pnpm build
pnpm preview
```

`dev`: 개발·자동 새로고침. `preview`: 빌드 결과, PWA 캐시·업데이트 확인. 홈 화면 설치 및 서비스 워커는 HTTPS 또는 localhost에서 동작합니다. PWA 앱 설치 방식은 OS·브라우저에 따라 다릅니다.

Vercel 배포 및 Android 테스트는 [휴대폰 테스트 가이드](docs/PHONE_TESTING.md)를 참고하세요. `vercel.json`에 Vite 빌드·출력 경로와 업데이트용 캐시 헤더를 설정했습니다. Node.js 24 및 pnpm 11.25.0으로 고정합니다.

## 현재 기능

- 여러 코스 생성·검색·지역 필터·즐겨찾기·복제·삭제·실행 취소
- 장소 카드와 일정 편집: 순서, 날짜, 시작 시각, 체류·이동 시간, 이동수단(`도보`/`대중교통`/`자동차`), 예약 여부, 메모
- 구간별 이동(`TravelLeg`):
  - **도보·자동차**: TMAP 보행자 및 자동차 경로 예상 소요 시간·거리 조회 및 지도 경로 표시(권한 확인 시)
  - **대중교통**: 출발→도착 대중교통 추천 경로(TMAP 대중교통 / ODSay) 조회, 다중 후보 경로 선택, 단계별 승하차 타임라인(도보·버스·지하철·열차), **첫 승차 정류장/역 실시간 도착 매칭 조회**
  - **외부 지도 길찾기 연동**: 출발·도착 장소와 좌표를 포함한 네이버 지도 대중교통 길찾기 및 카카오맵 길찾기 바로가기
- 주변 버스 도착 모달(`BusPanel`): 코스 내 장소 기준 반경 500m 서울(TOPIS)·경기(GBIS 및 경기데이터드림 이중 연동) 정류소 검색 및 실시간 버스 도착 조회
- 서울·경기 기본 장소 목록 검색 + **TMAP 실시간 장소(POI) 통합 검색** + 지도 클릭 시 **리버스 지오코딩 주소 자동 입력**
- 무료 벡터 지도, **광원(Light)·높이별 그라데이션 입체 건물(3D)**, 외곽선(Casing) 경로 라인 및 대중교통 승하차 지점 표시, 장소 포커스·순차 카메라 투어, **2D/3D 전환 버튼** 및 북쪽 초기화 나침반
- 기본 코스 커버는 모든 위치가 들어오는 정지 지도 이미지. 화면 근처 카드만 공용 렌더러 하나로 순차 생성하고 메모리에서 재사용
- 지도 이미지 생성 실패·오프라인에서는 좌표 기반 동선 그림으로 대체. 위치가 없으면 빈 커버 유지
- 직접 사진 추가·변경·삭제: 브라우저에서 축소·WebP 변환 후 로컬 저장, 사진 삭제 시 동선으로 복원
- 브라우저 자동 저장, 새로고침 복원, JSON 파일 백업·가져오기, 일정 텍스트 복사
- 보기 전용 미리보기와 배포 후 URL fragment에 코스를 담는 사본 공유
- 반응형 모바일 레이아웃, 키보드 순서 이동, reduced-motion 대응
- 배포 버전 확인: 실행·화면 복귀·온라인 복구 시 확인, 사용 중에는 저장 후 적용
- 프로덕션 서비스 워커: 앱 파일 캐시, 지도 타일은 오프라인 캐시하지 않음

처음 보이는 3개 코스는 예시입니다. 기본 장소 좌표·주소도 방문 전 확인해 주세요. 기존 분위기 사진은 제거했습니다.

## 비용과 기능의 경계

기본 상태에서는 유료 API 키 없이 동작하며, 서버 환경변수(`.env.local` 또는 Vercel Environment Variables)가 설정된 항목만 선택적으로 활성화됩니다. OpenFreeMap 공개 지도 인스턴스를 기본 지도로 사용합니다.

| 항목 | 현재 구현 |
| --- | --- |
| 지도 | MapLibre GL JS + OpenFreeMap / OpenStreetMap |
| 입체 건물 | OSM 건물 형태·높이 기반, 지역별 밀도·정확도 차이 있음 |
| 실사 건물·항공 3D | 미연결. Google/V-World 등의 해당 지역 데이터·사용 조건을 먼저 검토해야 함 |
| 도보 경로 | 기본은 직선 점선·직접 입력 시간. `TMAP_APP_KEY` 연결 시 도보 예상 시간·거리 조회 (`TMAP_MAP_DISPLAY_CONFIRMED=true` 시 실선 표시) |
| 대중교통 경로 | `ODSAY_API_KEY` 또는 `TMAP_APP_KEY` 연결 시 구간별 버스·지하철 경로 탐색 및 일정 반영 (`TRANSIT_MAP_DISPLAY_CONFIRMED=true` 시 노선 실선 표시). 미연결 시에도 네이버·카카오맵 길찾기 링크 즉시 사용 가능 |
| 실시간 도착 | `SEOUL_BUS_SERVICE_KEY` / `GYEONGGI_BUS_SERVICE_KEY` / `SEOUL_SUBWAY_SERVICE_KEY` 연결 시 주변 정류소 및 대중교통 경로 첫 탑승 지점 실시간 도착 조회 |
| 장소 검색 | 앱에 포함된 기본 장소만 검색. 전국 가게 실시간 검색 아님 |
| 영업시간·휴무·날씨·웨이팅 | 미연결. 자동 검증됐다고 표시하지 않음 |
| 공동 편집·계정 동기화 | 미구현. 현재 브라우저 로컬 보관함 |
| 호스팅 | 로컬 개발 및 Vercel 배포 구성(`api/transport.ts` 서버리스 함수 포함) |

### 교통 API 환경변수 (선택 연결)

로컬(`.env.local`) 또는 Vercel 프로젝트의 **Settings → Environment Variables**에 필요한 키만 등록하면 `/api/transport`가 자동으로 활성화합니다. 키가 없어도 앱은 안전하게 동작하며 직접 입력한 시간과 외부 지도 길찾기 링크를 사용할 수 있습니다.

```ini
# 도보 및 TMAP 대중교통 경로 탐색
TMAP_APP_KEY=발급받은_SK_OpenAPI_앱키
TMAP_FREE_PLAN_CONFIRMED=true
TMAP_TRANSIT_CONFIRMED=true
TMAP_MAP_DISPLAY_CONFIRMED=true

# ODSay 대중교통 경로 탐색 (선택)
ODSAY_API_KEY=발급받은_ODSay_API_키
TRANSIT_MAP_DISPLAY_CONFIRMED=true

# 서울·경기 실시간 버스 및 서울 실시간 지하철 도착
SEOUL_BUS_SERVICE_KEY=공공데이터포털_서울버스_서비스키
GYEONGGI_BUS_SERVICE_KEY=공공데이터포털_경기버스_서비스키
SEOUL_SUBWAY_SERVICE_KEY=서울열린데이터광장_실시간지하철_인증키
```

공식 자료: [OpenFreeMap](https://openfreemap.org/), [Quick start](https://openfreemap.org/quick_start/), [MapLibre 입체 건물 예제](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/).

## 보관·공유·개인정보

- 데이터는 `localStorage`의 `dayroute.library.v1`에 저장됩니다. Git 저장소에 개인 코스가 기록되지는 않습니다.
- 사진은 JPG·PNG·WebP, 원본 12MB·4,800만 화소 이하를 지원합니다. 긴 쪽 최대 1,280px·저장 문자열 최대 180,000자로 줄여 WebP로 저장하며 원본 파일과 EXIF를 보관하지 않습니다. 외부 업로드는 하지 않습니다.
- 사진도 코스 복제·파일 백업·가져오기에 포함됩니다. 브라우저 저장 용량을 넘는 사진 변경은 거절하고 이전 저장 내용을 유지합니다. 전체 저장 파일은 5MB 이내로 제한됩니다.
- 브라우저 데이터 삭제·다른 브라우저·다른 포트·다른 기기는 별도 보관함입니다. 중요한 코스는 설정 → 전체 백업으로 보관하세요.
- 파일 가져오기는 기존 코스를 유지하며 새로운 ID로 코스를 추가합니다. 최대 500코스, 코스당 100장소, 파일 5MB.
- 저장 실패·손상된 데이터는 정상 데이터로 덮어쓰지 않고 안내합니다. 복구 가져오기 전에 원본 문자열 백업을 내려받습니다.
- 여러 탭에서 변경하면 마지막 탭의 자동 덮어쓰기를 차단하고, 백업 후 최신 데이터 불러오기를 안내합니다. 공동 편집 기능이 아닙니다.
- 배포 후 보기 전용 링크는 서버 DB 없이 URL fragment(`#share=…`)에 코스 사본을 포함합니다. 일반 HTTP 요청에 fragment는 포함되지 않지만, **링크를 가진 사람은 일정·메모·위치를 볼 수 있습니다**. 암호화·접근제어·회수·자동 만료는 없습니다. 민감한 메모는 공유하지 마세요.
- 이미 공유한 사본은 이후 편집과 무관합니다. 로컬 주소는 다른 사람에게 보내도 접속되지 않으므로 파일·텍스트 공유를 안내합니다.
- URL 공유 사본에서는 사진을 제외합니다. 사진까지 보내려면 코스 파일로 공유하세요. 링크 길이와 의도하지 않은 사진 포함을 피하기 위한 동작입니다.
- 지도 제공자에는 표시 영역의 지도 요청이 전송됩니다. Google Fonts에는 글꼴 요청이 전송됩니다. GPS 권한·분석 추적·광고 SDK는 사용하지 않습니다.

## 프로젝트 구조

```text
api/
  transport.ts               Vercel 서버리스 교통 API 엔드포인트
server/
  transport.ts               도보·대중교통 경로 및 실시간 도착 정규화·캐시·한도 제어
src/
  App.tsx                    보관함·공유·백업과 앱 상태
  domain.ts                  코스·도보·대중교통 모델·시간 계산·가져오기 검증
  transport.ts               클라이언트 교통 요청·노선명 정규화·외부 지도 링크
  data.ts                    서울·경기 기본 장소와 예시 코스
  storage.ts                 로컬 저장과 백업
  routeSketch.ts             좌표 투영·동선 도형 생성
  coverPhoto.ts              브라우저 내 사진 축소·변환
  useRelease.ts              실행·복귀 시 버전 확인과 업데이트
  components/
    RouteEditor.tsx          장소·일정 편집과 미리보기
    TravelLeg.tsx            구간별 도보·대중교통 경로 조회 및 실시간 도착 확인
    BusPanel.tsx             장소 주변 정류소 탐색 및 실시간 버스 도착 모달
    MapView.tsx              지연 로딩 지도·입체 건물·경로 라인·카메라
    RouteCover.tsx           동선 기본 커버·사용자 사진
    CoverPhotoControl.tsx    사진 선택·변경·삭제
    PlacePicker.tsx          기본 장소 검색과 직접 추가
    Modal.tsx                접근 가능한 네이티브 dialog
  styles.css                 반응형 스타일·디자인 토큰
  journey.css                일정·구간 이동·버스 모달 반응형 스타일
tests/                       도메인·보관함·지도 미리보기·교통 API 테스트
vite.config.ts               빌드·버전 메타데이터·서비스 워커·개발용 API 미들웨어
docs/                        설계·검증·휴대폰 테스트 가이드
```

## 라이선스

프로젝트 자체의 공개 라이선스는 아직 지정하지 않았습니다. 코드 사용·수정·재배포·상업적 이용 허가는 저작권자에게 별도로 받아야 합니다. 의존 라이브러리·지도 데이터·사진은 각각의 라이선스가 적용됩니다. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
