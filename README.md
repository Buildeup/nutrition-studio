# Nutrition Studio Secure

식품영양성분 Open API 인증키를 브라우저에 노출하지 않고, 서버 프록시에서만 사용하는 영양표시 계산기입니다.

## 1. 설치

```bash
cd /Users/huerey/nutrition-studio
npm install
cp .env.example .env
```

`.env` 파일을 열고 공공데이터포털에서 복사한 **End Point**와 **일반 인증키**를 붙여넣습니다.

```env
DATA_GO_KR_API_ENDPOINT=https://api.data.go.kr/openapi/...
DATA_GO_KR_SERVICE_KEY=일반_인증키
PORT=5174
```

일반 인증키(Decoding Key)를 사용하세요. Encoding 인증키는 URL 인코딩된 값이라 이 프로젝트에서는 사용하지 않습니다.

## 2. 실행

```bash
npm start
```

브라우저에서 접속:

```text
http://localhost:5174
```

## 3. 외부 공유 시 주의

- `index.html`만 정적 웹에 올리면 API 키는 노출되지 않지만, `/api/search-ingredient` 백엔드 서버도 함께 배포되어 있어야 API 조회가 됩니다.
- `.env` 파일은 절대 공유하거나 GitHub에 올리지 마세요.
- GitHub에는 `.env.example`만 올리세요.

## 4. 배포 구조

권장 구조:

```text
정적 웹(index.html) -> 백엔드(server.js) -> 공공데이터포털 API
```

Vercel/Render/Railway/Fly.io 등에 서버를 배포하고, 환경변수에 `DATA_GO_KR_API_ENDPOINT`와 `DATA_GO_KR_SERVICE_KEY`를 등록하면 됩니다.
