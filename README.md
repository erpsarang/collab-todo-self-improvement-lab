# Collaborative To-do

여러 브라우저가 하나의 Node.js 서버 메모리 저장소를 공유하는 최소 협업 To-do 앱입니다. 별도의 npm 의존성이나 데이터베이스 없이 Node.js 내장 모듈만 사용합니다.

## 요구 사항

- Node.js 18 이상

## 실행

```bash
npm install
npm start
```

브라우저에서 <http://localhost:3000>을 엽니다. 이름과 할 일을 입력하면 같은 서버에 접속한 모든 브라우저에서 목록을 조회할 수 있습니다. 데이터는 메모리에 저장되므로 서버를 재시작하면 초기화됩니다.

## 테스트

```bash
npm test
```

## API

- `GET /api/todos`: 저장된 모든 할 일 조회
- `POST /api/todos`: `{ "title": "요구사항 정리", "createdBy": "상열" }` 형식으로 할 일 생성
- `PATCH /api/todos/:id`: `{ "status": "DOING" }` 형식으로 상태 변경 (`TODO`, `DOING`, `DONE`만 허용)
