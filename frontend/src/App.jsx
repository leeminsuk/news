/* eslint-disable react/prop-types */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './App.css';

const AXIOS_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api/v1';
const AUTH_BASE_URL = AXIOS_BASE_URL.replace(/\/api\/v1\/?$/, '') + '/api/auth';
const ACCESS_TOKEN_KEY = 'newsbrief_access_token';
const REFRESH_TOKEN_KEY = 'newsbrief_refresh_token';

const SOCIAL_CONFIG = {
  google: {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    sdk: 'https://accounts.google.com/gsi/client',
  },
  apple: {
    clientId: import.meta.env.VITE_APPLE_CLIENT_ID || '',
    redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI || (typeof window !== 'undefined' ? window.location.origin : ''),
    sdk: 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
  },
  kakao: {
    appKey: import.meta.env.VITE_KAKAO_APP_KEY || '',
    sdk: 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js',
  },
};

const loadedScripts = new Set();
function loadScript(url) {
  if (typeof document === 'undefined') return Promise.reject(new Error('NO_DOM'));
  if (loadedScripts.has(url)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) { loadedScripts.add(url); return resolve(); }
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.defer = true;
    s.onload = () => { loadedScripts.add(url); resolve(); };
    s.onerror = () => reject(new Error(`SDK_LOAD_FAILED:${url}`));
    document.head.appendChild(s);
  });
}

async function getGoogleIdToken() {
  const { clientId, sdk } = SOCIAL_CONFIG.google;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID_MISSING');
  await loadScript(sdk);
  if (!window.google?.accounts?.id) throw new Error('GOOGLE_SDK_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => { if (settled) return; settled = true; fn(val); };
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response?.credential) finish(resolve, response.credential);
        else finish(reject, new Error('GOOGLE_NO_CREDENTIAL'));
      },
      cancel_on_tap_outside: true,
    });
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        finish(reject, new Error('GOOGLE_PROMPT_DISMISSED'));
      }
    });
  });
}

async function getAppleIdToken() {
  const { clientId, redirectURI, sdk } = SOCIAL_CONFIG.apple;
  if (!clientId) throw new Error('VITE_APPLE_CLIENT_ID_MISSING');
  await loadScript(sdk);
  if (!window.AppleID?.auth) throw new Error('APPLE_SDK_UNAVAILABLE');
  window.AppleID.auth.init({ clientId, scope: 'name email', redirectURI, usePopup: true });
  const result = await window.AppleID.auth.signIn();
  const idToken = result?.authorization?.id_token;
  if (!idToken) throw new Error('APPLE_NO_ID_TOKEN');
  return idToken;
}

async function getKakaoIdToken() {
  const { appKey, sdk } = SOCIAL_CONFIG.kakao;
  if (!appKey) throw new Error('VITE_KAKAO_APP_KEY_MISSING');
  await loadScript(sdk);
  if (!window.Kakao) throw new Error('KAKAO_SDK_UNAVAILABLE');
  if (!window.Kakao.isInitialized()) window.Kakao.init(appKey);
  return new Promise((resolve, reject) => {
    window.Kakao.Auth.login({
      scope: 'openid profile_nickname account_email',
      success: (resp) => {
        const token = resp.id_token || resp.access_token;
        if (token) resolve(token);
        else reject(new Error('KAKAO_NO_TOKEN'));
      },
      fail: (err) => reject(new Error(`KAKAO_FAIL:${err?.error || 'unknown'}`)),
    });
  });
}

async function fetchProviderIdToken(provider) {
  if (provider === 'google') return getGoogleIdToken();
  if (provider === 'apple') return getAppleIdToken();
  if (provider === 'kakao') return getKakaoIdToken();
  throw new Error(`UNKNOWN_PROVIDER:${provider}`);
}

const apiClient = axios.create({
  baseURL: AXIOS_BASE_URL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
});

const authClient = axios.create({
  baseURL: AUTH_BASE_URL,
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const COUNTRY_OPTIONS = [
  { key: 'kr', label: '한국', short: 'KR', flag: '🇰🇷', desc: '네이버 뉴스 주요 피드' },
  { key: 'us', label: '미국', short: 'US', flag: '🇺🇸', desc: 'CNN 주요 뉴스 피드' },
  { key: 'jp', label: '일본', short: 'JP', flag: '🇯🇵', desc: '야후재팬 주요 토픽' },
];

const CATEGORY_OPTIONS = [
  { key: 'all', label: '전체', api: undefined, icon: '🗞️', desc: '전체 브리핑' },
  { key: 'politics', label: '정치', api: 'politics', icon: '🏛️', desc: '선거, 정당, 국회' },
  { key: 'economy', label: '경제', api: 'economy', icon: '💰', desc: '금융, 재테크, 부동산' },
  { key: 'society', label: '사회', api: 'society', icon: '👥', desc: '사건사고, 트렌드' },
  { key: 'it', label: '기술·IT', api: 'tech', icon: '💻', desc: 'AI, 반도체, 모빌리티' },
  { key: 'sports', label: '스포츠', api: 'sports', icon: '⚽', desc: '축구, 야구, 올림픽' },
  { key: 'entertainment', label: '연예·문화', api: 'entertainment', icon: '🎬', desc: '영화, OTT, 음악' },
];

const CATEGORY_LABEL_BY_API = {
  tech: '기술·IT', it: '기술·IT', politics: '정치', economy: '경제', society: '사회', sports: '스포츠', entertainment: '연예·문화',
  '기술·IT': '기술·IT', 정치: '정치', 경제: '경제', 사회: '사회', 스포츠: '스포츠', '연예·문화': '연예·문화',
};

const DEFAULT_FOLDERS = [
  { id: 1, name: 'AI·반도체', icon: '🔮', count: 3 },
  { id: 2, name: '금융·부동산', icon: '🏦', count: 0 },
  { id: 3, name: '국제 정세', icon: '🧭', count: 0 },
];

const DEFAULT_NOTIFICATIONS = [
  { id: 1, section: 'today', type: 'session', icon: '🔄', iconClass: 'noti-blue-circle', title: '14:00 세션 업데이트', desc: '한국·기술·IT 카테고리에 새 기사 5건 도착', time: '방금', unread: true },
  { id: 2, section: 'today', type: 'hotissue', icon: '🔥', iconClass: 'noti-pink-circle', title: '핫이슈 알림', desc: '"반도체 수출" 관련 기사가 3개 세션 연속 1위', time: '2시간 전', unread: true },
  { id: 3, section: 'today', type: 'comment', icon: '💬', iconClass: 'noti-brown-circle', title: '스크랩 기사 댓글', desc: '"한은 기준금리 동결" 기사에 댓글 47개 추가됨', time: '4시간 전', unread: true },
  { id: 4, section: 'yesterday', type: 'cleanup', icon: '🧹', iconClass: 'noti-gray-circle', title: '세션 자동 정리', desc: '30시간이 지난 세션 2개가 자동 삭제되었습니다.', time: '어제', unread: false },
];

const DEFAULT_SCRAPS = [
  { id: 901, scrapId: 901, articleId: 1, folderId: 1, category: '기술·IT', source: '🇰🇷 한국 · 오늘 14:00 세션', title: '반도체 수출 3개월 연속 증가, AI 수요가 견인', bullets: ['HBM 등 AI용 메모리가 성장 주도하며 평균 단가도 상승'], replies: 142, dateText: '10분 전 스크랩' },
  { id: 902, scrapId: 902, articleId: 10, folderId: 1, category: '기술·IT', source: '🇺🇸 미국 · 어제 19:00 세션', title: 'Nvidia, 차세대 GPU 출하 일정 공개', bullets: ['B200 아키텍처 기반 GPU가 4분기부터 본격 공급될 예정'], replies: 95, dateText: '어제 스크랩' },
  { id: 903, scrapId: 903, articleId: 20, folderId: 1, category: '기술·IT', source: '🇯🇵 일본 · 2일 전 09:00 세션', title: '日 정부, 반도체 산업에 1조엔 추가 지원', bullets: ['TSMC 쿠마모토 2공장 건설을 비롯한 국내 생산 거점 강화'], replies: 64, dateText: '2일 전 스크랩' },
];

const DEFAULT_SOURCE_BY_COUNTRY = {
  kr: { source: '네이버 뉴스', url: 'https://news.naver.com' },
  us: { source: 'CNN', url: 'https://cnn.com' },
  jp: { source: '야후재팬 뉴스', url: 'https://news.yahoo.co.jp' },
};

// 각 핀(pillIdx 0=가장 오래된 ... 5=지금)마다 6개의 고유 기사 세트.
// 백엔드 미응답 시 fallback용 — pill timestamp랑 어울리는 시간대 헤드라인을 사용해 6개 슬롯이 시각적으로 구분되도록 한다.
const SESSION_MOCK_BY_COUNTRY = {
  kr: [
    // pillIdx 0 — 어제 오후 시간대
    [
      { category: '경제', source: '네이버 뉴스', title: '코스피, 외국인 5거래일 연속 순매수에 2,710선 회복', bullets: ['반도체·2차전지 대형주가 지수 상승 견인', '환율 안정세도 외국인 자금 유입 도움'], replies: 287 },
      { category: '기술·IT', source: '아이뉴스24', title: 'SK하이닉스, HBM3E 16단 양산 공정 진입 임박', bullets: ['차세대 AI 메모리 시장 선점 위한 추가 투자 결정'], replies: 198 },
      { category: '정치', source: '중앙일보', title: '국회 환노위, 노란봉투법 본회의 회부 시점 협상 재개', bullets: ['여야 입장 차이 좁히지 못해 표결 일정 미정'], replies: 451 },
      { category: '사회', source: '동아일보', title: '서울시, 야간 자율주행 셔틀 강남·여의도 시범 운행', bullets: ['총 4개 노선 우선 적용, 안전요원 동승 의무화'], replies: 132 },
      { category: '스포츠', source: '스포츠서울', title: 'KBO 올스타전 명단 발표, LG·KIA 최다 선수 배출', bullets: ['팬 투표 외야수 부문 1위는 김도영'], replies: 524 },
      { category: '연예·문화', source: '스포츠조선', title: '아이브, 도쿄 돔 단독 콘서트 전석 매진 행진', bullets: ['1만 5천 좌석 5분 만에 매진, 추가 공연 검토'], replies: 312 },
    ],
    // pillIdx 1 — 어제 저녁 시간대
    [
      { category: '경제', source: '네이버 뉴스', title: '코스피 1.4% 상승 마감, 코스닥도 동반 강세', bullets: ['종가 기준 연중 최고치 경신, 거래대금 14조 돌파'], replies: 364 },
      { category: '정치', source: '한겨레', title: '야당, 추경 협상 결렬 책임 두고 의총 소집', bullets: ['이번 주 내 단독 발의 여부 결정 예정'], replies: 528 },
      { category: '사회', source: 'YTN', title: '서울 지하철 2호선 신호 장애로 30분간 지연', bullets: ['퇴근길 시민 수만 명 불편, 코레일 사과 발표'], replies: 412 },
      { category: '기술·IT', source: '디지털타임스', title: '구글, 한국에 두 번째 데이터센터 설립 발표', bullets: ['세종시 인근 5만 평 부지 검토, 2027년 가동 목표'], replies: 287 },
      { category: '스포츠', source: 'KBL', title: 'V-리그 챔피언결정전, 현대캐피탈 5차전서 우승', bullets: ['8년 만의 통합 우승, MVP는 허수봉 선수'], replies: 198 },
      { category: '연예·문화', source: 'OSEN', title: '주말 드라마 "달이 차오른다", 시청률 17% 돌파', bullets: ['종영 2회 남기고 자체 최고 시청률 경신'], replies: 256 },
    ],
    // pillIdx 2 — 오늘 자정
    [
      { category: '사회', source: '연합뉴스', title: '인천 부평구 상가 건물서 새벽 화재, 인명 피해 없어', bullets: ['소방서 추정 손실액 약 1억 8천만 원'], replies: 167 },
      { category: '경제', source: '한국경제', title: '뉴욕증시 3대 지수 동반 사상 최고치 마감', bullets: ['S&P 500·나스닥 동시 신고가, AI 관련주 강세 지속'], replies: 421 },
      { category: '기술·IT', source: '코인데스크코리아', title: '비트코인 7만 4천 달러 돌파 후 단기 조정', bullets: ['ETF 자금 유입 둔화에 차익 실현 매물 등장'], replies: 312 },
      { category: '정치', source: '서울신문', title: '美 의회, 한반도 안보 청문회서 한미 공조 강화 합의', bullets: ['차세대 미사일 방어 기술 공동 개발 논의'], replies: 287 },
      { category: '스포츠', source: '스포츠동아', title: '류현진, MLB 복귀전서 6이닝 무실점 호투', bullets: ['시속 153km 직구 회복, 다음 등판 일정 확정'], replies: 583 },
      { category: '연예·문화', source: '빌보드코리아', title: '뉴진스, 빌보드 핫100 7주 연속 톱10 진입', bullets: ['"Supernatural" 9위 유지, K팝 최장 기록 갱신'], replies: 471 },
    ],
    // pillIdx 3 — 오늘 새벽
    [
      { category: '사회', source: 'KBS', title: '강원 영동 지역에 호우주의보, 산사태 위험 경보', bullets: ['시간당 30mm 폭우 예보, 출근길 통제 가능성'], replies: 142 },
      { category: '경제', source: '이데일리', title: '원/달러 환율 1,372원 출발 전망', bullets: ['지난밤 미 달러 약세 영향, 수출 기업 채산성 부담 완화'], replies: 198 },
      { category: '기술·IT', source: 'AI타임스', title: 'OpenAI, GPT-5 정식 출시 임박 단계 진입', bullets: ['멀티모달 추론 강화, 한국어 응답 품질 대폭 개선'], replies: 612 },
      { category: '정치', source: '외교부', title: '외교부, 한일 정상회담 의제 조율 마무리 단계', bullets: ['반도체 공급망·인공지능 협력 의제 포함'], replies: 256 },
      { category: '스포츠', source: '점프볼', title: 'NBA 파이널 5차전, 셀틱스 시리즈 결승골 빛났다', bullets: ['타이리스 매슈가 결정적 3점슛 적중'], replies: 387 },
      { category: '연예·문화', source: '버라이어티 코리아', title: '봉준호 신작, 칸 영화제 비경쟁 부문 공식 초청', bullets: ['이병헌·송강호 출연, 9월 국내 개봉 예정'], replies: 425 },
    ],
    // pillIdx 4 — 오늘 오전
    [
      { category: '경제', source: '머니투데이', title: '코스피 0.6% 상승 출발, 외국인 매수 지속', bullets: ['반도체·자동차 업종 강세, 거래량 평소보다 활발'], replies: 312 },
      { category: '정치', source: '대통령실', title: '대통령, 시민단체와 노동 정책 간담회 개최', bullets: ['최저임금·근로시간 등 핵심 의제 폭넓게 논의'], replies: 487 },
      { category: '사회', source: 'TBS', title: '출근길 강변북로 5중 추돌, 1시간 정체', bullets: ['인명피해 없음, 차량 견인 완료까지 우회 권고'], replies: 234 },
      { category: '기술·IT', source: 'ZDNet 코리아', title: '네이버, 자체 LLM "하이퍼클로바X 2" 전면 공개', bullets: ['파라미터 2조 규모, 추론 비용 30% 절감 강조'], replies: 542 },
      { category: '스포츠', source: 'KFA', title: '여자 축구 대표팀, 호주 원정 평가전 2-1 승리', bullets: ['지소연 결승골, 9월 아시안컵 분위기 끌어올려'], replies: 198 },
      { category: '연예·문화', source: '스타뉴스', title: '아이유 컴백 D-3, 멜론 인기예약 1위 등극', bullets: ['타이틀곡 "햇살의 결" 티저 영상 누적 조회 800만'], replies: 612 },
    ],
    // pillIdx 5 — 지금 (오후)
    [
      { category: '기술·IT', source: '네이버 뉴스', title: '반도체 수출 3개월 연속 증가, AI 수요가 견인', bullets: ['5월 반도체 수출액 전년 대비 18% 증가', 'HBM 등 AI용 메모리가 성장 주도'], replies: 142 },
      { category: '경제', source: '네이버 뉴스', title: '한은 기준금리 동결, 시장 예상 부합', bullets: ['금통위 만장일치로 2.75% 유지 결정', '물가 안정세 지속이라고 판단'], replies: 87 },
      { category: '정치', source: '네이버 뉴스', title: '국회 본회의서 민생법안 7건 통과', bullets: ['소상공인 지원법 개정안 등 여야 합의 처리', '주거안정 관련 법안도 함께 의결'], replies: 312 },
      { category: '사회', source: '연합뉴스', title: '수도권 출퇴근 30분 단축, 광역버스 노선 대폭 확대', bullets: ['정부, 교통 사각지대 해소를 위한 대책 발표', '다음 달부터 순차적 운행 개시'], replies: 215 },
      { category: '스포츠', source: '일간스포츠', title: '손흥민, 시즌 마지막 경기서 극적 결승골 작렬', bullets: ['팀 내 최다 득점 기록 갱신하며 시즌 마무리', '평점 9.2로 경기 MVP 선정'], replies: 642 },
      { category: '연예·문화', source: 'OSEN', title: 'K-콘텐츠 글로벌 서밋 개막, 전 세계 바이어 집결', bullets: ['국내 주요 제작사 신작 라인업 공개', 'OTT 플랫폼 최적화 계약 성과 속출'], replies: 104 },
    ],
  ],
  us: [
    // pillIdx 0
    [
      { category: '기술·IT', source: 'The Verge', title: 'Apple Vision Pro 2 Said to Launch Lighter Design Next Spring', bullets: ['Reports cite weight reduction of nearly 30%'], replies: 412 },
      { category: '경제', source: 'Bloomberg', title: 'US 10-Year Treasury Yields Climb Above 4.4%', bullets: ['Bond investors react to stronger jobs data'], replies: 287 },
      { category: '정치', source: 'Politico', title: 'Senate Advances Bipartisan Border Security Bill', bullets: ['Cloture vote passes 68-32, final vote tomorrow'], replies: 521 },
      { category: '사회', source: 'AP', title: 'California Wildfire Forces Evacuation of 2,000 Residents', bullets: ['Firefighters race to contain 7,500-acre blaze'], replies: 312 },
      { category: '스포츠', source: 'ESPN', title: 'NBA Finals Heads to Game 6 After Celtics Force Decider', bullets: ['Jaylen Brown drops 35 in crucial road win'], replies: 612 },
      { category: '연예·문화', source: 'Variety', title: 'Marvel Confirms "Avengers: Secret Wars" Casting Lineup', bullets: ['Robert Downey Jr. returns as new villain Doctor Doom'], replies: 824 },
    ],
    // pillIdx 1
    [
      { category: '경제', source: 'Reuters', title: 'S&P 500 Closes Up 0.7% Led by Tech and Energy', bullets: ['Nvidia, Exxon among top gainers'], replies: 367 },
      { category: '정치', source: 'The Hill', title: 'House Speaker Outlines Year-End Spending Priorities', bullets: ['Defense and border funding top the list'], replies: 421 },
      { category: '사회', source: 'CNN', title: 'Tropical Storm Eduardo Strengthens to Category 1 Hurricane', bullets: ['NHC issues warnings for parts of Gulf Coast'], replies: 287 },
      { category: '기술·IT', source: 'TechCrunch', title: 'Microsoft Unveils Copilot Agents for Enterprise Workflows', bullets: ['Available to 365 Premium customers from next month'], replies: 312 },
      { category: '스포츠', source: 'WNBA', title: 'Caitlin Clark Sets New WNBA Single-Game Assist Record', bullets: ['Indiana Fever guard notches 19 assists in win'], replies: 521 },
      { category: '연예·문화', source: 'BroadwayWorld', title: 'Tony Awards 2026 Nominations Spark Surprises', bullets: ['Off-Broadway hit "Bridges" leads with 11 nods'], replies: 198 },
    ],
    // pillIdx 2
    [
      { category: '사회', source: 'NBC News', title: 'Thousands Rally in NYC Over Housing Affordability Crisis', bullets: ['Marchers call on city council to expand rent caps'], replies: 412 },
      { category: '경제', source: 'CNBC', title: 'Dollar Index Eases to 4-Week Low Against Major Currencies', bullets: ['Soft labor data fuels Fed cut speculation'], replies: 287 },
      { category: '기술·IT', source: 'Electrek', title: 'Tesla Cybertruck Refresh Adds Off-Road Package', bullets: ['New 35-inch tires and extended battery option detailed'], replies: 521 },
      { category: '정치', source: 'Washington Post', title: 'White House Issues Statement Condemning Middle East Strikes', bullets: ['Administration urges restraint, opens emergency channels'], replies: 612 },
      { category: '스포츠', source: 'MLB.com', title: 'Late-Inning Walk-Off Lifts Dodgers Past Padres', bullets: ['Mookie Betts homers off the foul pole in the 10th'], replies: 387 },
      { category: '연예·문화', source: 'Vulture', title: 'Late Night Hosts Skewer Latest Senate Drama', bullets: ['Stewart and Colbert deliver double-team monologue'], replies: 256 },
    ],
    // pillIdx 3
    [
      { category: '사회', source: 'Reuters', title: 'Pre-Dawn Earthquake Magnitude 4.5 Hits Northern California', bullets: ['No major damage reported, USGS monitoring aftershocks'], replies: 142 },
      { category: '경제', source: 'MarketWatch', title: 'US Futures Point Higher Ahead of Inflation Report', bullets: ['Traders position for Fed minutes release later today'], replies: 198 },
      { category: '기술·IT', source: 'Space.com', title: 'SpaceX Falcon 9 Successfully Launches 22 Starlink Satellites', bullets: ['Booster makes 18th successful landing'], replies: 412 },
      { category: '정치', source: 'Defense News', title: 'Pentagon Approves New Arms Package to Pacific Allies', bullets: ['Includes advanced radar and missile defense components'], replies: 287 },
      { category: '스포츠', source: 'ESPN', title: 'NBA Late Game: Lakers Edge Warriors in OT Thriller', bullets: ['LeBron and Davis combine for 67 points'], replies: 612 },
      { category: '연예·문화', source: 'Deadline', title: 'Netflix Greenlights Sequel to Hit Sci-Fi Series "Echoes"', bullets: ['Production scheduled to begin in Vancouver next fall'], replies: 234 },
    ],
    // pillIdx 4
    [
      { category: '경제', source: 'CNBC', title: 'Wall Street Opens Mixed as Investors Digest Jobs Data', bullets: ['Dow flat, Nasdaq edges up 0.3% at open'], replies: 312 },
      { category: '정치', source: 'CNN', title: 'President Departs for G7 Summit in Italy', bullets: ['Trade and climate cooperation top the agenda'], replies: 487 },
      { category: '사회', source: 'NBC News', title: 'Northeast Heatwave Triggers Cooling Center Activations', bullets: ['NYC, Boston, Philadelphia all open emergency facilities'], replies: 234 },
      { category: '기술·IT', source: 'Google Blog', title: 'Google Announces Gemini Ultra 2 with Enhanced Reasoning', bullets: ['Available to Workspace customers globally starting today'], replies: 542 },
      { category: '스포츠', source: 'FOX Sports', title: 'USMNT Begins World Cup Qualifier Camp in Florida', bullets: ['Coach reveals 26-man squad ahead of Honduras tie'], replies: 198 },
      { category: '연예·문화', source: 'Hollywood Reporter', title: 'Streaming Wars: Disney+ Subscribers Cross 200M Mark', bullets: ['Profitability target reached one quarter ahead of plan'], replies: 612 },
    ],
    // pillIdx 5 — 지금
    [
      { category: '기술·IT', source: 'CNN Business', title: 'Nvidia Market Cap Surpasses Apple Amid AI Boom', bullets: ['Nvidia becomes the second most valuable US company', 'Stock surges following quarterly earnings'], replies: 521 },
      { category: '경제', source: 'Wall Street Journal', title: 'Fed Hints at Rate Cuts Later This Year as Inflation Cools', bullets: ['CPI rose less than expected in April', 'Powell emphasizes data-dependent approach'], replies: 419 },
      { category: '사회', source: 'New York Times', title: 'New Green Space Initiative Launches Across Major US Cities', bullets: ['Federal funding allocated to restore urban parks', 'Program aims to reduce heat islands'], replies: 135 },
      { category: '정치', source: 'Politico', title: 'Senate Confirms Three Federal Judges in Bipartisan Vote', bullets: ['Confirmations clear backlog ahead of summer recess'], replies: 287 },
      { category: '스포츠', source: 'ESPN', title: 'NBA Finals MVP Race Tightens Heading Into Game 7', bullets: ['Tatum and Doncic each carry top-3 odds with sportsbooks'], replies: 612 },
      { category: '연예·문화', source: 'Variety', title: 'Pixar Reveals First Look at Original Animated Feature "Atlas"', bullets: ['Director Pete Docter returns with summer 2027 release'], replies: 412 },
    ],
  ],
  jp: [
    // pillIdx 0
    [
      { category: '경제', source: '야후재팬 뉴스', title: '日銀、金融政策の段階的正常化を再確認', bullets: ['追加利上げ時期は秋以降を示唆'], replies: 167 },
      { category: '정치', source: '朝日新聞', title: '与党、税制改正の最終案で党内協議継続', bullets: ['年末までの取りまとめを目指す'], replies: 234 },
      { category: '사회', source: 'NHK', title: '東京湾岸エリアで震度4の地震、津波の心配なし', bullets: ['鉄道は数十分の遅延発生'], replies: 312 },
      { category: '기술·IT', source: '日経新聞', title: 'ソニー、新型イメージセンサーをスマホ向けに量産', bullets: ['暗所撮影性能を最大40%向上'], replies: 198 },
      { category: '스포츠', source: 'スポーツ報知', title: 'プロ野球セ・リーグ首位攻防、巨人が阪神を下す', bullets: ['岡本和真が決勝3ランで完封勝利'], replies: 287 },
      { category: '연예·문화', source: '映画.com', title: '是枝裕和監督の新作、第78回カンヌ映画祭で銀賞受賞', bullets: ['日本人監督として5年ぶりの主要賞獲得'], replies: 412 },
    ],
    // pillIdx 1
    [
      { category: '경제', source: '日経新聞', title: '円相場、対ドルで一時157円台に乗せ年初来安値圏', bullets: ['米長期金利上昇と日銀政策据え置き観測が背景'], replies: 287 },
      { category: '정치', source: '読売新聞', title: '国会、衆参両院議長が議事日程協議', bullets: ['予算審議の前倒し可否が焦点に'], replies: 198 },
      { category: '사회', source: '毎日新聞', title: '首都圏で大雨、JR山手線が一部区間で運転見合わせ', bullets: ['帰宅ラッシュ直撃、振替輸送実施'], replies: 412 },
      { category: '기술·IT', source: 'ITmedia', title: 'NTTドコモ、5GオールSAエリアを全国主要都市に拡大', bullets: ['年内には人口カバー率90%超を目指す'], replies: 156 },
      { category: '스포츠', source: 'スポニチ', title: 'Jリーグ首位攻防、ヴィッセル神戸が川崎を退ける', bullets: ['大迫勇也が決勝点、首位独走へ大きな一歩'], replies: 234 },
      { category: '연예·문화', source: 'オリコン', title: 'NHK紅白歌合戦、出場歌手第一弾を発表', bullets: ['若手アーティスト10組以上が初出場の見通し'], replies: 312 },
    ],
    // pillIdx 2
    [
      { category: '사회', source: 'NHK', title: '東京・新宿で深夜の火災、けが人なし', bullets: ['雑居ビル4階から出火、約2時間後に鎮火'], replies: 142 },
      { category: '경제', source: 'ロイター', title: 'NY市場のドル円、156円後半で取引終了', bullets: ['米雇用統計を控えポジション調整の動き'], replies: 198 },
      { category: '기술·IT', source: '東洋経済', title: 'トヨタ、全固体電池搭載EVの先行量産を発表', bullets: ['2027年型「bZ5」シリーズに最初に採用'], replies: 412 },
      { category: '정치', source: 'BBC日本語', title: '国連安保理、東アジア情勢めぐる緊急会合を開催', bullets: ['日本も非常任理事国として発言、緊張緩和を訴え'], replies: 287 },
      { category: '스포츠', source: 'MLB公式', title: '大谷翔平、3戦連続ホームランで打率4割台に', bullets: ['ナ・リーグ本塁打王争いを大きくリード'], replies: 612 },
      { category: '연예·문화', source: 'Billboard JAPAN', title: 'YOASOBI、米ビルボードチャートで自己最高位を記録', bullets: ['"アイドル英語版"が総合43位に浮上'], replies: 471 },
    ],
    // pillIdx 3
    [
      { category: '사회', source: 'NHK', title: '北海道で観測史上3番目の早さで桜開花', bullets: ['平年より2週間以上早く春の訪れ'], replies: 132 },
      { category: '경제', source: '時事通信', title: '東京市場、寄り付き前から先物指数が上昇', bullets: ['NY続伸を受け輸出株中心に買い先行の見通し'], replies: 167 },
      { category: '기술·IT', source: '日経新聞', title: 'ラピダス、2ナノ次世代半導体試作工程を年内稼働', bullets: ['北海道千歳工場の建設工事は順調に進捗'], replies: 234 },
      { category: '정치', source: '外務省', title: '外相、ASEAN関連会合へ向け出発', bullets: ['経済安全保障とサプライチェーン強化を協議'], replies: 198 },
      { category: '스포츠', source: 'バスケット・カウント', title: 'バスケB1リーグ早朝速報、千葉ジェッツが連勝', bullets: ['原修太がチーム最多得点で勝利に貢献'], replies: 156 },
      { category: '연예·문화', source: 'Cinemacafe', title: 'スタジオジブリ新作、年末公開予定で予告編解禁', bullets: ['宮崎吾朗監督2作目、世界同時公開を狙う'], replies: 412 },
    ],
    // pillIdx 4
    [
      { category: '경제', source: '日経新聞', title: '日経平均、午前の取引で4万円台を回復', bullets: ['半導体関連株が指数を押し上げ'], replies: 287 },
      { category: '정치', source: '官邸', title: '総理、与野党党首会談を午後に開催', bullets: ['物価高対策と所得補填措置が議題の中心'], replies: 421 },
      { category: '사회', source: 'TBS', title: '通勤ラッシュ時の山手線、信号トラブルで遅延', bullets: ['池袋〜上野間で一時運転見合わせ'], replies: 198 },
      { category: '기술·IT', source: 'ITmedia AI+', title: 'ソフトバンク、独自LLM「Geminize-J」一般提供開始', bullets: ['日本語特化モデル、月額利用料は1,980円'], replies: 312 },
      { category: '스포츠', source: 'スポーツ報知', title: '女子サッカー日本代表、欧州遠征メンバー発表', bullets: ['長谷川唯ら主力召集、新人2名も合流'], replies: 234 },
      { category: '연예·문화', source: 'モデルプレス', title: '朝の音楽番組ランキング、Mrs. GREEN APPLE首位', bullets: ['新曲「春景」が再生数1億回突破'], replies: 521 },
    ],
    // pillIdx 5 — 지금
    [
      { category: '경제', source: '야후재팬 뉴스', title: '日経平均株価、半導체関連株牽引で再び3万9千円突破', bullets: ['도쿄일렉트론 등 주요 장비 기업 주가 동반 급등'], replies: 93 },
      { category: '기술·IT', source: '日経新聞', title: 'ラピダス、2ナノ次世代半導체試作工程を年内稼働', bullets: ['홋카이도 치토세 공장 건설 순항 중'], replies: 74 },
      { category: '정치', source: '読売新聞', title: '与党、政治資金規正法改正案を本会議に提出', bullets: ['企業献金の上限規制を強化、罰則も明文化'], replies: 198 },
      { category: '사회', source: '朝日新聞', title: '東京メトロ、混雑緩和に向けピーク時運転本数を増便', bullets: ['丸ノ内·東西·有楽町의 3개 노선 우선 적용'], replies: 156 },
      { category: '스포츠', source: 'スポニチ', title: '大谷翔平 23호 홈런, 어니언스 격파에 결정적 한 방', bullets: ['시즌 OPS 1.180으로 메이저리그 단연 1위'], replies: 612 },
      { category: '연예·문화', source: 'NHK', title: '"カムカム" 続編 발표, 새 주인공 캐스팅 공개', bullets: ['NHK 아침 드라마 2027년 봄 방영 예정'], replies: 287 },
    ],
  ],
};

function withDefaults(article, idx, country, pillIdx) {
  const def = DEFAULT_SOURCE_BY_COUNTRY[country] || { source: '뉴스브리프', url: '#' };
  return {
    ...article,
    id: article.id ?? `${country}-p${pillIdx}-${idx}`,
    source: article.source || def.source,
    originalUrl: article.originalUrl || def.url,
  };
}

const MOCK_ARTICLES = {
  kr: SESSION_MOCK_BY_COUNTRY.kr[5].map((a, i) => withDefaults(a, i, 'kr', 5)),
  us: SESSION_MOCK_BY_COUNTRY.us[5].map((a, i) => withDefaults(a, i, 'us', 5)),
  jp: SESSION_MOCK_BY_COUNTRY.jp[5].map((a, i) => withDefaults(a, i, 'jp', 5)),
};

function getMockArticlesForSession(country, category, pillIdx) {
  const pool = SESSION_MOCK_BY_COUNTRY[country];
  if (!pool) return [];
  const safeIdx = Math.max(0, Math.min(pool.length - 1, pillIdx));
  const articles = pool[safeIdx].map((a, i) => withDefaults(a, i, country, safeIdx));
  const selected = CATEGORY_OPTIONS.find((item) => item.key === category);
  if (!selected || category === 'all') return articles;
  return articles.filter((article) => article.category === selected.label);
}

const DEFAULT_COMMENTS = {
  1: [
    { id: 101, author: '반도체주주', text: '삼전 하이닉스 드디어 고개 드네. 내 평단까지 가자.', time: '5분 전' },
    { id: 102, author: 'AI네비게이터', text: 'HBM 공급 부족은 한동안 계속될 듯.', time: '20분 전' },
  ],
  2: [{ id: 201, author: '영끌러', text: '금리 좀 시원하게 인하해 줬으면 좋겠네요.', time: '1시간 전' }],
};

function unwrap(data) {
  if (Array.isArray(data)) return data;
  return data?.data ?? data?.items ?? data?.content ?? data?.results ?? data?.notifications ?? data?.articles ?? data?.scraps ?? data?.folders ?? data;
}

function normalizeArticle(raw = {}, index = 0, currentCat = 'all') {
  const id = raw.id ?? raw.news_id ?? raw.article_id ?? raw.articleId ?? `${Date.now()}-${index}`;
  const rawCategory = raw.category_name ?? raw.categoryName ?? raw.category ?? raw.category_key ?? currentCat;
  const summary = raw.summary ?? raw.ai_summary ?? raw.aiSummary ?? raw.description ?? raw.content ?? '';
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets
    : String(summary || '').split(/\n|•|- /).map((v) => v.trim()).filter(Boolean).slice(0, 3);
  return {
    id,
    articleId: id,
    sessionId: raw.session_id ?? raw.sessionId,
    rank: raw.rank ?? index + 1,
    category: CATEGORY_LABEL_BY_API[rawCategory] || rawCategory || '뉴스',
    source: raw.source_name ?? raw.sourceName ?? raw.source ?? raw.publisher ?? '뉴스브리프',
    title: raw.title ?? raw.headline ?? '제목 없는 기사',
    bullets: bullets.length ? bullets : ['세션 요약 데이터가 존재하지 않습니다.'],
    replies: raw.reply_count ?? raw.replies ?? raw.comment_count ?? raw.commentsCount ?? (raw.trend_score ? Math.floor(raw.trend_score / 10) : 0),
    originalUrl: raw.original_url ?? raw.originalUrl ?? raw.url ?? raw.link,
    publishedAt: raw.published_at ?? raw.publishedAt ?? raw.created_at ?? raw.createdAt,
  };
}

function normalizeFolder(raw = {}, index = 0) {
  return {
    id: raw.id ?? raw.folder_id ?? raw.folderId ?? index + 1,
    name: raw.name ?? raw.folder_name ?? raw.folderName ?? `폴더 ${index + 1}`,
    icon: raw.icon ?? ['🔮', '🏦', '🧭', '📁', '📊', '🔥'][index % 6],
    count: raw.count ?? raw.scrap_count ?? raw.scrapCount ?? raw.article_count ?? 0,
  };
}

function normalizeScrap(raw = {}, index = 0, fallbackFolderId = 1) {
  const article = raw.article ?? raw.news ?? raw.newsArticle ?? raw;
  const normalized = normalizeArticle(article, index);
  return {
    ...normalized,
    id: raw.id ?? raw.scrap_id ?? raw.scrapId ?? normalized.id,
    scrapId: raw.id ?? raw.scrap_id ?? raw.scrapId ?? normalized.id,
    articleId: article.id ?? raw.article_id ?? raw.articleId ?? normalized.id,
    folderId: raw.folder_id ?? raw.folderId ?? fallbackFolderId,
    dateText: raw.dateText ?? raw.created_at ?? raw.createdAt ?? '최근 스크랩',
  };
}

function normalizeNotification(raw = {}, index = 0) {
  const type = raw.type ?? raw.notification_type ?? 'session';
  const iconMap = { session: '🔄', hotissue: '🔥', comment: '💬', cleanup: '🧹', scrap: '🔖' };
  return {
    id: raw.id ?? raw.notification_id ?? index + 1,
    section: raw.section ?? (index < 3 ? 'today' : 'yesterday'),
    type,
    icon: raw.icon ?? iconMap[type] ?? '🔔',
    iconClass: raw.iconClass ?? (type === 'hotissue' ? 'noti-pink-circle' : type === 'comment' ? 'noti-brown-circle' : 'noti-blue-circle'),
    title: raw.title ?? raw.message_title ?? raw.name ?? '알림',
    desc: raw.desc ?? raw.description ?? raw.message ?? raw.content ?? '',
    time: raw.time ?? raw.created_at ?? raw.createdAt ?? '방금',
    unread: raw.unread ?? !raw.read ?? raw.is_read === false,
    articleId: raw.article_id ?? raw.articleId ?? raw.news_id,
  };
}

const api = {
  async getLatestArticles({ country, category }) {
    const selected = CATEGORY_OPTIONS.find((item) => item.key === category);
    const params = { country };
    if (selected?.api) params.category = selected.api;
    const res = await apiClient.get('/sessions/latest/articles', { params });
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => normalizeArticle(item, index, category));
  },
  async getSessions({ country }) {
    const res = await apiClient.get('/sessions', { params: { country, limit: 6 } });
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map((item) => ({
      sessionId: item.session_id ?? item.sessionId ?? item.id,
      startedAt: item.started_at ?? item.startedAt,
      isCurrent: !!(item.is_current ?? item.isCurrent),
    }));
  },
  async getSessionArticles(sessionId, { category } = {}) {
    const selected = CATEGORY_OPTIONS.find((item) => item.key === category);
    const params = {};
    if (selected?.api) params.category = selected.api;
    const res = await apiClient.get(`/sessions/${sessionId}/articles`, { params });
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => normalizeArticle(item, index, category));
  },
  async getFeedStatus() {
    const res = await apiClient.get('/feed/status');
    return unwrap(res.data) || {};
  },
  async getArticle(articleId) {
    const res = await apiClient.get(`/news/${articleId}`);
    return normalizeArticle(unwrap(res.data));
  },
  async getComments(articleId) {
    const res = await apiClient.get(`/news/${articleId}/comments`);
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => ({
      id: item.id ?? item.comment_id ?? index + 1,
      author: item.author ?? item.writer ?? item.nickname ?? '익명',
      text: item.text ?? item.content ?? item.body ?? '',
      time: item.time ?? item.created_at ?? item.createdAt ?? '방금',
      likes: item.likes ?? item.like_count ?? 0,
    }));
  },
  async getNotifications() {
    const res = await apiClient.get('/notifications');
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeNotification);
  },
  markNotificationRead(notificationId) {
    return apiClient.patch(`/notifications/${notificationId}/read`);
  },
  markAllNotificationsRead() {
    return apiClient.post('/notifications/read-all');
  },
  async getFolders() {
    const res = await apiClient.get('/scraps/folders');
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeFolder);
  },
  async getFolderScraps(folderId) {
    const res = await apiClient.get(`/scraps/folders/${folderId}`);
    const list = unwrap(res.data);
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => normalizeScrap(item, index, folderId));
  },
  async createFolder(name) {
    const res = await apiClient.post('/scraps/folders', { name, folderName: name });
    return normalizeFolder(unwrap(res.data));
  },
  deleteFolder(folderId) {
    return apiClient.delete(`/scraps/folders/${folderId}`);
  },
  async createScrap(articleId, folderId) {
    const res = await apiClient.post('/scraps', { articleId, folderId });
    return normalizeScrap(unwrap(res.data), 0, folderId);
  },
  deleteScrap(scrapId) {
    return apiClient.delete(`/scraps/${scrapId}`);
  },
  moveScrap(scrapId, folderId) {
    return apiClient.patch(`/scraps/${scrapId}`, { folderId });
  },
  updateCountries(countries) {
    return apiClient.put('/users/me/countries', { countries });
  },
  updateCategories(categories) {
    return apiClient.put('/users/me/categories', { categories });
  },
  updateNotificationSettings(settings) {
    return apiClient.put('/users/me/notification-settings', settings);
  },
  updateTheme(theme) {
    return apiClient.put('/users/me/settings/theme', { theme });
  },
  async getMe() {
    const res = await apiClient.get('/users/me');
    return unwrap(res.data);
  },
  async getSettings() {
    const res = await apiClient.get('/users/me/settings');
    return unwrap(res.data);
  },
  logout() {
    return apiClient.delete('/auth/logout');
  },
  deleteAccount() {
    return apiClient.delete('/users/me');
  },
  async signupEmail({ name, email, password }) {
    const res = await authClient.post('/signup', { name, email, password });
    return unwrap(res.data);
  },
  async loginEmail({ email, password }) {
    const res = await authClient.post('/login', { email, password });
    const payload = res.data || {};
    if (payload.token) localStorage.setItem(ACCESS_TOKEN_KEY, payload.token);
    return payload;
  },
  async socialLogin(provider, idToken) {
    const res = await apiClient.post('/auth/social', { provider, id_token: idToken });
    const payload = res.data || {};
    if (payload.access_token) localStorage.setItem(ACCESS_TOKEN_KEY, payload.access_token);
    if (payload.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
    return payload;
  },
};

function getMockArticles(country, category) {
  const pool = SESSION_MOCK_BY_COUNTRY[country];
  if (!pool) return [];
  return getMockArticlesForSession(country, category, pool.length - 1);
}

function getTodayFormattedDate() {
  const today = new Date();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 · ${dayNames[today.getDay()]}`;
}

const KST_SESSION_HOURS = [0, 5, 9, 14, 19];

function pad2(n) { return String(n).padStart(2, '0'); }

function relativeDayLabel(slot, now) {
  const slotMidnight = new Date(slot.getFullYear(), slot.getMonth(), slot.getDate()).getTime();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((todayMidnight - slotMidnight) / 86400000);
  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays === 2) return '그저께';
  return `${diffDays}일 전`;
}

function calcSessionPills(now = new Date(), count = 6) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const candidates = [];
  for (let d = -2; d <= 0; d++) {
    for (const h of KST_SESSION_HOURS) {
      const slot = new Date(today.getTime() + d * 86400000);
      slot.setHours(h, 0, 0, 0);
      if (slot.getTime() <= now.getTime()) candidates.push(slot);
    }
  }
  candidates.sort((a, b) => b.getTime() - a.getTime());
  return candidates.slice(0, count).reverse().map((slot, idx, arr) => ({
    key: slot.toISOString(),
    hourLabel: `${pad2(slot.getHours())}:00`,
    dateLabel: relativeDayLabel(slot, now),
    isNow: idx === arr.length - 1,
    timestamp: slot.getTime(),
  }));
}

function formatRemainingTime(totalMinutes) {
  const value = Number(totalMinutes ?? 0);
  if (value <= 0) return '0분 (새 브리핑 동기화 중)';
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
}

function App() {
  const [view, setView] = useState('onboarding');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [selectedCountries, setSelectedCountries] = useState({ kr: true, us: true, jp: false });
  const [selectedCategories, setSelectedCategories] = useState({ it: true, economy: true, politics: false, society: false, sports: false, entertainment: false });
  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [folders, setFolders] = useState(DEFAULT_FOLDERS);
  const [scraps, setScraps] = useState(DEFAULT_SCRAPS);
  const [activeFolderId, setActiveFolderId] = useState(1);
  const [visibleScrapCount, setVisibleScrapCount] = useState(6);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editCountries, setEditCountries] = useState(selectedCountries);
  const [editCategories, setEditCategories] = useState(selectedCategories);
  const [tickerInput, setTickerInput] = useState('');
  const [investmentTickers, setInvestmentTickers] = useState(['VOO', 'NVDA', 'GOOGL']);
  const [profile, setProfile] = useState({ name: '김민우', email: 'munu@khu.ac.kr', initial: '민' });
  const [notificationSettings, setNotificationSettings] = useState({ session: true, hotissue: true, comment: true });
  const [apiHealth, setApiHealth] = useState('fallback');

  const isOnboarding = ['onboarding', 'step2', 'step3', 'step4'].includes(view);
  const unreadCount = notifications.filter((item) => item.unread).length;
  const currentFolderScraps = scraps.filter((item) => String(item.folderId) === String(activeFolderId));
  const activeFolderName = folders.find((folder) => String(folder.id) === String(activeFolderId))?.name || '미지정';

  useEffect(() => {
    document.body.classList.toggle('dark-body', isDarkMode);
    return () => document.body.classList.remove('dark-body');
  }, [isDarkMode]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const [me, settings] = await Promise.allSettled([api.getMe(), api.getSettings()]);
        if (me.status === 'fulfilled' && me.value) {
          const name = me.value.name ?? me.value.nickname ?? '김민우';
          setProfile({ name, email: me.value.email ?? 'munu@khu.ac.kr', initial: String(name)[0] || '민' });
        }
        if (settings.status === 'fulfilled' && settings.value) {
          if (settings.value.theme) setIsDarkMode(String(settings.value.theme).toLowerCase() === 'dark');
          if (settings.value.countries) setSelectedCountries((prev) => ({ ...prev, ...settings.value.countries }));
          if (settings.value.categories) setSelectedCategories((prev) => ({ ...prev, ...settings.value.categories }));
        }
        setApiHealth('online');
      } catch (_) {
        setApiHealth('fallback');
      }
    };
    bootstrap();
  }, []);

  useEffect(() => {
    if (view !== 'notification') return;
    api.getNotifications()
      .then((list) => { if (list.length) { setNotifications(list); setApiHealth('online'); } })
      .catch(() => setApiHealth('fallback'));
  }, [view]);

  useEffect(() => {
    if (view !== 'scrap') return;
    api.getFolders()
      .then(async (serverFolders) => {
        if (serverFolders.length) {
          setFolders(serverFolders);
          const targetId = activeFolderId || serverFolders[0].id;
          setActiveFolderId(targetId);
          const serverScraps = await api.getFolderScraps(targetId);
          if (serverScraps.length) setScraps((prev) => mergeScraps(prev, serverScraps));
          setApiHealth('online');
        }
      })
      .catch(() => setApiHealth('fallback'));
  }, [view, activeFolderId]);

  const toggleCountry = (key) => setSelectedCountries((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleCategory = (key) => setSelectedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  const isAnyCountrySelected = Object.values(selectedCountries).some(Boolean);
  const isAnyCategorySelected = Object.values(selectedCategories).some(Boolean);

  const handleFinishOnboarding = async () => {
    try {
      await Promise.all([
        api.updateCountries(selectedCountries),
        api.updateCategories(selectedCategories),
        api.updateNotificationSettings({ push_alert: true, session: true, hotissue: true, comment: true }),
      ]);
      setApiHealth('online');
    } catch (_) {
      setApiHealth('fallback');
    }
    setView('home');
  };

  const handleThemeChange = async (nextDark) => {
    setIsDarkMode(nextDark);
    try {
      await api.updateTheme(nextDark ? 'dark' : 'light');
      setApiHealth('online');
    } catch (_) {
      setApiHealth('fallback');
    }
  };

  const markAllAsRead = async () => {
    setNotifications((prev) => prev.map((item) => ({ ...item, unread: false })));
    try { await api.markAllNotificationsRead(); setApiHealth('online'); } catch (_) { setApiHealth('fallback'); }
  };

  const markOneAsRead = async (notification) => {
    setNotifications((prev) => prev.map((item) => item.id === notification.id ? { ...item, unread: false } : item));
    try { await api.markNotificationRead(notification.id); setApiHealth('online'); } catch (_) { setApiHealth('fallback'); }
  };

  const handleScrapToggle = async (article) => {
    const found = scraps.find((item) => String(item.articleId ?? item.id) === String(article.id));
    if (found) {
      setScraps((prev) => prev.filter((item) => item.scrapId !== found.scrapId));
      setFolders((prev) => prev.map((folder) => folder.id === found.folderId ? { ...folder, count: Math.max(0, folder.count - 1) } : folder));
      try { await api.deleteScrap(found.scrapId); setApiHealth('online'); } catch (_) { setApiHealth('fallback'); }
      return;
    }

    const optimisticScrap = { ...article, id: Date.now(), scrapId: Date.now(), articleId: article.id, folderId: activeFolderId, dateText: '방금 전 스크랩' };
    setScraps((prev) => [optimisticScrap, ...prev]);
    setFolders((prev) => prev.map((folder) => folder.id === activeFolderId ? { ...folder, count: folder.count + 1 } : folder));
    try {
      const saved = await api.createScrap(article.id, activeFolderId);
      setScraps((prev) => prev.map((item) => item.scrapId === optimisticScrap.scrapId ? { ...optimisticScrap, ...saved } : item));
      setApiHealth('online');
    } catch (_) {
      setApiHealth('fallback');
    }
  };

  const handleAddFolder = async () => {
    const folderName = prompt('새 폴더 이름을 입력하세요:');
    if (!folderName?.trim()) return alert('폴더 이름을 올바르게 입력해주세요.');
    if (folders.some((folder) => folder.name === folderName.trim())) return alert('이미 존재하는 폴더 이름입니다.');
    const optimistic = { id: Date.now(), name: folderName.trim(), icon: ['🔮', '🏦', '🧭', '📁', '📊', '🔥'][folders.length % 6], count: 0 };
    setFolders((prev) => [...prev, optimistic]);
    try {
      const saved = await api.createFolder(folderName.trim());
      setFolders((prev) => prev.map((folder) => folder.id === optimistic.id ? { ...optimistic, ...saved } : folder));
      setApiHealth('online');
    } catch (_) {
      setApiHealth('fallback');
    }
  };

  const handleDeleteFolder = async (folderId, e) => {
    e?.stopPropagation?.();
    if (folders.length <= 1) return alert('최소 하나의 폴더는 존재해야 합니다.');
    if (!window.confirm('이 폴더를 삭제하시겠습니까? 내부 스크랩 기사도 함께 정리됩니다.')) return;
    const nextFolders = folders.filter((folder) => folder.id !== folderId);
    setFolders(nextFolders);
    setScraps((prev) => prev.filter((item) => item.folderId !== folderId));
    if (activeFolderId === folderId) setActiveFolderId(nextFolders[0]?.id);
    try { await api.deleteFolder(folderId); setApiHealth('online'); } catch (_) { setApiHealth('fallback'); }
  };

  const handleMoveArticleFolder = async (scrapId) => {
    const targetFolderNames = folders.map((folder) => `${folder.name}`).join(', ');
    const destinationName = prompt(`이동할 폴더명을 정확히 입력하세요:\n[ ${targetFolderNames} ]`);
    if (!destinationName) return;
    const destFolder = folders.find((folder) => folder.name === destinationName.trim());
    if (!destFolder) return alert('존재하지 않는 폴더명입니다.');
    const target = scraps.find((item) => item.scrapId === scrapId);
    if (!target || target.folderId === destFolder.id) return;
    setScraps((prev) => prev.map((item) => item.scrapId === scrapId ? { ...item, folderId: destFolder.id } : item));
    setFolders((prev) => prev.map((folder) => {
      if (folder.id === target.folderId) return { ...folder, count: Math.max(0, folder.count - 1) };
      if (folder.id === destFolder.id) return { ...folder, count: folder.count + 1 };
      return folder;
    }));
    try { await api.moveScrap(scrapId, destFolder.id); setApiHealth('online'); } catch (_) { setApiHealth('fallback'); }
  };

  const handleSaveSubscription = async () => {
    const anyCountry = Object.values(editCountries).some(Boolean);
    const anyCategory = Object.values(editCategories).some(Boolean);
    if (!anyCountry || !anyCategory) return alert('최소 1개 이상의 국가와 카테고리를 골라야 합니다.');
    setSelectedCountries(editCountries);
    setSelectedCategories(editCategories);
    setIsEditMode(false);
    try {
      await Promise.all([api.updateCountries(editCountries), api.updateCategories(editCategories)]);
      setApiHealth('online');
    } catch (_) {
      setApiHealth('fallback');
    }
  };

  const handleAddTicker = (e) => {
    e.preventDefault();
    const ticker = tickerInput.trim().toUpperCase();
    if (!ticker) return;
    if (investmentTickers.includes(ticker)) return alert('이미 등록된 키워드입니다.');
    setInvestmentTickers((prev) => [...prev, ticker]);
    setTickerInput('');
  };

  const handleLogout = async () => {
    if (!window.confirm('로그아웃 하시겠습니까?')) return;
    try { await api.logout(); } catch (_) {}
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    setView('onboarding');
    setIsEditMode(false);
  };

  const handleAccountDelete = async () => {
    if (!window.confirm('⚠️ 정말로 회원 탈퇴를 진행하시겠습니까?\n탈퇴 시 저장된 모든 데이터가 영구 삭제됩니다.')) return;
    try { await api.deleteAccount(); } catch (_) {}
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    setView('onboarding');
  };

  return (
    <div className={`app-global-layout ${isDarkMode ? 'dark-mode-app' : ''} ${isOnboarding ? 'is-onboarding' : 'is-authenticated'} view-${view}`}>
      <div className="desktop-top-nav" aria-hidden={isOnboarding}>
        <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>홈</button>
        <button className={view === 'scrap' ? 'active' : ''} onClick={() => setView('scrap')}>스크랩</button>
        <button className={view === 'notification' ? 'active' : ''} onClick={() => setView('notification')}>알림 {unreadCount > 0 ? unreadCount : ''}</button>
        <button className={view === 'setting' ? 'active' : ''} onClick={() => setView('setting')}>마이페이지</button>
      </div>

      <div className="app-main-content-area">
        {view === 'onboarding' && (
          <OnboardingLogin
            onLoginSuccess={(user) => {
              if (user?.name) setProfile({ name: user.name, email: user.email || '', initial: String(user.name)[0] || '민' });
              setView('home');
            }}
            onSignupSuccess={(user) => {
              if (user?.name) setProfile({ name: user.name, email: user.email || '', initial: String(user.name)[0] || '민' });
              setView('step2');
            }}
          />
        )}
        {view === 'step2' && <CountryStep selectedCountries={selectedCountries} toggleCountry={toggleCountry} isAnyCountrySelected={isAnyCountrySelected} onPrev={() => setView('onboarding')} onNext={() => setView('step3')} />}
        {view === 'step3' && <CategoryStep selectedCategories={selectedCategories} toggleCategory={toggleCategory} isAnyCategorySelected={isAnyCategorySelected} onPrev={() => setView('step2')} onNext={() => setView('step4')} />}
        {view === 'step4' && <NotificationStep notificationSettings={notificationSettings} setNotificationSettings={setNotificationSettings} onPrev={() => setView('step3')} onFinish={handleFinishOnboarding} />}
        {view === 'home' && <HomeTimelineView isDarkMode={isDarkMode} onThemeChange={handleThemeChange} unreadCount={unreadCount} onNotiIconClick={() => setView('notification')} onProfileClick={() => setView('setting')} onArticleClick={setSelectedArticle} handleScrapToggle={handleScrapToggle} scraps={scraps} apiHealth={apiHealth} />}
        {view === 'scrap' && <ScrapView folders={folders} scraps={currentFolderScraps} totalScraps={scraps.length} activeFolderId={activeFolderId} activeFolderName={activeFolderName} visibleScrapCount={visibleScrapCount} setVisibleScrapCount={setVisibleScrapCount} setActiveFolderId={setActiveFolderId} handleAddFolder={handleAddFolder} handleDeleteFolder={handleDeleteFolder} handleMoveArticleFolder={handleMoveArticleFolder} onArticleClick={setSelectedArticle} />}
        {view === 'notification' && <NotificationCenterView notifications={notifications} unreadCount={unreadCount} onMarkAllRead={markAllAsRead} onNotificationClick={async (noti) => { await markOneAsRead(noti); if (noti.articleId) setSelectedArticle({ id: noti.articleId }); }} />}
        {view === 'setting' && <MyPageView isDarkMode={isDarkMode} onThemeChange={handleThemeChange} profile={profile} selectedCountries={selectedCountries} selectedCategories={selectedCategories} editCountries={editCountries} setEditCountries={setEditCountries} editCategories={editCategories} setEditCategories={setEditCategories} isEditMode={isEditMode} setIsEditMode={setIsEditMode} handleSaveSubscription={handleSaveSubscription} tickerInput={tickerInput} setTickerInput={setTickerInput} investmentTickers={investmentTickers} setInvestmentTickers={setInvestmentTickers} handleAddTicker={handleAddTicker} notificationSettings={notificationSettings} setNotificationSettings={setNotificationSettings} handleLogout={handleLogout} handleAccountDelete={handleAccountDelete} />}
      </div>

      {!isOnboarding && (
        <BottomNavigation view={view} setView={(next) => { setView(next); setIsEditMode(false); }} unreadCount={unreadCount} />
      )}

      {selectedArticle && (
        <ArticleDetailModal article={selectedArticle} onClose={() => setSelectedArticle(null)} isDarkMode={isDarkMode} />
      )}
    </div>
  );
}

function mergeScraps(current, incoming) {
  const map = new Map(current.map((item) => [String(item.scrapId), item]));
  incoming.forEach((item) => map.set(String(item.scrapId), item));
  return [...map.values()];
}

const SOCIAL_ERROR_MESSAGES = {
  VITE_GOOGLE_CLIENT_ID_MISSING: 'Google 로그인 환경변수(VITE_GOOGLE_CLIENT_ID)가 설정되지 않았습니다.',
  VITE_APPLE_CLIENT_ID_MISSING: 'Apple 로그인 환경변수(VITE_APPLE_CLIENT_ID)가 설정되지 않았습니다.',
  VITE_KAKAO_APP_KEY_MISSING: 'Kakao 로그인 환경변수(VITE_KAKAO_APP_KEY)가 설정되지 않았습니다.',
  GOOGLE_PROMPT_DISMISSED: 'Google 로그인 창이 닫혔습니다. 다시 시도해주세요.',
  GOOGLE_NO_CREDENTIAL: 'Google에서 토큰을 받지 못했습니다.',
  APPLE_NO_ID_TOKEN: 'Apple에서 id_token을 받지 못했습니다.',
  KAKAO_NO_TOKEN: '카카오에서 토큰을 받지 못했습니다.',
};

function OnboardingLogin({ onLoginSuccess, onSignupSuccess }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [socialBusy, setSocialBusy] = useState('');

  const handleSocial = async (provider) => {
    setError('');
    setSocialBusy(provider);
    try {
      const idToken = await fetchProviderIdToken(provider);
      const res = await api.socialLogin(provider, idToken);
      if (!res?.access_token) throw new Error('NO_ACCESS_TOKEN');
      if (res.is_new_user) onSignupSuccess?.(res.user);
      else onLoginSuccess?.(res.user);
    } catch (err) {
      const code = err?.message || '';
      const serverMsg = err?.response?.data?.message;
      const fallback = SOCIAL_ERROR_MESSAGES[code];
      if (serverMsg) setError(serverMsg);
      else if (fallback) setError(fallback);
      else if (code.startsWith('SDK_LOAD_FAILED')) setError('소셜 로그인 SDK를 불러오지 못했습니다. 네트워크를 확인해주세요.');
      else if (code.startsWith('KAKAO_FAIL')) setError(`카카오 로그인 실패: ${code.replace('KAKAO_FAIL:', '')}`);
      else if (err?.response?.status === 400) setError('소셜 토큰 검증 실패. 다시 시도해주세요.');
      else setError(`${provider} 로그인 실패`);
    } finally {
      setSocialBusy('');
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setPassword('');
    setPasswordConfirm('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (mode === 'signup') {
      if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
      if (password.length < 6) { setError('비밀번호는 6자 이상 입력해주세요.'); return; }
      if (password !== passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await api.signupEmail({ name: name.trim(), email: email.trim(), password });
        const loginRes = await api.loginEmail({ email: email.trim(), password });
        onSignupSuccess?.(loginRes?.user);
      } else {
        const res = await api.loginEmail({ email: email.trim(), password });
        if (!res?.token) throw new Error('NO_TOKEN');
        onLoginSuccess?.(res.user);
      }
    } catch (err) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message;
      if (message) setError(message);
      else if (status === 401) setError('이메일 또는 비밀번호가 틀렸습니다.');
      else if (status === 409) setError('이미 사용 중인 이메일입니다.');
      else if (err?.message === 'Network Error') setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
      else setError(mode === 'signup' ? '회원가입에 실패했습니다.' : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="home-container onboarding-center">
      <div className="step-indicator">STEP 1 / 4</div>
      <div className="app-brand-icon"><div className="brand-symbol">▤</div></div>
      <h1 className="brand-heading">뉴스브리프</h1>
      <p className="brand-description">AI가 5시간마다 자동으로 요약해주는<br />3개국 주요 뉴스</p>

      <div className="auth-tab-row" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={`auth-tab-btn ${mode === 'login' ? 'is-active' : ''}`} onClick={() => switchMode('login')}>로그인</button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} className={`auth-tab-btn ${mode === 'signup' ? 'is-active' : ''}`} onClick={() => switchMode('signup')}>회원가입</button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {mode === 'signup' && (
          <label className="auth-field">
            <span>이름</span>
            <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
          </label>
        )}
        <label className="auth-field">
          <span>이메일</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <label className="auth-field">
          <span>비밀번호</span>
          <input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="6자 이상" />
        </label>
        {mode === 'signup' && (
          <label className="auth-field">
            <span>비밀번호 확인</span>
            <input type="password" autoComplete="new-password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="다시 입력" />
          </label>
        )}

        {error && <p className="auth-error" role="alert">{error}</p>}

        <button type="submit" className="auth-submit-btn" disabled={submitting}>
          {submitting ? '처리 중…' : (mode === 'signup' ? '회원가입하고 시작하기' : '로그인')}
        </button>
      </form>

      <div className="auth-divider"><span>또는 소셜 계정으로</span></div>

      <div className="auth-button-group">
        <button type="button" className="social-login-btn google-btn" onClick={() => handleSocial('google')} disabled={submitting || !!socialBusy}><span>G</span>{socialBusy === 'google' ? 'Google 인증 중…' : 'Google로 계속하기'}</button>
        <button type="button" className="social-login-btn apple-btn" onClick={() => handleSocial('apple')} disabled={submitting || !!socialBusy}><span></span>{socialBusy === 'apple' ? 'Apple 인증 중…' : 'Apple로 계속하기'}</button>
        <button type="button" className="social-login-btn kakao-btn" onClick={() => handleSocial('kakao')} disabled={submitting || !!socialBusy}><span>●</span>{socialBusy === 'kakao' ? '카카오 인증 중…' : '카카오로 시작하기'}</button>
      </div>
      <p className="terms-notice">계속하면 이용약관과 개인정보처리방침에 동의하는 것으로 간주됩니다.</p>
    </div>
  );
}

function CountryStep({ selectedCountries, toggleCountry, isAnyCountrySelected, onPrev, onNext }) {
  return (
    <div className="home-container step-container">
      <div className="step-progress-bar"><div className="progress-fill" style={{ width: '50%' }} /></div>
      <div className="step-indicator">STEP 2 / 4</div>
      <h2 className="step-main-title">어떤 나라 뉴스를 볼까요?</h2>
      <p className="step-sub-title">최소 1개 이상 선택해주세요. 중복 선택 가능.</p>
      <div className="selection-list">
        {COUNTRY_OPTIONS.map((country) => (
          <button key={country.key} type="button" className={`selection-card ${selectedCountries[country.key] ? 'is-selected' : 'is-unselected'}`} onClick={() => toggleCountry(country.key)}>
            <span className="selection-icon">{country.flag}</span>
            <span className="selection-copy"><strong>{country.label}/{country.short}</strong><small>{country.desc}</small></span>
            <span className="checkmark">{selectedCountries[country.key] ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      <div className="navigation-actions"><button className="back-nav-btn" onClick={onPrev}>이전</button><button className="forward-nav-btn" disabled={!isAnyCountrySelected} onClick={onNext}>다음 단계로 →</button></div>
    </div>
  );
}

function CategoryStep({ selectedCategories, toggleCategory, isAnyCategorySelected, onPrev, onNext }) {
  return (
    <div className="home-container step-container">
      <div className="step-progress-bar"><div className="progress-fill" style={{ width: '75%' }} /></div>
      <div className="step-indicator">STEP 3 / 4</div>
      <h2 className="step-main-title">관심 분야를 알려주세요</h2>
      <p className="step-sub-title">선택한 분야가 메인 브리핑 우선순위에 반영됩니다.</p>
      <div className="category-matrix-grid">
        {CATEGORY_OPTIONS.filter((item) => item.key !== 'all').map((category) => (
          <button key={category.key} type="button" className={`matrix-item ${selectedCategories[category.key] ? 'is-selected' : 'is-unselected'}`} onClick={() => toggleCategory(category.key)}>
            <span className="matrix-icon">{category.icon}</span><strong>{category.label}</strong><small>{category.desc}</small><em>{selectedCategories[category.key] ? '✓ 선택됨' : ' '}</em>
          </button>
        ))}
      </div>
      <div className="navigation-actions"><button className="back-nav-btn" onClick={onPrev}>이전</button><button className="forward-nav-btn" disabled={!isAnyCategorySelected} onClick={onNext}>다음 단계로 →</button></div>
    </div>
  );
}

function NotificationStep({ notificationSettings, setNotificationSettings, onPrev, onFinish }) {
  return (
    <div className="home-container step-container">
      <div className="step-progress-bar"><div className="progress-fill" style={{ width: '100%' }} /></div>
      <div className="step-indicator">STEP 4 / 4</div>
      <h2 className="step-main-title">알림 받을게요?</h2>
      <p className="step-sub-title">언제든 설정에서 변경할 수 있어요.</p>
      <div className="toggle-option-list">
        <ToggleRow title="새 세션 도착" sub="5시간마다 브리핑 알림" checked={notificationSettings.session} onChange={() => setNotificationSettings((prev) => ({ ...prev, session: !prev.session }))} />
        <ToggleRow title="관심 핫이슈" sub="반복 등장 키워드 알림" checked={notificationSettings.hotissue} onChange={() => setNotificationSettings((prev) => ({ ...prev, hotissue: !prev.hotissue }))} />
        <ToggleRow title="스크랩 댓글" sub="저장한 기사 댓글 변화" checked={notificationSettings.comment} onChange={() => setNotificationSettings((prev) => ({ ...prev, comment: !prev.comment }))} />
      </div>
      <div className="navigation-actions"><button className="back-nav-btn" onClick={onPrev}>이전</button><button className="forward-nav-btn" onClick={onFinish}>시작하기</button></div>
    </div>
  );
}

function HomeTimelineView({ isDarkMode, onThemeChange, unreadCount, onNotiIconClick, onProfileClick, onArticleClick, handleScrapToggle, scraps, apiHealth }) {
  const [currentCountry, setCurrentCountry] = useState('kr');
  const [currentCat, setCurrentCat] = useState('all');
  const [serverArticles, setServerArticles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [minutesUntilNext, setMinutesUntilNext] = useState(134);
  const [lastCrawlingTime, setLastCrawlingTime] = useState('14:00');
  const [sessionPills, setSessionPills] = useState(() => calcSessionPills());
  const [activeSessionIdx, setActiveSessionIdx] = useState(-1);

  useEffect(() => {
    const recompute = () => {
      const next = calcSessionPills();
      setSessionPills(next);
      setActiveSessionIdx((prev) => (prev === -1 ? -1 : Math.min(prev, next.length - 1)));
    };
    recompute();
    const timer = setInterval(recompute, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { setActiveSessionIdx(-1); }, [currentCountry, currentCat]);

  const effectiveIdx = activeSessionIdx === -1 ? sessionPills.length - 1 : activeSessionIdx;
  const activePill = sessionPills[effectiveIdx];
  const activeSessionLabel = activePill?.hourLabel ?? '14:00';
  const activeIsNow = effectiveIdx === sessionPills.length - 1;

  const handlePillClick = (idx) => {
    setActiveSessionIdx(idx === sessionPills.length - 1 ? -1 : idx);
  };

  const getLatestArticlesFromServer = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const articles = await api.getLatestArticles({ country: currentCountry, category: currentCat });
      setServerArticles(articles.length ? articles : getMockArticles(currentCountry, currentCat));
    } catch (_) {
      setServerArticles(getMockArticles(currentCountry, currentCat));
    } finally {
      if (showLoading) setTimeout(() => setIsLoading(false), 250);
    }
  };

  const getArticlesForPill = async (pill, showLoading = true) => {
    if (!pill || pill.isNow) return getLatestArticlesFromServer(showLoading);
    if (showLoading) setIsLoading(true);
    let articles = [];
    try {
      const sessions = await api.getSessions({ country: currentCountry });
      const match = sessions.find((s) => s.startedAt && Math.abs(new Date(s.startedAt).getTime() - pill.timestamp) < 30 * 60 * 1000);
      if (match) articles = await api.getSessionArticles(match.sessionId, { category: currentCat });
    } catch (_) { /* fall through to mock */ }
    if (!articles.length) {
      const pillIdx = sessionPills.indexOf(pill);
      articles = getMockArticlesForSession(currentCountry, currentCat, pillIdx);
    }
    setServerArticles(articles);
    if (showLoading) setTimeout(() => setIsLoading(false), 250);
  };

  useEffect(() => {
    if (!sessionPills.length) return;
    if (activeSessionIdx === -1 || activeSessionIdx === sessionPills.length - 1) {
      getLatestArticlesFromServer(true);
    } else {
      getArticlesForPill(sessionPills[activeSessionIdx], true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCountry, currentCat, activeSessionIdx]);

  useEffect(() => {
    let mounted = true;
    const checkFeedStatus = async () => {
      try {
        const status = await api.getFeedStatus();
        if (!mounted) return;
        const remainMinutes = status.minutes_until_next ?? status.minutesUntilNext ?? status.remaining_minutes ?? status.remainingMinutes;
        if (remainMinutes !== undefined) setMinutesUntilNext(Number(remainMinutes));
        const lastTime = status.last_crawling_time ?? status.lastCrawlingTime ?? status.last_updated_at ?? status.lastUpdatedAt;
        if (lastTime) setLastCrawlingTime(String(lastTime).slice(11, 16) || String(lastTime));
        if (Number(remainMinutes) === 0) getLatestArticlesFromServer(false);
      } catch (_) {
        setMinutesUntilNext((prev) => (prev > 0 ? prev - 1 : 300));
      }
    };
    checkFeedStatus();
    const timer = setInterval(checkFeedStatus, 60000);
    return () => { mounted = false; clearInterval(timer); };
  }, [currentCountry, currentCat]);

  return (
    <div className="home-container">
      <div className="home-header">
        <div className="logo-section">📑 <span>뉴스브리프</span></div>
        <div className="country-tabs">{COUNTRY_OPTIONS.map((country) => <button key={country.key} className={currentCountry === country.key ? 'active' : ''} onClick={() => { setCurrentCountry(country.key); setCurrentCat('all'); }}>{country.flag} {country.label}</button>)}</div>
        <div className="header-right-icons">
          <button className="theme-toggle-icon" onClick={() => onThemeChange(!isDarkMode)}>{isDarkMode ? '☀️' : '🌙'}</button>
          <button className="noti-icon-badge" onClick={onNotiIconClick}>🔔{unreadCount > 0 && <span className="noti-badge-num">{unreadCount}</span>}</button>
          <button className="user-avatar" onClick={onProfileClick}>민</button>
        </div>
      </div>
      <div className="update-status-bar"><span>{apiHealth === 'online' ? '🟢' : '🟡'} 마지막 크롤링 <strong>{lastCrawlingTime}</strong> · 다음 업데이트까지 <strong>{formatRemainingTime(minutesUntilNext)}</strong></span><button className="refresh-btn" onClick={() => getLatestArticlesFromServer(true)}>새로고침</button></div>
      <div className="date-heading">{getTodayFormattedDate()}</div>
      <h1 className="main-page-title">오늘의 브리핑</h1>
      <div className="category-chips">{CATEGORY_OPTIONS.map((cat) => <button key={cat.key} className={currentCat === cat.key ? 'active' : ''} onClick={() => setCurrentCat(cat.key)}>{cat.label}</button>)}</div>
      <div className="session-timeline-box">
        <div className="timeline-header">
          <span>🕒 세션 타임라인 <small>{currentCountry.toUpperCase()} × {currentCat.toUpperCase()}</small></span>
          <span className="timeline-meta">최대 6세션 · 30시간 보관</span>
        </div>
        <div className="timeline-hours-grid">
          {sessionPills.map((pill, idx) => {
            const isActive = idx === effectiveIdx;
            const isNowPill = idx === sessionPills.length - 1;
            return (
              <button
                type="button"
                key={pill.key}
                className={`hour-pill ${isNowPill ? 'current-now' : ''} ${isActive ? 'is-active' : ''}`}
                onClick={() => handlePillClick(idx)}
                aria-pressed={isActive}
              >
                {pill.hourLabel}<br /><small>{isNowPill ? '지금' : pill.dateLabel}</small>
              </button>
            );
          })}
        </div>
      </div>
      <div className="session-sub-title">{activeSessionLabel} 세션{activeIsNow ? ' · 지금' : ` · ${activePill?.dateLabel || ''}`} · 검색 결과 기사 <span className="right-label">세션당 최대 6개 로드</span></div>
      <div className="articles-list">
        {isLoading ? <div className="empty-state">🔄 뉴스브리프 AI 세션 실시간 연동 중...</div> : serverArticles.length === 0 ? <div className="empty-state">📭 선택하신 분야의 실시간 업데이트 뉴스가 없습니다.</div> : serverArticles.map((article, index) => <ArticleCard key={article.id} article={article} rank={index + 1} isScrapped={scraps.some((item) => String(item.articleId ?? item.id) === String(article.id))} onClick={() => onArticleClick(article)} onScrap={() => handleScrapToggle(article)} />)}
      </div>
    </div>
  );
}

function ArticleCard({ article, rank, isScrapped, onClick, onScrap }) {
  return (
    <article className="article-main-card" onClick={onClick}>
      <div className="card-rank-num">{rank}</div>
      <div className="card-body-content">
        <div className="card-meta-info"><span className="cat-badge">{article.category}</span><span className="src-text">{article.source}</span></div>
        <h2 className="article-card-title">{article.title}</h2>
        <div className="article-bullet-summary">{(article.bullets || []).map((bullet, idx) => <span key={idx}>• {bullet}</span>)}</div>
        <div className="card-bottom-actions"><span>🔗 원문</span><span>💬 {article.replies || 0}</span><button className="card-scrap-btn" onClick={(e) => { e.stopPropagation(); onScrap(); }}>{isScrapped ? '🔖 스크랩됨' : '📥 스크랩'}</button></div>
      </div>
    </article>
  );
}

function ScrapView({ folders, scraps, totalScraps, activeFolderId, activeFolderName, visibleScrapCount, setVisibleScrapCount, setActiveFolderId, handleAddFolder, handleDeleteFolder, handleMoveArticleFolder, onArticleClick }) {
  const visible = scraps.slice(0, visibleScrapCount);
  return (
    <div className="home-container scrap-page">
      <div className="page-header-row"><div><span className="back-label">← 내 스크랩</span><h1 className="main-page-title">{totalScraps}개 저장됨</h1><p>최근 업데이트: 오늘 14:20</p></div><div className="page-actions"><button onClick={() => alert('검색 기능은 API 검색 명세 추가 시 연결하면 됩니다.')}>🔍 검색</button><button className="primary-btn" onClick={handleAddFolder}>+ 새 폴더</button></div></div>
      <section className="folder-section"><span className="section-eyebrow">📁 폴더</span><div className="folder-grid">{folders.map((folder) => <button key={folder.id} className={`folder-card ${String(activeFolderId) === String(folder.id) ? 'active' : ''}`} onClick={() => { setActiveFolderId(folder.id); setVisibleScrapCount(6); }}><span className="folder-icon">{folder.icon}</span><strong>{folder.name}</strong><em>{folder.count}</em><span className="folder-delete" onClick={(e) => handleDeleteFolder(folder.id, e)}>삭제</span></button>)}</div></section>
      <section className="scrap-list-section"><div className="section-title-row"><strong>{activeFolderName} 기사</strong><span>최신순</span></div><div className="articles-list scrap-list">{visible.length ? visible.map((item, index) => <ScrapArticleCard key={item.scrapId} item={item} rank={index + 1} onMove={() => handleMoveArticleFolder(item.scrapId)} onClick={() => onArticleClick(item)} />) : <div className="empty-state">이 폴더에 저장된 기사가 없습니다.</div>}</div>{scraps.length > visibleScrapCount ? <button className="more-articles-btn" onClick={() => setVisibleScrapCount((prev) => prev + 6)}>더보기 ↓</button> : <div className="info-bar">💡 스크랩한 기사는 영구 보관됩니다.</div>}</section>
    </div>
  );
}

function ScrapArticleCard({ item, rank, onMove, onClick }) {
  return (
    <article className="article-main-card" onClick={onClick}>
      <div className="card-rank-num">{rank}</div><div className="card-body-content"><div className="card-meta-info"><span className="cat-badge">{item.category}</span><span>{item.source}</span></div><h2 className="article-card-title">{item.title}</h2><div className="article-bullet-summary">{(item.bullets || []).map((b, i) => <span key={i}>• {b}</span>)}</div><div className="card-bottom-actions"><span>💬 {item.replies || 0}</span><span>{item.dateText}</span><button className="card-scrap-btn" onClick={(e) => { e.stopPropagation(); onMove(); }}>이동</button></div></div>
    </article>
  );
}

function NotificationCenterView({ notifications, unreadCount, onMarkAllRead, onNotificationClick }) {
  const today = notifications.filter((item) => item.section !== 'yesterday');
  const yesterday = notifications.filter((item) => item.section === 'yesterday');
  return (
    <div className="home-container noti-page"><div className="noti-page-header-row"><div className="noti-title-left-side"><span className="noti-main-text-title">알림</span>{unreadCount > 0 && <span className="noti-count-badge-pink">새 {unreadCount}개</span>}</div><button className="noti-clear-all-btn" onClick={onMarkAllRead}>모두 읽음</button></div><NotificationGroup title="오늘" items={today} onClick={onNotificationClick} /><NotificationGroup title="이전" items={yesterday} onClick={onNotificationClick} /></div>
  );
}

function NotificationGroup({ title, items, onClick }) {
  if (!items.length) return null;
  return <div className="noti-list-scroll-box"><div className="noti-date-divider-title">{title}</div>{items.map((noti) => <button key={noti.id} className={`noti-list-card-item ${noti.unread ? 'is-unread-bg' : ''}`} onClick={() => onClick(noti)}><span className={`noti-avatar-circle-icon ${noti.iconClass}`}>{noti.icon}</span><span className="noti-body-content-info"><strong className="noti-body-headline-title">{noti.title}</strong><span className="noti-body-subtext-description">{noti.desc}</span></span><span className="noti-right-time-text">{noti.time}</span></button>)}</div>;
}

function MyPageView({ isDarkMode, onThemeChange, profile, selectedCountries, selectedCategories, editCountries, setEditCountries, editCategories, setEditCategories, isEditMode, setIsEditMode, handleSaveSubscription, tickerInput, setTickerInput, investmentTickers, setInvestmentTickers, handleAddTicker, notificationSettings, setNotificationSettings, handleLogout, handleAccountDelete }) {
  const countriesTarget = isEditMode ? editCountries : selectedCountries;
  const categoriesTarget = isEditMode ? editCategories : selectedCategories;
  return (
    <div className="home-container settings-page"><h1 className="main-page-title">마이페이지</h1><div className="settings-grid"><section className="profile-card"><div className="profile-avatar">{profile.initial}</div><div><strong>{profile.name} 님</strong><span>일반 회원 · {profile.email}</span></div></section><section className="settings-card"><div className="section-title-row"><strong>🌗 테마</strong><div className="theme-segment"><button className={!isDarkMode ? 'active' : ''} onClick={() => onThemeChange(false)}>Light</button><button className={isDarkMode ? 'active' : ''} onClick={() => onThemeChange(true)}>Dark</button></div></div></section><section className="settings-card"><div className="section-title-row"><strong>🌍 뉴스 구독 조건 설정</strong><button className="primary-chip" onClick={() => { if (isEditMode) handleSaveSubscription(); else { setEditCountries(selectedCountries); setEditCategories(selectedCategories); setIsEditMode(true); } }}>{isEditMode ? '저장하기' : '조건 편집'}</button></div><ChipSection title="구독 국가" options={COUNTRY_OPTIONS.map((c) => ({ key: c.key, label: `${c.flag} ${c.label}` }))} selected={countriesTarget} editable={isEditMode} onToggle={(key) => setEditCountries((prev) => ({ ...prev, [key]: !prev[key] }))} /><ChipSection title="관심 카테고리" options={CATEGORY_OPTIONS.filter((c) => c.key !== 'all').map((c) => ({ key: c.key, label: `${c.icon} ${c.label}` }))} selected={categoriesTarget} editable={isEditMode} onToggle={(key) => setEditCategories((prev) => ({ ...prev, [key]: !prev[key] }))} /></section><section className="settings-card"><strong>🔔 알림 설정</strong><ToggleRow title="새 세션 도착" sub="5시간마다 알림" checked={notificationSettings.session} onChange={() => setNotificationSettings((prev) => ({ ...prev, session: !prev.session }))} /><ToggleRow title="관심 핫이슈" sub="반복 등장 키워드" checked={notificationSettings.hotissue} onChange={() => setNotificationSettings((prev) => ({ ...prev, hotissue: !prev.hotissue }))} /><ToggleRow title="스크랩 댓글 알림" sub="저장한 기사 댓글 변화" checked={notificationSettings.comment} onChange={() => setNotificationSettings((prev) => ({ ...prev, comment: !prev.comment }))} /></section><section className="settings-card"><h3>📊 나의 롱텀 투자 모니터링 키워드</h3><p>종목 코드가 언급된 AI 요약 기사가 생성되면 우선 배정 타겟팅이 연결됩니다.</p><form className="ticker-form" onSubmit={handleAddTicker}><input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)} placeholder="예: AAPL, TSMC, DCA" /><button>추가</button></form><div className="chip-wrap">{investmentTickers.map((ticker) => <button key={ticker} className="ticker-chip" onClick={() => setInvestmentTickers((prev) => prev.filter((item) => item !== ticker))}>{ticker} ✕</button>)}</div></section><section className="danger-zone"><button onClick={handleLogout}>로그아웃 <span>›</span></button><button className="danger" onClick={handleAccountDelete}>회원 탈퇴 <span>›</span></button></section></div></div>
  );
}

function ChipSection({ title, options, selected, editable, onToggle }) {
  return <div className="chip-section"><span>{title}</span><div className="chip-wrap">{options.map((option) => <button key={option.key} className={`sub-chip ${selected[option.key] ? 'active' : ''}`} disabled={!editable} onClick={() => onToggle(option.key)}>{option.label}</button>)}</div></div>;
}

function ToggleRow({ title, sub, checked, onChange }) {
  return <div className="toggle-row-item"><div className="toggle-text-info"><strong>{title}</strong><small>{sub}</small></div><label className="switch-input-label"><input type="checkbox" checked={checked} onChange={onChange} /><span className="slider-round" /></label></div>;
}

const COMMENT_AUTHORS = ['뉴스독자A', '뉴스독자B', '시민기자', '코어유저', '잠수러', '데일리리더', '브리핑팬', '뉴비독자', '인사이트헌터', '아침형인간', '나이트오울', '아키비스트', '큐레이터', '디스커서', '오피니언메이커'];
const COMMENT_TEMPLATES = [
  '핵심만 요약돼서 좋네요. 출퇴근길에 빠르게 훑기 좋아요.',
  '원문 댓글 분위기는 좀 다른데 AI 요약이 균형 잘 잡아준 듯.',
  '이 기사 트렌드스코어가 왜 높은지 알겠다. 댓글 수가 압도적.',
  '관련 분야에서 일하는데 현장 체감이랑 거의 일치합니다.',
  '근거 자료 좀 더 붙여주면 좋겠어요. 단정적 표현이 약간 걸림.',
  '같은 주제 다른 매체랑 비교해보면 톤이 묘하게 다름.',
  '진짜 5시간마다 갱신되는 게 신기함. 잘 만든 도구다.',
  '저는 반대 의견. 데이터 표본이 좀 빈약한 느낌이라.',
  '북마크하고 주말에 다시 읽어보려고 해요.',
  '핫이슈 떡밥이라 댓글창 화력 좋네ㅋ',
  '이 정도 인사이트면 유료여도 볼 만함.',
  '카테고리 분류가 좀 애매한 듯. 사회랑 정치 경계가 흐릿.',
  '국가별 비교 차트 같은 거 있으면 좋겠어요.',
  '요약 bullet 3개 중에 2번째가 핵심이네요.',
  '관련주 어디 어디일까요? 같이 보고 싶어요.',
];

function buildMockComments(articleId, total) {
  const seed = Number(String(articleId).replace(/\D/g, '')) || 7;
  const safeTotal = Math.max(0, Math.min(Number(total) || 0, 120));
  const list = [];
  for (let i = 0; i < safeTotal; i++) {
    list.push({
      id: `mock-${articleId}-${i}`,
      author: COMMENT_AUTHORS[(seed + i) % COMMENT_AUTHORS.length],
      text: COMMENT_TEMPLATES[(seed * 3 + i) % COMMENT_TEMPLATES.length],
      time: i < 3 ? `${(i + 1) * 5}분 전` : i < 10 ? `${i}시간 전` : `${Math.ceil(i / 6)}일 전`,
    });
  }
  return list;
}

const COMMENT_PAGE_SIZE = 5;

function ArticleDetailModal({ article, onClose, isDarkMode }) {
  const [detail, setDetail] = useState(article);
  const [comments, setComments] = useState(DEFAULT_COMMENTS[article.id] || []);
  const [isLoading, setIsLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(COMMENT_PAGE_SIZE);
  const [serverHasMore, setServerHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [sortMode, setSortMode] = useState('likes');

  const totalReported = Math.max(comments.length, Number(detail.replies) || 0);

  useEffect(() => {
    let mounted = true;
    const fetchDetail = async () => {
      setIsLoading(true);
      try {
        const [articleDetail, serverComments] = await Promise.allSettled([api.getArticle(article.id), api.getComments(article.id)]);
        if (!mounted) return;
        if (articleDetail.status === 'fulfilled') setDetail((prev) => ({ ...prev, ...articleDetail.value }));
        if (serverComments.status === 'fulfilled' && serverComments.value.length) setComments(serverComments.value);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    fetchDetail();
    return () => { mounted = false; };
  }, [article.id]);

  const handleLoadMore = async () => {
    if (isFetchingMore) return;
    setIsFetchingMore(true);
    let appended = [];
    if (serverHasMore) {
      try {
        const nextPage = Math.floor(visibleCount / COMMENT_PAGE_SIZE) + 1;
        const fetched = await apiClient.get(`/news/${article.id}/comments`, { params: { page: nextPage, per_page: COMMENT_PAGE_SIZE, sort: sortMode } })
          .then((res) => unwrap(res.data))
          .catch(() => null);
        if (Array.isArray(fetched) && fetched.length) {
          appended = fetched.map((item, idx) => ({
            id: item.id ?? item.comment_id ?? `srv-${nextPage}-${idx}`,
            author: item.author ?? item.writer ?? item.nickname ?? '익명',
            text: item.text ?? item.content ?? item.body ?? '',
            time: item.time ?? item.created_at ?? item.createdAt ?? '방금',
          }));
        } else {
          setServerHasMore(false);
        }
      } catch (_) {
        setServerHasMore(false);
      }
    }
    if (!appended.length) {
      const needed = Math.min(COMMENT_PAGE_SIZE, Math.max(0, totalReported - comments.length));
      if (needed > 0) {
        const pool = buildMockComments(article.id, totalReported);
        appended = pool.slice(comments.length, comments.length + needed);
      }
    }
    if (appended.length) {
      setComments((prev) => [...prev, ...appended]);
      setVisibleCount((prev) => prev + appended.length);
    } else {
      setVisibleCount((prev) => Math.min(prev + COMMENT_PAGE_SIZE, comments.length));
    }
    setIsFetchingMore(false);
  };

  const visibleComments = comments.slice(0, visibleCount);
  const hasMoreToShow = visibleComments.length < totalReported;

  const openOriginal = () => {
    if (detail.originalUrl) window.open(detail.originalUrl, '_blank', 'noopener,noreferrer');
    else alert('원문 링크가 아직 연결되지 않았습니다.');
  };

  return (
    <div className="modal-screen-overlay" onClick={onClose}><div className={`modal-main-window ${isDarkMode ? 'dark-mode-app' : ''}`} onClick={(e) => e.stopPropagation()}><div className="modal-top-bar"><button className="modal-back-arrow" onClick={onClose}>← 14:00 세션으로</button><div className="modal-top-right-btns"><button>🔖</button><button>↗</button></div></div><div className="modal-scroll-area">{isLoading && <div className="modal-loading">상세 정보를 불러오는 중...</div>}<div className="modal-meta-row"><span className="modal-cat-tag">{detail.category}</span><span>{detail.source} · 브리핑</span></div><h1 className="modal-article-title">{detail.title}</h1><button className="original-link-banner" onClick={openOriginal}><span className="naver-icon">N</span><strong>원문 기사 보기</strong><small>{detail.source}</small></button><div className="ai-summary-container-box"><div className="ai-box-title">✨ AI 요약 <span className="ai-speed-tag">세션 기반 자동 요약</span></div><ul className="ai-bullet-points">{(detail.bullets || []).map((bullet, idx) => <li key={idx}>{bullet}</li>)}<li>해당 분야의 최신 세션 핵심 브리핑입니다.</li></ul></div><section className="comments-section"><div className="comments-section-title-row"><strong>💬 댓글 ({totalReported})</strong><span className="comment-sort-tabs"><button type="button" className={sortMode === 'likes' ? 'is-active' : ''} onClick={() => setSortMode('likes')}>인기순</button><span>·</span><button type="button" className={sortMode === 'recent' ? 'is-active' : ''} onClick={() => setSortMode('recent')}>최신순</button></span></div>{visibleComments.length === 0 ? <div className="comment-empty-state">아직 표시할 댓글이 없습니다. <strong>댓글 더보기</strong>를 눌러 불러올 수 있어요.</div> : visibleComments.map((comment) => <div key={comment.id} className="comment-row-item"><div className="comment-user-meta-row"><strong>{comment.author}</strong><span>{comment.time}</span></div><p className="comment-text-body">{comment.text}</p></div>)}{hasMoreToShow && <button type="button" className="more-comments-dashed-btn" onClick={handleLoadMore} disabled={isFetchingMore}>{isFetchingMore ? '불러오는 중…' : `댓글 더보기 (${Math.max(0, totalReported - visibleComments.length)}개 남음)`}</button>}</section></div><div className="modal-bottom-notice-bar"><span>출처: {detail.source}</span><span>다음 갱신 예정 세션에 자동 반영</span></div></div></div>
  );
}

function BottomNavigation({ view, setView, unreadCount }) {
  const items = [{ key: 'home', icon: '🏠', label: '홈' }, { key: 'scrap', icon: '🔖', label: '스크랩' }, { key: 'notification', icon: '🔔', label: '알림' }, { key: 'setting', icon: '👤', label: '마이페이지' }];
  return <nav className="app-bottom-nav-bar">{items.map((item) => <button key={item.key} className={`nav-tab-item ${view === item.key ? 'is-active' : ''}`} onClick={() => setView(item.key)}><span className="nav-tab-icon">{item.icon}{item.key === 'notification' && unreadCount > 0 && <span className="nav-mini-badge-dot" />}</span><span className="nav-tab-label">{item.label}</span></button>)}</nav>;
}

export default App;
