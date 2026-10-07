/**
 * make-image-sequence-cut.js — 사진 1~N장을 "크로스페이드 + 켄번즈 줌"으로 이어붙여 컷 mp4 를 만든다.
 *
 * 구현은 서버 한 곳(proxy.js makeImageSequenceCut)에만 있다. 이 스크립트는 그걸 부르는 얇은 CLI —
 * 메이킹 탭 버튼, 자동실행·MCP(make_graphic_cut 이 컷의 imageSeq 레시피를 보고 호출)와 결과가 항상 같다.
 * (2026-09-30 첫 버전은 캡처 로직을 따로 갖고 있어서, 이후 서버 쪽에 들어간 수정 — 나레이션 길이 보정,
 *  전체 보이기 맞춤 등 — 이 여기엔 빠져 있었다. 2026-10-07 통합.)
 *
 * 사용법 (프록시 :3001 실행 중이어야 함):
 *   node scripts/make-image-sequence-cut.js --ep=2 --cut=1 --images=cut_01_a.jpg,cut_01_b.jpg --duration=5
 *   node scripts/make-image-sequence-cut.js --ep=2 --cut=5 --images=cut_05_a.jpg --duration=4 --audio=cut_05_nr.mp3 --confirm
 *
 * 옵션:
 *   --ep        에피소드 번호
 *   --cut       컷 번호
 *   --images    02_images/ 안의 파일명, 콤마로 구분(등장 순서)
 *   --duration  길이(초). 기본 3
 *   --effect    auto(기본: 1장=줌, 2장 이상=크로스페이드+줌) | crossfade | kenburns | both
 *   --fit       cover(기본, 꽉 채우기) | contain(전체 보이기 — 스크린샷·목업용)
 *   --audio     03_audio/ 안의 나레이션 파일명(선택)
 *   --confirm   붙이면 실제 05_video/cut_NN.mp4 를 교체. 없으면 _manual_work/ 에 미리보기만.
 */

const SERVER = process.env.YEORI_SERVER || 'http://localhost:3001'

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    if (m) out[m[1]] = m[2] === undefined ? true : m[2]
  }
  return out
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.ep || !a.cut || !a.images) {
    console.error('필수: --ep=<에피소드 번호> --cut=<컷 번호> --images=<파일명,파일명…>')
    process.exit(2)
  }
  const body = {
    epNum: Number(a.ep), cutNo: Number(a.cut),
    images: String(a.images).split(',').map(s => s.trim()).filter(Boolean),
    duration: parseFloat(a.duration || '3'),
    effect: a.effect || 'auto',
    fit: a.fit || 'cover',
    audioFile: a.audio || undefined,
    preview: !a.confirm,
  }
  console.log(`${body.preview ? '미리보기' : '확정'} — 컷 ${body.cutNo} · 사진 ${body.images.length}장 · ${body.duration}초 · ${body.effect}/${body.fit}${body.audioFile ? ` · 나레이션 ${body.audioFile}` : ''}`)
  const res = await fetch(`${SERVER}/api/image-sequence-cut`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) { console.error('실패:', data.error || res.status); process.exit(1) }
  console.log(`완료: ${data.videoPath}${data.audioApplied ? ' (나레이션 포함)' : ''}`)
}

main().catch(err => { console.error('실패:', err.message, '— 프록시(:3001)가 켜져 있는지 확인하세요.'); process.exit(1) })
