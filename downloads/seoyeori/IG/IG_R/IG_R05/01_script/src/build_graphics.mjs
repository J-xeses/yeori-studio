// IG_R05 그래픽 컷 빌드: src/*.src.html 의 {{IMG:상대경로}} 를 base64 data URI 로 인라인 → 01_script/cut_NN_*.html
// (스튜디오 캡처는 page.setContent 라 상대경로 이미지를 못 읽음). 사용: node 01_script/src/build_graphics.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const here = path.dirname(fileURLToPath(import.meta.url))
for (const f of fs.readdirSync(here).filter(f => f.endsWith('.src.html'))) {
  const html = fs.readFileSync(path.join(here, f), 'utf-8').replace(/\{\{IMG:([^}]+)\}\}/g, (_, rel) => {
    const abs = path.resolve(here, '..', rel)
    const ext = path.extname(abs).slice(1).toLowerCase().replace('jpg', 'jpeg')
    return `data:image/${ext};base64,${fs.readFileSync(abs).toString('base64')}`
  })
  const out = path.join(here, '..', f.replace('.src.html', '.html'))
  fs.writeFileSync(out, html, 'utf-8')
  console.log(path.basename(out), Math.round(html.length / 1024) + 'KB')
}
