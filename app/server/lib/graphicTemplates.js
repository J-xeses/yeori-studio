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
      },
      // 여리 스튜디오 브랜드 팔레트(인트로/엔드카드/B04·B05와 동일 색계)
      'yeori': {
        label: '여리 브랜드',
        colors: { bg: '#0C0A10', main: '#F5F1EC', sub: '#5BB8FF', accent: '#C87FFF' }
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
      },
      'yeori': {
        label: '여리 브랜드',
        colors: { bg: '#0C0A10', main: '#F5F1EC', sub: '#8b8494', accent: '#5BB8FF' }
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
  },

  // 3분할 카드 — "세 대상을 나란히 비교/소개" (LF_T01 B04 계열). 카드별 등장.
  'cards-3col': {
    label: '3분할 카드',
    styles: {
      'yeori':   { label: '여리 브랜드', colors: { bg: '#0C0A10', main: '#F5F1EC', sub: 'rgba(245,241,236,.55)', accent: '#5BB8FF', c1: '#5BB8FF', c2: '#FF6B8A', c3: '#C87FFF' } },
      'light':   { label: '라이트',     colors: { bg: '#F5F1EC', main: '#14121A', sub: 'rgba(20,18,26,.55)', accent: '#5B34E0', c1: '#2563eb', c2: '#e11d48', c3: '#7c3aed' } }
    },
    fields: ['title', 'card1_name', 'card1_desc', 'card2_name', 'card2_desc', 'card3_name', 'card3_desc'],
    generate: (f, c, dur, dims = { w: 1920, h: 1080 }) => {
      const cards = [1, 2, 3].map(i => ({ n: f[`card${i}_name`] || '', d: f[`card${i}_desc`] || '', col: c[`c${i}`] }))
        .filter(x => x.n)
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${dims.w}px;height:${dims.h}px;overflow:hidden;background:${c.bg};
  font-family:'Pretendard','Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,sans-serif;color:${c.main}}
.stage{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:64px;padding:7%}
.headline{font-size:76px;font-weight:900;letter-spacing:-.02em;text-align:center;opacity:0;
  animation:rise .7s cubic-bezier(.16,1,.3,1) .1s forwards}
.cards{display:flex;gap:28px;width:100%;justify-content:center}
.card{flex:1;max-width:440px;border-radius:20px;padding:40px 36px;
  border:1.5px solid;background:rgba(127,127,140,.06);opacity:0;transform:translateY(40px) scale(.96);
  animation:pop .7s cubic-bezier(.22,1.4,.36,1) forwards}
.card:nth-child(1){animation-delay:.7s}.card:nth-child(2){animation-delay:.87s}.card:nth-child(3){animation-delay:1.04s}
.card .nm{font-size:40px;font-weight:800;margin-bottom:18px}
.card .ds{font-size:26px;line-height:1.55;color:${c.sub}}
@keyframes rise{to{opacity:1;transform:none}}
@keyframes pop{to{opacity:1;transform:none}}
</style></head><body><div class="stage">
<div class="headline">${f.title || ''}</div>
<div class="cards">${cards.map(x => `<div class="card" style="border-color:${x.col}66;box-shadow:0 0 32px ${x.col}22">
<div class="nm" style="color:${x.col}">${x.n}</div><div class="ds">${x.d}</div></div>`).join('')}</div>
</div></body></html>`
    }
  },

  // 관계도 — "가운데 핵심 + 사방 노드" (LF_T01 B05 계열). 연결선이 그려지고 노드가 팝인.
  'relation': {
    label: '관계도',
    styles: {
      'yeori': { label: '여리 브랜드', colors: { bg: '#0C0A10', main: '#F5F1EC', sub: 'rgba(245,241,236,.6)', accent: '#FFB877' } },
      'light': { label: '라이트',     colors: { bg: '#F5F1EC', main: '#14121A', sub: 'rgba(20,18,26,.6)', accent: '#5B34E0' } }
    },
    fields: ['title', 'center', 'node1', 'node2', 'node3', 'node4'],
    generate: (f, c, dur, dims = { w: 1920, h: 1080 }) => {
      const nodes = [f.node1, f.node2, f.node3, f.node4].filter(Boolean)
      const pos = [{ x: 16, y: 26 }, { x: 84, y: 26 }, { x: 16, y: 74 }, { x: 84, y: 74 }]
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${dims.w}px;height:${dims.h}px;overflow:hidden;background:${c.bg};
  font-family:'Pretendard','Apple SD Gothic Neo',-apple-system,BlinkMacSystemFont,sans-serif;color:${c.main}}
.t{position:absolute;top:8%;left:0;right:0;text-align:center;font-size:60px;font-weight:900;letter-spacing:-.02em;
  opacity:0;animation:fade .6s ease .1s forwards}
svg{position:absolute;inset:0;width:100%;height:100%}
.ln{stroke:${c.accent};stroke-width:2;fill:none;stroke-dasharray:1200;stroke-dashoffset:1200;
  animation:draw 1s ease 1s forwards}
.node{position:absolute;transform:translate(-50%,-50%) scale(.7);opacity:0;
  padding:22px 34px;border-radius:16px;border:1.5px solid ${c.sub};background:rgba(127,127,140,.08);
  font-size:32px;font-weight:700;white-space:nowrap;animation:pop .6s cubic-bezier(.22,1.5,.36,1) forwards}
.center{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%) scale(.6);opacity:0;
  width:230px;height:230px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  border:2px solid ${c.accent};box-shadow:0 0 60px ${c.accent}55;font-size:38px;font-weight:900;text-align:center;
  animation:pop .7s cubic-bezier(.22,1.6,.36,1) .5s forwards}
@keyframes fade{to{opacity:1}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pop{to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
</style></head><body>
<div class="t">${f.title || ''}</div>
<svg viewBox="0 0 100 100" preserveAspectRatio="none">
${nodes.map((_, i) => `<path class="ln" style="animation-delay:${1 + i * .15}s" d="M50 52 L${pos[i].x} ${pos[i].y}"/>`).join('')}
</svg>
<div class="center">${f.center || ''}</div>
${nodes.map((n, i) => `<div class="node" style="left:${pos[i].x}%;top:${pos[i].y}%;animation-delay:${.8 + i * .18}s">${n}</div>`).join('')}
</body></html>`
    }
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

export function generateHTML(type, style, fields, duration = 10, dims = { w: 1920, h: 1080 }) {
  const tmpl = TEMPLATES[type];
  if (!tmpl) throw new Error(`Unknown template: ${type}`);
  // 스타일 생략 시 그 템플릿의 첫 스타일로 (GTPL: "relation" 처럼 스타일 안 적어도 됨)
  const styleKey = style && tmpl.styles[style] ? style : Object.keys(tmpl.styles)[0];
  const styleConf = tmpl.styles[styleKey];
  if (!styleConf) throw new Error(`Unknown style: ${style}`);
  return tmpl.generate(fields || {}, styleConf.colors, duration, dims);
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
