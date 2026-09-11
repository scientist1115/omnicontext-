# OmniContext (백엔드 MVP)

공학자·엔지니어를 위한 "살아있는 문서" AI 앱. 주제를 등록해두면 몇 시간마다(기본값: 20분마다)
자동으로 arXiv에서 관련 논문을 확인하고, 논문 내용이 단순화된 물리 모델로
검증 가능하면 Python 시뮬레이터로 이론적 타당성까지 확인한 다음, OpenAI API가
알아서 문서에 반영합니다. 새로운 게 없으면 그냥 건너뜁니다.

## 폴더 구조

```
omnicontext/
├── Dockerfile             # Node + Python 환경 (Railway가 자동 인식)
├── sim/
│   ├── simulate.py        # 1D/2D 단순화 물리 시뮬레이터 (열전달/전기회로/보 처짐)
│   └── requirements.txt
├── src/
│   ├── server.js        # Express 서버 진입점
│   ├── scheduler.js      # 20분마다 자동 확인하는 cron 스케줄러
│   ├── db/index.js       # SQLite 스키마 + 연결
│   ├── services/
│   │   ├── searchService.js      # arXiv 논문 검색 (무료, 키 불필요)
│   │   ├── simulationService.js  # Python 시뮬레이터 실행 (자식 프로세스)
│   │   └── aiService.js          # OpenAI API로 시뮬레이션 판단 + 문서 수정 + 채팅
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

**Python 3 + numpy/scipy도 로컬에 설치돼 있어야 시뮬레이션 기능이 작동합니다:**
```bash
pip3 install numpy scipy
```

서버는 기본적으로 `http://localhost:3000` 에서 실행됩니다.

## 시뮬레이션(가설 검증) 기능

새 논문이 발견되면 AI가 먼저 "이 논문 내용을 아래 세 가지 단순화된 물리 모델 중
하나로 검증할 수 있는가"를 판단합니다:

- **열전달(thermal_1d)**: 1D 비정상 열전도 (유한차분법)
- **전기회로(electrical_dc)**: 저항망 DC 회로 (노드 전압법)
- **역학(mechanical_beam)**: 보 처짐 (Euler-Bernoulli 이론식)

해당되면 파라미터를 뽑아서 `sim/simulate.py`로 실제 계산을 돌리고, 그 결과를
논문의 주장과 비교해서 "이론적으로 말이 되는지" 판단한 내용을 문서에
"가설 검증" 단락으로 추가합니다. 해당 안 되는 논문(알고리즘, 생물학 등)은
시뮬레이션 없이 요약만 반영됩니다.

**중요한 한계**: 이건 진짜 3D CFD나 FEA가 아니라 단순화된 1D/2D 이상화
모델입니다. 실제 논문의 복잡한 형상, 재료 비선형성, 난류 등은 반영하지
않아서 "대략적인 타당성 검증" 수준으로만 봐주세요.

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

1. GitHub에 이 프로젝트를 push (Dockerfile이 포함돼 있으면 Railway가 자동으로 Docker 빌드 방식을 씁니다 — Python 시뮬레이터를 쓰려면 이 Dockerfile이 꼭 필요해요)
2. [railway.app](https://railway.app) 에서 "Deploy from GitHub repo" 선택
3. Variables 탭에서 환경변수 설정:
   - `OPENAI_API_KEY`
   - `SCHEDULE_CRON` (예: `*/20 * * * *` = 20분마다)
   - `DB_PATH=/data/omnicontext.db`
4. Settings → Volumes에서 `/data` 경로에 볼륨 추가 (SQLite 파일이 재배포해도
   사라지지 않도록 영속 저장소를 붙이는 과정)
5. 배포되면 Railway가 주는 도메인으로 API 호출 가능

> 20분마다 자동 확인 + 시뮬레이션까지 돌면 OpenAI API 호출 비용이 3시간 주기보다
> 훨씬 많이 나갑니다 (주제당 확인 1번마다 최소 2번 호출: 시뮬레이션 판단 + 문서 갱신).
> 등록해둔 주제 개수와 API 사용량을 가끔 확인하는 걸 추천해요.

> Railway 대신 Render, Fly.io도 비슷한 방식(볼륨 + 환경변수 + Dockerfile)으로 배포 가능합니다.
> 다만 셋 다 무료 플랜은 일정 시간 미사용 시 서버가 잠드는 경우가 있어서,
> "20분마다 자동 확인"이 안정적으로 돌아가려면 최소 유료 플랜(월 몇 천원대)이
> 필요할 수 있습니다.

## 다음 단계로 확장하고 싶다면

- `searchService.js`에 뉴스 API, IEEE Xplore, Google Scholar 스크래핑 등 소스 추가
- 프론트엔드(채팅 UI)를 React로 만들어서 이 API에 붙이기
- 사용자별 로그인/인증 추가 (현재는 단일 사용자 기준 MVP)
- 문서 버전 히스토리 diff 뷰 (뭐가 바뀌었는지 시각적으로 보여주기)
- 갱신 발생 시 이메일/푸시 알림 연동
