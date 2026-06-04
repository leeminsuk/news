# 뉴스브리프 Frontend (Vite + React)

## 로컬 개발

```bash
npm install
npm run dev   # http://localhost:5173
```

백엔드는 `../backend`에서 `npm run dev`로 띄우면 됩니다 (기본 포트 4000).

## 환경변수

| 키 | 설명 | 비고 |
|----|------|------|
| `VITE_API_BASE_URL` | 백엔드 API base URL | 미설정 시 `http://localhost:8080/api/v1`, 닿지 않으면 mock 데이터로 동작 |

`.env.example`을 참고해 `.env.local`을 만들어 쓰면 됩니다.

## Vercel 배포

이 디렉터리(`frontend/`)를 Vercel 프로젝트의 **Root Directory**로 지정하면 됩니다.

1. Vercel 대시보드 → New Project → 이 레포 연결
2. **Root Directory**: `frontend`
3. **Framework Preset**: Vite (자동 감지)
4. **Environment Variables**:
   - `VITE_API_BASE_URL` — 비워두면 mock으로 동작. 백엔드 공개 URL이 있으면 채워 넣기.
5. Deploy

CLI로도 가능합니다:

```bash
cd frontend
npx vercel        # 첫 연결
npx vercel --prod # production 배포
```

### 배포 범위

- **프론트만** Vercel에 올라갑니다 (정적 SPA).
- 백엔드(Express + Postgres) · 크롤러 · LLM 요약은 Vercel에 포함되지 않으며, 별도 호스팅 그대로 사용합니다.
- 따라서 Vercel 환경에 넣을 **API 키는 없습니다**. 모든 외부 키(소셜 로그인, LLM, FCM 등)는 백엔드 `.env`에 유지하세요.

### SPA 라우팅

`vercel.json`의 `rewrites`로 모든 경로를 `/index.html`로 보내 클라이언트 라우팅이 가능하도록 해 두었습니다.
