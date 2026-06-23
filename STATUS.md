# 여리 스튜디오 STATUS
마지막 업데이트: 2026-06-23

## 완료된 작업

### 인프라
- CODE_ROOT / MEDIA_ROOT 분리 완료
  - CODE_ROOT: PC별 소스코드 경로 / MEDIA_ROOT: C:/yeori-studio/ 고정
  - video-automation.js / flow-automation.js / proxy.js ROOT 판별 로직 통일

### G1~G3 파이프라인
- 대본 생성 (ScriptGenTab) — 8초 기준 CUT 자동 분할
- 스튜디오 이미지 생성 (StudioTab) — Flow 자동화 연동
- **TTSTab 트랙 기반 재설계 완료**
  - 대사/나레이션 분리 트랙 구조
  - 트랙별 speed/stability/similarity 개별 설정
  - 기본값: 대사 0.9x/30%, 나레이션 0.85x/55%
  - 트랙 순서 변경 / 기본값 복원 버튼
  - 자막 포함 여부 트랙별 선택 (대사 ON, 나레이션 OFF 기본)
  - Web Audio API 트랙 합치기 후 WAV to MP3 서버 자동 저장
  - 저장 경로: MEDIA_ROOT/downloads/audio/ep{N}/cut_NN.mp3

### G4 파이프라인
- VideoTab AI 영상 생성 버튼 (컷별 + 전체 AI 생성)
- FFmpeg 합성 버튼 — 영상+음성 합성 MP4
- /api/run-video, /api/run-ffmpeg, /api/save-audio 엔드포인트 완성
- 새로고침 시 수동 불러오기 필요 (자동 스캔 미구현)

### 립싱크 파이프라인 확정 (2026-06-23)
- video-automation.js 대사 프롬프트 자동 삽입
- STS 후처리 자동화 (FFmpeg 음성추출 + ElevenLabs STS + FFmpeg 합치기)
- CapCut 역할 재정의: 컷 이어붙이기 + BGM + 색보정 + 내보내기만
- make-capcut-draft.js 생성 완료 (ce2d2ce)

---

## 핵심 발견 — 립싱크 해결책 (2026-06-23)

### 문제
서여리는 얼핏 사람처럼 인식되는 AI 캐릭터가 핵심 아이덴티티.
입이 안 움직이면 즉시 AI티가 드러남 — 립싱크 필수.

### 시도했으나 포기한 것들
- CapCut 입모양 일치: Pro 유료 기능, 수동 작업, 자동화 불가
- Higgsfield 립싱크 전용 툴: 없음
- Kapwing: 립싱크 기능 없음
- 오픈소스 Wav2Lip/LatentSync: GPU 필요 (미구축)

### 최종 해결책 확정
1. **Veo/Omni Flash 프롬프트에 대사 텍스트 직접 삽입**
   - Veo가 한국어 대사 립싱크 영상 자동 생성 — 검증 완료
2. **FFmpeg로 Veo 생성 음성 추출** (veo_voice.mp3)
3. **ElevenLabs Speech-to-Speech API로 서여리 목소리로 변환**
   - 립싱크 타이밍 보존하면서 목소리만 교체
4. **FFmpeg로 무음 영상 + 서여리 음성 합치기**

---

## 새로운 G4 파이프라인

```
G2 이미지 + 이미지 프롬프트 + 대사 텍스트
  -> Google Flow (Veo/Omni Flash)
  -> 립싱크 영상 (Veo 임시 음성 포함)
  -> FFmpeg 음성 추출 (veo_voice.mp3)
  -> ElevenLabs STS API (서여리 목소리로 변환)
  -> FFmpeg 합치기
  -> cut_NN_final.mp4 완성
```

### CapCut 역할 재정의
- 립싱크: 파이프라인에서 완전 자동 처리
- CapCut = 컷 이어붙이기 + BGM + 색보정 + 내보내기만

---

## 다음 할 일 (우선순위 순)

1. **STS 파이프라인 실제 테스트**
   - EP2 CUT 01로 전체 흐름 검증
   - 대사 프롬프트 삽입 후 Veo 영상 생성
   - STS 후처리 자동 실행 확인

2. **새로고침 시 자동 파일 스캔**
   - 앱 초기화 시 이미지/영상/오디오 자동 불러오기

3. **G5 편집 단계**
   - make-capcut-draft.js 활용한 CapCut 드래프트 자동 생성
   - BGM 트랙 추가

4. **UI 전면 개편** (기능 완성 후)
   - TTSTab, VideoTab, 전체 디자인 보완

---

## 경로 정리 (최종 확정)

**CODE_ROOT (PC별)**
- 회사: `C:/Users/won56/OneDrive - CTEC/문서/GitHub/yeori-studio/yeori-studio`
- 집:   `C:/Users/user/Desktop/yeori-studio/yeori-studio`

**MEDIA_ROOT (고정):** `C:/yeori-studio/downloads/`
- `flow/ep{N}/`      G2 이미지
- `video/ep{N}/`     G4 영상
- `audio/ep{N}/`     G3 TTS 음성
- `output/ep{N}/`    FFmpeg 합성 완성본
- `flow/character/`  yeori-face.jpg, yeori-closeup.jpg

---

## 주요 커밋 히스토리

| 해시 | 내용 |
|------|------|
| 35e6841 | VideoTab AI 영상 생성 버튼 UI |
| d4ba64a | video-automation ROOT 수정 |
| 7e47a15 | CODE_ROOT/MEDIA_ROOT 분리 |
| 906bf48 | TTSTab 트랙 기반 재설계 |
| b58e7e3 | TTS 트랙 타입별 기본값 |
| d20cff5 | LOAD 케이스 deep merge |
| 4843946 | 트랙 기본값 복원 버튼 |
| 1bc267e | WAV to MP3 자동 저장 |
| 949b1ae | FFmpeg 합성 버튼 |
| ce2d2ce | CapCut draft 자동 생성 스크립트 |
| cb46a20 | 립싱크 STS 파이프라인 자동화 |
