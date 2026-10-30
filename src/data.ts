import { makeRoute, makeStop, type Category, type Route } from './domain.ts';
export interface Place { name: string; address: string; lng: number; lat: number; category: Category }
// Curated starter locations, not live business search. Pins are approximate; verify before visiting.
export const places: Place[] = [
  { name: '서울숲', address: '서울 성동구 뚝섬로 273', lng: 127.0374, lat: 37.5444, category: '산책' },
  { name: '성수동 카페거리', address: '서울 성동구 성수동2가 일대', lng: 127.0558, lat: 37.5438, category: '카페' },
  { name: '뚝섬한강공원', address: '서울 광진구 강변북로 139', lng: 127.0677, lat: 37.5299, category: '산책' },
  { name: '북촌한옥마을', address: '서울 종로구 계동길 일대', lng: 126.985, lat: 37.5826, category: '문화' },
  { name: '국립현대미술관 서울', address: '서울 종로구 삼청로 30', lng: 126.9802, lat: 37.5795, category: '문화' },
  { name: '경복궁', address: '서울 종로구 사직로 161', lng: 126.977, lat: 37.5796, category: '문화' },
  { name: '연남동 경의선숲길', address: '서울 마포구 연남동 일대', lng: 126.9243, lat: 37.5629, category: '산책' },
  { name: '망원한강공원', address: '서울 마포구 마포나루길 467', lng: 126.8939, lat: 37.5556, category: '산책' },
  { name: '석촌호수', address: '서울 송파구 잠실로 148', lng: 127.1036, lat: 37.5087, category: '산책' },
  { name: '수원화성 화홍문', address: '경기 수원시 팔달구 수원천로 377', lng: 127.0175, lat: 37.2876, category: '문화' },
  { name: '행궁동 카페거리', address: '경기 수원시 팔달구 신풍동 일대', lng: 127.0144, lat: 37.2835, category: '카페' },
  { name: '화성행궁', address: '경기 수원시 팔달구 정조로 825', lng: 127.0151, lat: 37.2819, category: '문화' },
  { name: '방화수류정', address: '경기 수원시 팔달구 수원천로392번길 44-6', lng: 127.0186, lat: 37.2885, category: '산책' },
  { name: '광교호수공원', address: '경기 수원시 영통구 광교호수로 165', lng: 127.0661, lat: 37.2809, category: '산책' },
  { name: '두물머리', address: '경기 양평군 양서면 두물머리길 145', lng: 127.3219, lat: 37.5311, category: '산책' },
  { name: '세미원', address: '경기 양평군 양서면 양수로 93', lng: 127.325, lat: 37.5391, category: '문화' },
  { name: '정약용유적지', address: '경기 남양주시 조안면 다산로747번길 11', lng: 127.2995, lat: 37.5158, category: '문화' },
  { name: '일산호수공원', address: '경기 고양시 일산동구 호수로 595', lng: 126.7651, lat: 37.6543, category: '산책' },
  { name: '분당중앙공원', address: '경기 성남시 분당구 성남대로 550', lng: 127.1236, lat: 37.3785, category: '산책' },
];
export function seedRoutes(): Route[] {
  return [
    { ...makeRoute(), id: 'sample-seongsu', title: '천천히 걷는 성수의 오후', description: '커피 한 잔, 초록빛 산책. 서두르지 않고 보내는 우리만의 하루.',
      theme: 'forest', region: '서울 · 성수', favorite: true, startTime: '13:00', stops: [
        makeStop({ ...places[1], duration: 70, travelMinutes: 20, cost: 16000, note: '마음에 드는 카페를 골라보기. 카페거리를 대표하는 예시 위치예요.' }),
        makeStop({ ...places[0], duration: 90, travelMinutes: 25, note: '사진도 찍고, 벤치에서 잠깐 쉬어가자.' }),
        makeStop({ ...places[2], duration: 60, note: '날씨가 좋으면 강변에서 하루를 마무리하기.' }),
      ] },
    { ...makeRoute(), id: 'sample-suwon', title: '골목 끝에서 만나는 행궁동', description: '낮은 담장과 작은 가게들, 걷다가 발견하는 좋은 순간.',
      theme: 'town', region: '경기 · 수원', startTime: '12:30', stops: [
        makeStop({ ...places[11], duration: 60, travelMinutes: 10 }),
        makeStop({ ...places[10], duration: 60, travelMinutes: 15, cost: 16000 }),
        makeStop({ ...places[12], duration: 45 }),
      ] },
    { ...makeRoute(), id: 'sample-yangpyeong', title: '물가에 머무는 주말', description: '멀리 가지 않아도 여행처럼. 양평에서 한 박자 쉬어가기.',
      theme: 'river', region: '경기 · 양평', startTime: '14:00', stops: [
        makeStop({ ...places[14], duration: 80, travelMinutes: 20 }),
        makeStop({ ...places[15], duration: 70 }),
      ] },
  ];
}
