# 여리 스튜디오 STATUS
마지막 업데이트: 2026-06-23 (야간)

완료된 작업
인프라

CODE_ROOT / MEDIA_ROOT 분리 완료
CODE_ROOT: PC별 소스코드 경로 / MEDIA_ROOT: C:/yeori-studio/ 고정
video-automation.js / flow-automation.js / proxy.js ROOT 판별 로직 통일
setup.bat 원클릭 환경 세팅 스크립트 완성 (327b84a)

G1~G3 파이프라인

대본 생성 (ScriptGenTab) 8초 기준 CUT 자동 분할
스튜디오 이미지 생성 (StudioTab) Flow 자동화 연동
TTSTab 트랙 기반 재설계 완료

대사/나레이션 분리 트랙 구조
트랙별 speed/stability/similarity 개별 설정
기본값: 대사 0.9x/30%, 나레이션 0.85x/55%
트랙 순서 변경 / 기본값 복원 버튼
자막 포함 여부 트랙별 선택 (대사 ON, 나레이션 OFF 기본)
Web Audio API 트랙 합치기 후 WAV to MP3 서버 자동 저장
저장 경로: MEDIA_ROOT/downloads/audio/ep{N}/cut_NN.mp3


TTS 탭 역할 재정의: 나레이션 전용 (대사는 Veo+STS로 자동 처리)

G4 파이프라인 (립싱크 완전 해결)

VideoTab AI 영상 생성 버튼 (컷별 + 전체 AI 생성)
FFmpeg 합성 버튼 영상+음성 합성 MP4
/api/run-video, /api/run-ffmpeg, /api/save-audio 엔드포인트 완성

립싱크 파이프라인 확정 (2026-06-23 핵심 발견)

Veo/Omni Flash 프롬프트에 대사 텍스트 삽입 → 한국어 립싱크 영상 자동 생성 검증 완료
Demucs (Meta 오픈소스) 로 대사/배경음 완벽 분리
ElevenLabs STS API로 서여리 목소리로 변환 (타이밍 보존)
FFmpeg 3트랙 합성 (영상 + 서여리음성 + 배경음)
전체 자동화 완성: cb46a20, e5dc017

G5 편집 준비

make-capcut-draft.js: yeori_edit_meta.json 기반 CapCut 드래프트 자동 생성 (b44d290)
EditMetaTab JSON 내보내기: 브라우저 다운로드 + 서버 자동 저장 병행
저장 경로: MEDIA_ROOT/downloads/video/yeori_edit_meta.json
CapCut 역할: 컷 이어붙이기 + BGM + 색보정 + 내보내기만

캐릭터 일관성 서브라인 발견 (2026-06-23 야간)

Higgsfield Video Analysis로 생성된 영상 씬별 분석
분석 결과에서 캐릭터 고정 요소 자동 추출

의상 디테일, 액세서리, 조명, 카메라 설정 등


추출된 요소를 이후 컷 프롬프트에 자동 삽입
episode_style_guide.json으로 저장 후 에피소드 내 일관성 유지
미구현 상태 다음 세션 작업 예정


새로운 G4 파이프라인 (최종 확정)
G2 이미지 + 이미지 프롬프트 + 대사 텍스트

-> Google Flow (Veo/Omni Flash)

-> 립싱크 영상 (Veo 임시 음성 포함)

-> Demucs (대사/배경음 분리)

-> ElevenLabs STS API (서여리 목소리로 변환)

-> FFmpeg 3트랙 합성

-> cut_NN_final.mp4 완성

다음 할 일 (우선순위 순)

Higgsfield Analysis 서브라인 구현

첫 컷 생성 후 자동 분석 버튼 (StudioTab)
episode_style_guide.json 저장
이후 컷 프롬프트에 고정 요소 자동 삽입


자막 억제 프롬프트 수정

Veo 영상에 자막이 자동 생성되는 문제
NO subtitles NO captions NO text overlay 추가


새로고침 시 자동 파일 스캔

앱 초기화 시 이미지/영상/오디오 자동 불러오기


추출 탭 개선

video-prompts.json 내보내기 버튼 추가
타입별 컷 분류 내보내기


롱폼 모듈화 설계

TYPE A: 서여리 영상컷 (현재 파이프라인)
TYPE B: 이미지 슬라이드컷
TYPE C: 서여리 나레이션컷
TYPE D: 외부소스컷
TYPE E: 타이틀/인트로컷
대본 생성 단계에서 타입 지정 후 파이프라인 자동 분기


UI 전면 개편 (기능 완성 후)


경로 정리 (최종 확정)
CODE_ROOT (PC별)

회사: C:/Users/won56/OneDrive - CTEC/문서/GitHub/yeori-studio/yeori-studio

집:   C:/Users/user/Desktop/yeori-studio/yeori-studio
MEDIA_ROOT (고정): C:/yeori-studio/downloads/

flow/ep{N}/           G2 이미지

video/ep{N}/          G4 영상

video/yeori_edit_meta.json  편집 메타

video/video-prompts.json    영상 프롬프트

audio/ep{N}/          G3 TTS 음성

output/ep{N}/         FFmpeg 합성 완성본

flow/character/       yeori-face.jpg, yeori-closeup.jpg

주요 커밋 히스토리

35e6841: VideoTab AI 영상 생성 버튼 UI
d4ba64a: video-automation ROOT 수정
7e47a15: CODE_ROOT/MEDIA_ROOT 분리
906bf48: TTSTab 트랙 기반 재설계
b58e7e3: TTS 트랙 타입별 기본값
d20cff5: LOAD 케이스 deep merge
4843946: 트랙 기본값 복원 버튼
1bc267e: WAV to MP3 자동 저장
949b1ae: FFmpeg 합성 버튼
ce2d2ce: CapCut draft 자동 생성 스크립트
cb46a20: 립싱크 STS 파이프라인 자동화
e5dc017: Demucs 파이프라인 적용
4914e8b: 머지 충돌 해결
327b84a: setup.bat 환경 세팅
b44d290: make-capcut-draft yeori_edit_meta 연동
