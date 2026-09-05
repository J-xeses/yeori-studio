# graphicTemplates.js — 템플릿 라이브러리 설계 원칙

`app/server/lib/graphicTemplates.js`에 템플릿을 추가·수정할 때 지키는 기준.
2026-09-05, 세 그룹 콜라보 에피소드(LF_T01) 배경장면 초상권/부정경쟁방지법 이슈를
검토하면서 정리됨 — 왜 이 원칙들이 생겼는지는 그 논의를 참고.

## 왜 이 라이브러리가 존재하는가

배경장면·정보 화면을 AI로 매번 새로 프롬프트 짜서 만들면, 그때그때 사람이
실수하기 쉬운 지점(실명 노출, 출처 누락, 허구를 진짜처럼 포장)이 반복해서
발생한다. 템플릿은 이 지점들을 **코드 레벨에서 강제**해서 사람이 깜빡해도
안전하게 만드는 안전장치다. 속도는 부수효과.

## 핵심 설계 원칙

1. **실존 인물·그룹을 AI로 시각적으로 재현하는 템플릿은 만들지 않는다.**
   얼굴·퍼포먼스·특정 그룹 스타일을 사진처럼 재현하는 용도가 아니라,
   텍스트·그래픽·추상적 연출로만 구성한다. (초상권/부정경쟁방지법 2조 — 이름·
   초상 등 식별 표지의 무단 상업적 이용에 해당할 수 있음)

2. **컴플라이언스 문구는 fields가 아니라 템플릿에 고정한다.**
   출처 표기, 가상 설정 고지처럼 "항상 나와야 하는" 문구는 채워 넣는 값으로
   두지 않는다 — 사람이 빼먹을 수 있는 자리에 두면 언젠가는 빼먹는다.
   `info-source`의 "정보 제공 목적의 인용", `fiction-disclaimer`의 고정
   면책 문구가 이 원칙의 구현.

3. **MD 무드 코드는 `app/data/codebook.json`의 실제 8종만 쓴다.**
   `MD_JOY / MD_SUR / MD_STR / MD_REL / MD_CUR / MD_DRM / MD_SAD / MD_INT`.
   임의로 코드를 지어내지 않는다(예전에 `MD_COM`/`MD_EMO`를 지어냈다가 바로잡은
   적 있음). 무드 기반이 아니라 목적 기반으로 고르는 템플릿(`info-source`,
   `fiction-disclaimer` 등)은 `MD_RECOMMEND`에 넣지 않아도 된다.

4. **모든 템플릿은 같은 구조를 따른다.**
   ```js
   'template-key': {
     label: '한글 표시명',
     styles: { 'style-key': { label: '한글 스타일명', colors: {...} } },
     fields: ['field1', 'field2', ...],
     generate: (fields, colors, duration) => `<!DOCTYPE html>...`
   }
   ```
   `generate()`는 1920×1080 고정 캔버스, `'Pretendard','Apple SD Gothic Neo',sans-serif`,
   페이드인 계열 애니메이션(`fadeIn`/`countUp` 등)을 기본으로 따른다 — 다른
   템플릿과 톤이 어긋나지 않게.

## 현재 템플릿

| type | 용도 | 스타일 |
|---|---|---|
| `mv-intro` | 무드/오프닝 인트로 | neon-dark · pastel-dream · bold-impact |
| `text-card` | 일반 텍스트 카드 | minimal · gradient · dark-minimal |
| `stat-card` | 통계·비교 | infographic · versus |
| `info-source` | 사실 정보 전달(출처 고정 표기) | news-light · news-dark |
| `fiction-disclaimer` | 가상 설정 고지(면책 문구 고정) | notice-dark · notice-light |

## 새 템플릿 추가 전 체크리스트

- [ ] 실존 인물의 얼굴·퍼포먼스를 재현하지 않는가?
- [ ] 법적/윤리적으로 항상 보여야 하는 문구가 있다면 field가 아니라 템플릿에 고정했는가?
- [ ] MD 코드를 쓴다면 codebook.json의 8종 중에서만 매핑했는가?
- [ ] `node --check`와 `generateHTML()` 직접 호출로 실제 HTML이 나오는지 확인했는가?
- [ ] `getTemplateList()`에 자동으로 잡히는지 확인했는가? (TEMPLATES에 넣기만 하면 됨, 별도 등록 불필요)

## 관련 파일

- `app/server/proxy.js` — `/api/graphic-templates`, `/api/generate-graphic-html`, `/api/graphic-recommend`
- `app/src/tabs/MakingTab.jsx` — `GraphicCardGenerator` 컴포넌트 (CAPCUT 컷 카드 안)
- `app/data/codebook.json` — MD 무드 코드 원본 8종
- `app/data/studio-data.json` — 컷의 `masterCode.md`에 실제 무드 코드가 들어있음
