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
