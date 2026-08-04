# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-07-24 (AI 고도화-10 세션)
> 다음 채팅 시작 시: STATUS.md 읽고 이어서

---

## 📌 다음 세션 할 것 (순서대로)

### 1. 후보 풀 탭 자동 플로우 실행 버튼 구현
content_matrix 후보 풀 탭에 "자동 플로우 실행" 버튼 추가
→ Claude AI(MCP)가 STEP1~4 자동 진행
→ 각 단계 진행상황 실시간 통보
→ Notion 에피소드 후보 풀 DB 자동 저장

### 2. 자동 플로우 전제조건 해결
```
⚠️ 트렌드 레이더 "대본생성" 버튼 → trend_episodes.json 저장 기능 미구현
   → 현재 웹 트렌드 검색으로 대체 중 → 정식 연동 필요
⚠️ 에이전트 체크리스트 항목 유연하게 디벨롭 예정
```

### 3. 대본 생성 2단계 + 이미지 생성 에이전트 플로우
- 성준님이 고민해오실 내용 기반으로 설계 시작
- 에이전트 플로우 + 코디_젠 연동 진행

### 4. VideoTab.jsx AI 영상 자동생성 UI 연결

---

## ✅ 2026-07-24 완료 (AI 고도화-10)

### MCP 완전 안정화 ✅
- MCP_BRIDGE_SECRET Vercel ↔ 로컬 불일치 → 재발급으로 해결
- list_trend_episodes unauthorized 오류 근본 해결
- 프로젝트 채팅에서 yeori-studio 도구 정상 작동 확인

### sync-tunnel.js 청크 분할 버그 수정 ✅ (커밋: d5a8aca)
- cloudflared URL 청크 쪼개져 도착 → 롤링 버퍼 누적 매칭으로 수정
- logs/sync-tunnel.log 파일 로깅 추가

### proxy.js 파일 로그 추가 ✅ (커밋: d5a8aca)
- C:\yeori-studio\logs\proxy.log 로그 파일 생성
- 다운 시 원인 즉시 파악 가능

### cloudflared 경로 다중 후보 탐색 수정 ✅
- 집 PC / 회사 PC 경로 차이 자동 대응

### 대본 자동생성 플로우 1단계 수동 시뮬레이션 완주 ✅
- STEP1 키워드 수집 (겟생/마인드웰니스)
- STEP2 주제 설정 ("열심히 사는데 왜 공허하지?")
- STEP3 에피소드 기획 (3막 구조)
- STEP4 한글 대본 (KR 컨펌본 3컷, 24초)
- Notion 에피소드 후보 풀 DB 저장 완료
- 에이전트 체크리스트 11/11 체크 완료

### 숏폼 7컷 시뮬레이션 ✅
- SF_E04 "루틴 완벽하게 했는데 왜 나는 무너지지?" 7컷 대본 작성
- (정식 Notion 저장은 다음 세션 자동 플로우로 진행 예정)

---

## ⚠️ 자동 플로우 전제조건 (다음 세션 확인)

```
인프라
  ✅ start_yeori.bat 실행
  ✅ proxy.js (localhost:3001)
  ✅ cloudflared 터널 + sync-tunnel.js 자동 재배포
  ✅ Vercel MCP_BRIDGE_URL 최신 반영

MCP 연결
  ✅ yeori-studio 커넥터 연결
  ✅ MCP_BRIDGE_SECRET Vercel ↔ 로컬 일치
  ✅ MCP_PUBLIC_SECRET 유효
  현재값: d3fa1b87ddb611c6b3cdbe488b586ca84edf7b2a74bd19962c938a09294adb63

트렌드 레이더
  ✅ localhost:3000 실행
  ⚠️ 대본생성 버튼 → trend_episodes.json 저장 미구현

Notion
  ✅ 커넥터 연결
  ✅ 에피소드 후보 풀 DB (ID: c45d2b84-7522-4a2a-8cd7-3263bcbb2cef)

content_matrix 후보 풀 탭
  ✅ UI 완성
  ⚠️ 자동 플로우 실행 버튼 미구현 ← 핵심 과제
```

---

## 📦 에피소드 후보 풀 현황 (2026-07-24)

| 에피소드 후보 | 유형 | 단계 | 체크리스트 |
|-------------|------|------|-----------|
| 열심히 사는데 왜 공허하지? | SF | STEP4 한글대본 | 11/11 ✅ |

---

## 🗺️ 대본 자동생성 플로우 구조

```
[1단계] 에피소드 후보 풀 (재료 창고)
  STEP1. 키워드 수집 (트렌드 레이더 or 웹 검색)
  STEP2. 주제 설정 (채널 컨셉 기준 리스트업)
  STEP3. 에피소드 기획 (3막 구조) → Notion 자동 저장 (재고 축적)
  STEP4. 한글 대본 (KR 컨펌본, 에이전트 리더 진행)
  → 승인 대기

[2단계] 코디_젠 연동 (다음 과제 - 성준님 고민 중)
  STEP5. 코드 매핑 → G1 코드젠 스튜디오 탭 진입
  → G1~G6 파이프라인 자동화
```

---

## 🗺️ 전체 자동화 현황

| 단계 | 상태 |
|------|------|
| Step 0 에피소드 후보 풀 | 🟡 DB+UI 완성, 자동 플로우 버튼 미구현 |
| Step 1 G1 대본 생성 | ✅ 완료 |
| Step 2 G2 이미지 생성 | ✅ 완료 |
| Step 3 G3 TTS | ✅ 완료 |
| Step 4 G4 영상 생성 | 🟡 AI 영상 UI 미연결 |
| Step 5 G5 편집 | 🟡 UI 완성, 실제 연동 미구현 |
| Step 6 G6 업로드 | ⬜ 미구현 |

---

## 🛠️ 운영 주의사항

### MCP 시크릿
- MCP_PUBLIC_SECRET: `d3fa1b87ddb611c6b3cdbe488b586ca84edf7b2a74bd19962c938a09294adb63`
- MCP_BRIDGE_SECRET: 로컬 `.env.local`에 저장 (서버 재시작 시 자동 로드)
- 커넥터 URL: `https://yeori-studio.vercel.app/api/mcp` (OAuth 자동 인증)

### PC별 경로
- 집 PC: `C:\yeori-studio\app\start_yeori.bat`
- 회사 PC: `C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio`
- 로그: `C:\yeori-studio\logs\proxy.log` / `sync-tunnel.log`
