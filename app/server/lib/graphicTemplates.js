// graphicTemplates.js
// 템플릿 카테고리 × 스타일 조합으로 그래픽 카드 HTML을 생성한다.
// ESM(proxy.js와 동일하게 import/export) — 이 프로젝트 lib/*.js 관례를 따름.

const TEMPLATES = {

  'mv-intro': {
    label: 'MV 분위기',
    styles: {
      'neon-dark': {
        label: '네온 다크',
        colors: { bg: '#1a0033', main: '#FF2D78', sub: '#9B59B6', accent: '#FFD700' }
      },
      'pastel-dream': {
        label: '파스텔 드림',
        colors: { bg: '#fff0f8', main: '#ff91c8', sub: '#c9b1ff', accent: '#ffe066' }
      },
      'bold-impact': {
        label: '볼드 임팩트',
        colors: { bg: '#000000', main: '#ff2d2d', sub: '#ffffff', accent: '#ff2d2d' }
      }
    },
    fields: ['title', 'subtitle', 'info'],
    generate: (fields, colors, duration) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1920px; height:1080px;
  background: linear-gradient(135deg, ${colors.bg}, ${colors.bg}dd);
  overflow:hidden; font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;
}
.beam {
  position:absolute; width:3px; height:100%;
  animation: sweep 2s ease-in-out infinite;
}
.beam-1 { left:15%; background:linear-gradient(to bottom,transparent,${colors.main},transparent); animation-delay:0s; }
.beam-2 { left:35%; background:linear-gradient(to bottom,transparent,${colors.sub},transparent); animation-delay:0.6s; }
.beam-3 { left:65%; background:linear-gradient(to bottom,transparent,${colors.main},transparent); animation-delay:1.2s; }
.beam-4 { left:85%; background:linear-gradient(to bottom,transparent,${colors.accent},transparent); animation-delay:0.3s; }
@keyframes sweep {
  0%,100% { opacity:0.3; transform:scaleX(1); }
  50% { opacity:0.9; transform:scaleX(4); }
}
.particle {
  position:absolute; width:5px; height:5px;
  border-radius:50%; background:${colors.accent};
  animation: float 3s ease-in-out infinite;
}
@keyframes float {
  0% { transform:translateY(1080px); opacity:0; }
  50% { opacity:1; }
  100% { transform:translateY(-20px); opacity:0; }
}
.title {
  position:absolute; top:32%; width:100%; text-align:center;
  font-size:100px; font-weight:900; color:#fff;
  text-shadow: 0 0 40px ${colors.main}, 0 0 80px ${colors.sub};
  animation: glow 2s ease-in-out infinite; letter-spacing:10px;
}
@keyframes glow {
  0%,100% { text-shadow:0 0 40px ${colors.main},0 0 80px ${colors.sub}; }
  50% { text-shadow:0 0 80px ${colors.main},0 0 160px ${colors.sub},0 0 240px ${colors.accent}; }
}
.subtitle {
  position:absolute; top:56%; width:100%; text-align:center;
  font-size:44px; color:${colors.accent}; letter-spacing:6px;
  animation:fadeInUp 1s ease forwards; opacity:0; animation-delay:0.8s;
}
@keyframes fadeInUp {
  from { transform:translateY(30px); opacity:0; }
  to { transform:translateY(0); opacity:1; }
}
.info {
  position:absolute; bottom:10%; width:100%; text-align:center;
  font-size:30px; color:rgba(255,255,255,0.65); letter-spacing:4px;
}
</style></head><body>
<div class="beam beam-1"></div>
<div class="beam beam-2"></div>
<div class="beam beam-3"></div>
<div class="beam beam-4"></div>
${[10,22,34,46,58,70,82,94].map((l,i)=>`
<div class="particle" style="left:${l}%;animation-delay:${i*0.4}s;background:${i%2===0?colors.main:colors.sub}"></div>`).join('')}
<div class="title">${fields.title||''}</div>
<div class="subtitle">${fields.subtitle||''}</div>
<div class="info">${fields.info||''}</div>
</body></html>`
  },

  'text-card': {
    label: '텍스트 카드',
    styles: {
      'minimal': {
        label: '미니멀',
        colors: { bg: '#ffffff', main: '#111111', sub: '#666666', accent: '#FF2D78' }
      },
      'gradient': {
        label: '그라디언트',
        colors: { bg: '#667eea', main: '#ffffff', sub: '#e0e7ff', accent: '#ffd700' }
      },
      'dark-minimal': {
        label: '다크 미니멀',
        colors: { bg: '#111111', main: '#ffffff', sub: '#aaaaaa', accent: '#FF2D78' }
      }
    },
    fields: ['title', 'subtitle', 'info'],
    generate: (fields, colors, duration) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1920px; height:1080px;
  background:${colors.bg.startsWith('#6')?`linear-gradient(135deg,${colors.bg},#764ba2)`:colors.bg};
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;
}
.accent-line {
  width:80px; height:6px;
  background:${colors.accent};
  margin-bottom:48px;
  animation:expand 1s ease forwards;
}
@keyframes expand {
  from { width:0; } to { width:80px; }
}
.title {
  font-size:88px; font-weight:900;
  color:${colors.main}; text-align:center;
  line-height:1.2; letter-spacing:4px;
  margin-bottom:32px;
  animation:fadeIn 0.8s ease forwards;
}
.subtitle {
  font-size:44px; color:${colors.sub};
  text-align:center; letter-spacing:3px;
  animation:fadeIn 0.8s ease forwards;
  animation-delay:0.4s; opacity:0;
}
.info {
  position:absolute; bottom:10%;
  font-size:28px; color:${colors.sub};
  opacity:0.7; letter-spacing:2px;
}
@keyframes fadeIn {
  from { opacity:0; transform:translateY(20px); }
  to { opacity:1; transform:translateY(0); }
}
</style></head><body>
<div class="accent-line"></div>
<div class="title">${fields.title||''}</div>
<div class="subtitle">${fields.subtitle||''}</div>
<div class="info">${fields.info||''}</div>
</body></html>`
  },

  'stat-card': {
    label: '정보 카드',
    styles: {
      'infographic': {
        label: '인포그래픽',
        colors: { bg: '#0f1729', main: '#ffffff', sub: '#8892b0', accent: '#64ffda' }
      },
      'versus': {
        label: 'VS 비교',
        colors: { bg: '#111111', main: '#ffffff', sub: '#888888', accent: '#FF2D78' }
      }
    },
    fields: ['title', 'stat1_label', 'stat1_value', 'stat2_label', 'stat2_value', 'stat3_label', 'stat3_value'],
    generate: (fields, colors, duration) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1920px; height:1080px;
  background:${colors.bg};
  display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:60px;
  font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;
}
.title {
  font-size:56px; font-weight:700;
  color:${colors.sub}; letter-spacing:6px;
  text-transform:uppercase;
}
.stats {
  display:flex; gap:120px; align-items:center;
}
.stat {
  display:flex; flex-direction:column;
  align-items:center; gap:16px;
  animation:countUp 1s ease forwards;
}
.stat-value {
  font-size:100px; font-weight:900;
  color:${colors.accent}; line-height:1;
}
.stat-label {
  font-size:30px; color:${colors.sub};
  letter-spacing:4px;
}
.divider {
  width:2px; height:160px;
  background:rgba(255,255,255,0.15);
}
@keyframes countUp {
  from { opacity:0; transform:translateY(30px); }
  to { opacity:1; transform:translateY(0); }
}
</style></head><body>
<div class="title">${fields.title||''}</div>
<div class="stats">
  <div class="stat">
    <div class="stat-value">${fields.stat1_value||''}</div>
    <div class="stat-label">${fields.stat1_label||''}</div>
  </div>
  ${fields.stat2_value?`<div class="divider"></div>
  <div class="stat" style="animation-delay:0.3s">
    <div class="stat-value">${fields.stat2_value}</div>
    <div class="stat-label">${fields.stat2_label||''}</div>
  </div>`:''}
  ${fields.stat3_value?`<div class="divider"></div>
  <div class="stat" style="animation-delay:0.6s">
    <div class="stat-value">${fields.stat3_value}</div>
    <div class="stat-label">${fields.stat3_label||''}</div>
  </div>`:''}
</div>
</body></html>`
  },

  // 실존 그룹/인물에 대한 "사실 정보 전달" 목적 카드 — AI 재현·합성 없이 텍스트만으로
  // 구성한다. 출처·인용 목적 고지는 fields가 아니라 템플릿에 고정으로 박아 넣어서
  // (fillable로 두면 매번 깜빡하고 빼먹을 수 있음) 항상 화면에 나오게 강제한다.
  'info-source': {
    label: '출처 표기 정보 카드',
    styles: {
      'news-light': {
        label: '뉴스 라이트',
        colors: { bg: '#f4f6fb', main: '#0f1729', sub: '#5b6472', accent: '#2563eb' }
      },
      'news-dark': {
        label: '뉴스 다크',
        colors: { bg: '#0f1729', main: '#ffffff', sub: '#8892b0', accent: '#64ffda' }
      }
    },
    fields: ['title', 'fact1', 'fact2', 'fact3', 'source'],
    generate: (fields, colors, duration) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1920px; height:1080px;
  background:${colors.bg};
  display:flex; flex-direction:column;
  justify-content:center;
  font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;
  position:relative;
}
.badge {
  position:absolute; top:64px; left:120px;
  display:inline-flex; align-items:center; gap:10px;
  background:${colors.accent}; color:${colors.bg};
  font-size:24px; font-weight:800; letter-spacing:3px;
  padding:10px 22px; border-radius:8px;
  animation:fadeIn 0.6s ease forwards;
}
.title {
  margin:0 120px 48px; font-size:76px; font-weight:900;
  color:${colors.main}; letter-spacing:-1px; line-height:1.2;
  animation:fadeIn 0.6s ease forwards; animation-delay:0.15s; opacity:0;
}
.facts { margin:0 120px; display:flex; flex-direction:column; gap:28px; }
.fact {
  display:flex; align-items:flex-start; gap:20px;
  font-size:38px; color:${colors.main}; line-height:1.5;
  animation:fadeIn 0.6s ease forwards; opacity:0;
}
.fact .dot {
  flex-shrink:0; width:14px; height:14px; border-radius:50%;
  background:${colors.accent}; margin-top:14px;
}
.footer {
  position:absolute; bottom:0; left:0; right:0;
  background:rgba(0,0,0,${colors.bg === '#0f1729' ? '0.25' : '0.05'});
  border-top:2px solid ${colors.accent};
  padding:26px 120px; display:flex; align-items:center; gap:14px;
  font-size:24px; color:${colors.sub};
  animation:fadeIn 0.6s ease forwards; animation-delay:0.8s; opacity:0;
}
.footer b { color:${colors.main}; font-weight:700; }
@keyframes fadeIn {
  from { opacity:0; transform:translateY(16px); }
  to { opacity:1; transform:translateY(0); }
}
</style></head><body>
<div class="badge">ℹ️ INFO</div>
<div class="title">${fields.title||''}</div>
<div class="facts">
  ${[fields.fact1, fields.fact2, fields.fact3].filter(Boolean).map((f, i) =>
    `<div class="fact" style="animation-delay:${0.3 + i * 0.15}s"><span class="dot"></span><span>${f}</span></div>`
  ).join('\n  ')}
</div>
<div class="footer">
  <b>ℹ️ 정보 제공 목적의 인용</b> · 출처: ${fields.source || '(출처 입력 필요)'}
</div>
</body></html>`
  },

  // 가상/허구 설정 에피소드의 오프닝에 까는 고지 카드. 면책 문구는 info-source의
  // 출처 문구와 같은 이유로 fields가 아니라 템플릿에 고정 — "이건 허구다"를 명시하는
  // 게 이 템플릿의 유일한 존재 이유라서, 빼먹으면 안 되는 문구를 채워야 하는 값으로
  // 두지 않는다. title/subtitle은 그 에피소드의 가상 설정을 짧게 설명하는 용도.
  'fiction-disclaimer': {
    label: '가상 설정 고지 카드',
    styles: {
      'notice-dark': {
        label: '노티스 다크',
        colors: { bg: '#0b0c10', main: '#f5f4f0', sub: '#9a9890', accent: '#c9a96e' }
      },
      'notice-light': {
        label: '노티스 라이트',
        colors: { bg: '#faf9f6', main: '#14140f', sub: '#5c5a52', accent: '#8a6d3b' }
      }
    },
    fields: ['title', 'subtitle'],
    generate: (fields, colors, duration) => `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width:1920px; height:1080px;
  background:${colors.bg};
  display:flex; align-items:center; justify-content:center;
  font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;
}
.frame {
  width:1500px; padding:80px 100px;
  border:1.5px solid ${colors.accent};
  border-radius:4px;
  display:flex; flex-direction:column; align-items:center; text-align:center;
  animation:fadeIn 0.8s ease forwards;
}
.eyebrow {
  font-size:24px; font-weight:700; letter-spacing:8px;
  color:${colors.accent}; margin-bottom:36px;
}
.title {
  font-size:58px; font-weight:800; color:${colors.main};
  letter-spacing:-.5px; line-height:1.35; margin-bottom:20px;
  animation:fadeIn 0.8s ease forwards; animation-delay:0.2s; opacity:0;
}
.subtitle {
  font-size:30px; color:${colors.sub}; line-height:1.6; margin-bottom:44px;
  animation:fadeIn 0.8s ease forwards; animation-delay:0.35s; opacity:0;
}
.divider { width:64px; height:2px; background:${colors.accent}; margin-bottom:44px; opacity:.6; }
.disclaimer {
  font-size:26px; color:${colors.sub}; line-height:1.9; max-width:1100px;
  animation:fadeIn 0.8s ease forwards; animation-delay:0.5s; opacity:0;
}
.disclaimer b { color:${colors.main}; font-weight:700; }
@keyframes fadeIn {
  from { opacity:0; transform:translateY(14px); }
  to { opacity:1; transform:translateY(0); }
}
</style></head><body>
<div class="frame">
  <div class="eyebrow">NOTICE</div>
  <div class="title">${fields.title||''}</div>
  ${fields.subtitle ? `<div class="subtitle">${fields.subtitle}</div>` : ''}
  <div class="divider"></div>
  <div class="disclaimer">
    <b>이 영상은 AI로 제작된 가상의 이야기입니다.</b><br>
    실제 사건이 아니며, 언급되는 인물·그룹명이 있다면<br>
    이는 창작 설정 안에서만 쓰인 것입니다.
  </div>
</div>
</body></html>`
  }
};

// MD 코드 → 추천 템플릿+스타일
// MD 코드 8종은 app/data/codebook.json의 "MD" 표가 원본(진짜 존재하는 값만 — 예전에
// 여기 있던 MD_COM/MD_EMO는 codebook에 없는 코드라 지웠음, 2026-09-05).
// cut.masterCode.md에 담겨 대본(스크립트) 원문의 "MD:" 필드에서 옴 — MakingTab.jsx의
// GraphicCardGenerator가 그 값으로 이 API를 호출한다.
const MD_RECOMMEND = {
  'MD_JOY': { type: 'mv-intro', style: 'pastel-dream' },   // 밝은 미소·에너지
  'MD_SUR': { type: 'mv-intro', style: 'bold-impact' },    // 놀람·충격 — 임팩트 있게
  'MD_STR': { type: 'mv-intro', style: 'neon-dark' },      // 자신감·단단함 — 힘있게
  'MD_REL': { type: 'text-card', style: 'minimal' },       // 편안함·여유 — 담백하게
  'MD_CUR': { type: 'text-card', style: 'gradient' },      // 호기심 — 궁금증 유발 톤
  'MD_DRM': { type: 'text-card', style: 'gradient' },      // 몽환적 — 이름 그대로 "드림" 톤과도 맞음
  'MD_SAD': { type: 'text-card', style: 'dark-minimal' },  // 잔잔한 우울 — 차분하고 어둡게
  'MD_INT': { type: 'stat-card', style: 'infographic' },   // 몰입·진지함 — 분석적으로
};

export function generateHTML(type, style, fields, duration = 10) {
  const tmpl = TEMPLATES[type];
  if (!tmpl) throw new Error(`Unknown template: ${type}`);
  const styleConf = tmpl.styles[style];
  if (!styleConf) throw new Error(`Unknown style: ${style}`);
  return tmpl.generate(fields || {}, styleConf.colors, duration);
}

export function getRecommendation(mdCode) {
  return MD_RECOMMEND[mdCode] || { type: 'text-card', style: 'minimal' };
}

export function getTemplateList() {
  return Object.entries(TEMPLATES).map(([type, tmpl]) => ({
    type,
    label: tmpl.label,
    fields: tmpl.fields,
    styles: Object.entries(tmpl.styles).map(([style, conf]) => ({
      style,
      label: conf.label
    }))
  }));
}

export { TEMPLATES };
