# OmniContext (백엔드 MVP)

공학자·엔지니어를 위한 "살아있는 문서" AI 앱. 주제를 등록해두면 몇 시간마다
자동으로 arXiv에서 관련 논문을 확인하고, 새 내용이 있으면 OpenAI API가
알아서 문서에 반영합니다.

## 폴더 구조

```
omnicontext/
├── src/
│   ├── server.js        # Express 서버 진입점
│   ├── scheduler.js      # 몇 시간마다 자동 확인하는 cron 스케줄러
│   ├── db/index.js       # SQLite 스키마 + 연결
│   ├── services/
│   │   ├── searchService.js  # arXiv 논문 검색 (무료, 키 불필요)
│   │   └── aiService.js      # OpenAI API로 문서 자동 수정 + 채팅 응답
│   └── routes/
│       ├── topics.js     # 주제 등록/조회/삭제/수동확인 API
│       └── chat.js       # 채팅 API
├── package.json
└── .env.example
```

## 로컬에서 실행하기

```bash
npm install
cp .env.example .env
# .env 파일 열어서 OPENAI_API_KEY 채우기
npm run dev
```

서버는 기본적으로 `http://localhost:3000` 에서 실행됩니다.

## API 사용법

### 1. 주제 등록
```bash
curl -X POST http://localhost:3000/api/topics \
  -H "Content-Type: application/json" \
  -d '{"name":"펠티어 냉각 기술","keywords":"peltier cooling, thermoelectric"}'
```

### 2. 지금 바로 조사시키기 (스케줄러 기다리지 않고 테스트)
```bash
curl -X POST http://localhost:3000/api/topics/1/check-now
```

### 3. 주제 + 현재 문서 + 최근 갱신 내역 조회
```bash
curl http://localhost:3000/api/topics/1
```

### 4. 채팅
```bash
curl -X POST http://localhost:3000/api/chat/1 \
  -H "Content-Type: application/json" \
  -d '{"message":"지금까지 나온 내용 요약해줘"}'
```

## 클라우드 배포 (Railway 기준)

1. GitHub에 이 프로젝트를 push
2. [railway.app](https://railway.app) 에서 "Deploy from GitHub repo" 선택
3. Variables 탭에서 환경변수 설정:
   - `OPENAI_API_KEY`
   - `SCHEDULE_CRON` (예: `0 */3 * * *` = 3시간마다)
   - `DB_PATH=/data/omnicontext.db`
4. Settings → Volumes에서 `/data` 경로에 볼륨 추가 (SQLite 파일이 재배포해도
   사라지지 않도록 영속 저장소를 붙이는 과정)
5. 배포되면 Railway가 주는 도메인으로 API 호출 가능

> Railway 대신 Render, Fly.io도 비슷한 방식(볼륨 + 환경변수)으로 배포 가능합니다.
> 다만 셋 다 무료 플랜은 일정 시간 미사용 시 서버가 잠드는 경우가 있어서,
> "몇 시간마다 자동 확인"이 안정적으로 돌아가려면 최소 유료 플랜(월 몇 천원대)이
> 필요할 수 있습니다.

## 다음 단계로 확장하고 싶다면

- `searchService.js`에 뉴스 API, IEEE Xplore, Google Scholar 스크래핑 등 소스 추가
- 프론트엔드(채팅 UI)를 React로 만들어서 이 API에 붙이기
- 사용자별 로그인/인증 추가 (현재는 단일 사용자 기준 MVP)
- 문서 버전 히스토리 diff 뷰 (뭐가 바뀌었는지 시각적으로 보여주기)
- 갱신 발생 시 이메일/푸시 알림 연동
