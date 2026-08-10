# 서여리 채널 — 현재 상태 스냅샷
> 마지막 업데이트: 2026-08-07 (AI 고도화-10 완료 / Codi_GEN 코드 체계 구축 / A Creative TTS Studio·스토리보드 도구)
> 다음 채팅 시작 시: "STATUS.md 읽고 이어서" 한 마디면 OK

---

## 📌 현재 작업 중 (지금 당장 이어할 것)

### [최우선] ScriptGenTab.jsx — pc.ac → pc.at 참조 전환
- d5613c3 커밋에서 script_to_prompts.py는 at+ac 병행 출력으로 호환 처리됨
- ScriptGenTab.jsx 내 `pc.ac` 참조를 `pc.at`으로 정식 전환 후 하위 호환 코드 제거

### codebook 실전 테스트
- 마스터 코드 입력 → script_generator.py → [C01] 대본 출력 검증
- app/scripts/codebook_v1.0.0.json 기준

### VideoTab.jsx — AI 영상 자동생성 UI 연결
- scripts/video-automation.js + /api/run-video 엔드포인트는 완성 상태
- VideoTab.jsx에 버튼/UI 미구현 — 좌측 컷 목록 사이드바 연동 설계 필요

### Notion 마스터 허브 동기화
- 07-14 이후 미업데이트 상태 → 고도화-11 세션 첫 작업으로 동기화 예정

---

## 🎯 Codi_GEN 시스템 (2026-07-27~08-01 신규 구축)

### 개요
- Codi_GEN: 서여리 영상 제작 언어를 DSL(도메인 특화 언어)로 코드화하는 범용 코드화 엔진
- 현재 v1.0 — 서여리 채널 단일 도메인, 수동 관리 단계

### 3단계 파이프라인
```
1단계: Codi_GEN (codebook.json) → 마스터 코드 → 풀 코드 스크립트 JSON
2단계: script_generator.py → [C01] 텍스트 대본 (사람이 DL/NR/CP 채움)
3단계: script_to_prompts.py → prompts.json (Veo3/Flow/ElevenLabs 투입용)
```

### 완료된 구현 (커밋 d5613c3)
| 항목 | 내용 |
|------|------|
| codebook_v1.0.0.json | SF_E01~E06 47컷 역설계, PL/SP/SH/CA/MD/AT/LOOK/CP 전체 수록 |
| script_generator.py | codebook.json 외부 로드, IP/VP/KR 조합 로직 재구성 |
| script_to_prompts.py | AT/CP 필드 대응, at+ac 병행 출력 (ScriptGenTab 호환) |

### 코드 필드 확정
- **AC → AT** 통일 (동작 필드)
- **CP** 신규 추가 (자막/Caption, DL과 별도 화면 표시용)
- 파일 위치: `app/scripts/codebook_v1.0.0.json`

---

## ✅ 완료된 것 (2026-06-22 ~ 2026-08-07)

### AI 고도화-9 (2026-07-24)
| 항목 | 커밋 |
|------|------|
| MCP 서버 완전 안정화 (Secret 불일치 해결) | ce1c872 |
| sync-tunnel.js 청크 버그 수정 | — |
| MCP 도구 11개 완성 (studio_set_episode ~ studio_get_status) | ce1c872 |
| 탭 공통 레이아웃 (사이드바+고정 상단바) 전체 통일 | a2df79a |
| scriptParserV3.js 모듈화 | ce1c872 |
| SF_E04 대본 수동 시뮬레이션 완주 (7컷) | — |
| Notion 에피소드 후보 풀 DB 저장 | — |

### AI 고도화-10 (2026-08-01)
| 항목 | 커밋 |
|------|------|
| codebook_v1.0.0.json 생성 (E01~E06 47컷 역설계) | d5613c3 |
| script_generator.py 재구성 (codebook 외부 로드 + IP/VP/KR 로직) | d5613c3 |
| script_to_prompts.py AT/CP 필드 대응 | d5613c3 |

### 기타 도구 개발 (2026-08-06~07)
| 항목 | 내용 |
|------|------|
| A Creative TTS Studio | 도구 재구축 완료 |
| A Creative Storyboard | API 문제로 대안 전환 |
| code_generator_v1.html | "컷 설계" 탭 → 🖼️ 러프 스케치 프리비주얼 카드 기능 완성 |

### MCP 인프라 (2026-07-14 이전)
| 항목 | 내용 |
|------|------|
| Notion 마스터 허브 구축 | ID: 38560cf6-afd9-81c7-ab52-f99a245a5fa5 |
| 에피소드 파이프라인 DB | 2d093c5f-69c4-4e91-9d2d-0b997ddbe299 |
| 작업·버그 로그 DB | b4f971f4-32bb-413b-b0fe-7aa4ca6d5e12 |
| MCP_PUBLIC_SECRET | 3ab304e7a6c5eefb04676abb89afac23135da004d758635314d8541531d6cc91 |
| video-automation.js switchToVideoMode() | ep5 cut_01 생성 성공 확인 |

### G1~G5 파이프라인 검증 현황
| Step | 실데이터 완주 | 비고 |
|------|------|------|
| G1 대본생성 | ✅ 완주 검증 | 실데이터로 끝까지 확인 |
| G2 이미지생성 (Flow) | 🟡 코드 경로 완성 | MCP 트리거 미검증, flow-automation.js 자체는 별도 디버깅 완료 |
| G3 TTS (ElevenLabs) | ✅ 완주 검증 | 실데이터로 끝까지 확인 |
| G4 영상생성 (video-automation.js) | 🟡 코드 경로 완성 | MCP 트리거 미검증, video-automation.js 자체는 별도 디버깅 완료 |
| G5 편집 (FFmpeg) | ✅ 완주 검증 | 실데이터로 끝까지 확인 |

---

## 📋 대기 중

### Codi_GEN 다음 단계
- ScriptGenTab.jsx pc.ac → pc.at 전환
- codebook 실전 테스트 (SF_E07 마스터 코드로 대본 출력)
- Codi_GEN UI 설계 (codebook 편집 인터페이스, OK/FAIL 학습 데이터 수집)

### 영상/편집 파이프라인
- VideoTab.jsx AI 영상 자동생성 UI 연결
- G4 FFmpeg 실제 합성 로직 (컷별 클립+음성+자막 → MP4)
- G5~G6 미착수 영역

### 서여리 의상 프롬프트 카탈로그 고도화
- 15룩, 7카테고리(A~G), 계절별 태그 + 캐릭터 보드 이미지 추가 예정
- LOOK_BANK에 "검증된 것" vs "수정요청 필요했던 것" 구분

### OneDrive 미디어 동기화
- 집 PC OneDrive 폴더 미생성 상태 확인 필요

---

## ⚠️ 알아야 할 핵심 메모

### MCP 연결 구조
- claude.ai → Vercel api/mcp.js → Cloudflare Quick Tunnel → proxy.js(3001)
- ⚠️ Quick Tunnel URL은 PC 재시작마다 변경 → MCP_BRIDGE_URL 갱신 + Vercel redeploy 필요
- Claude Code 로그인 만료 시: `/login` 실행

### 경로 분리 원칙
- CODE_ROOT(소스코드) ≠ MEDIA_ROOT(`C:\yeori-studio\` 고정)
- 집 PC 소스: `C:\yeori-studio\app\`
- 회사 PC 소스: `C:\Users\won56\OneDrive - CTEC\문서\GitHub\yeori-studio\yeori-studio`

### Codi_GEN 핵심 원칙
- codebook.json = 단일 진실 소스 (스튜디오와 분리)
- 연결 매개체: script_generator.py (JSON→텍스트 변환)
- Versioning: v1.x YEORI 전용 → v2.0 character_id 분기 → v3.0 범용 DSL

### 실행 방법
- 항상 `start_yeori.bat`으로 실행 (회사 PC: `.\start_yeori.bat`)
- Claude API 모델명: `claude-sonnet-4-6`

### ElevenLabs
- 서여리 음성 ID: `RmYuvmCbqOMBJxDLW4k8`
- 모델: eleven_multilingual_sts_v2

---

## 🛠️ 툴 & 계정 현황

| 도구 | 용도 | 상태 |
|------|------|------|
| Google Flow (Veo3/Omni Flash) | 이미지·영상 생성 | 활성 |
| ElevenLabs (서여리 전용) | TTS | 활성 (RmYuvmCbqOMBJxDLW4k8) |
| FFmpeg | 영상+음성 합성 | 설치 완료 (C:\ffmpeg\bin\ffmpeg.exe) |
| Notion MCP | 마스터 허브 | 구축 완료, 07-14 이후 미동기화 |
| A Creative TTS Studio | TTS 도구 | 재구축 완료 (08-06) |
| code_generator_v1.html | 컷 설계 도구 | 러프 스케치 프리비주얼 완성 (08-07) |

---

## 📁 프로젝트 파일 위치
- GitHub: `J-xeses/yeori-studio` (master 브랜치)
- Vercel: `yeori-studio.vercel.app`
- codebook: `app/scripts/codebook_v1.0.0.json`
- 미디어 루트: `C:\yeori-studio\` (양쪽 PC 공통)

---

## 🔄 이 파일 업데이트 방법
세션 끝날 때 "STATUS 업데이트해줘" → 완료된 것 이동 + 새 작업 추가
