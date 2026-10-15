// ── 인스타그램 릴스 업로드(Content Publishing API, graph.instagram.com) — 2026-10-15 ──
// 성준님 요청(퍼블리싱 탭 ④업로드, 1단계): ②제목/설명/태그 + ③결과물 패키징에서 이미 준비된
// 캡션/최종영상을 그대로 가져다 실제로 인스타에 올린다.
//
// 토큰: igInsights.js와 동일한 studio-secrets.json apiKeys.instagram = { token, userId }
// (이미 "성과 자동 수집"용으로 구성돼 있던 걸 그대로 재사용 — 서여리 계정이 그 과정으로 만들어짐).
//
// 공개 URL: 인스타 서버가 영상을 직접 받아가야(video_url) 해서 로컬 파일로는 안 됨 — 이미 떠 있는
// Cloudflare Quick Tunnel(.tunnel-state.json, TUNNEL_TARGET=localhost:3001, MCP 브릿지와 같은
// 터널이 전체 origin을 그대로 리버스프록시함)을 그대로 재사용해 downloads/ 정적 파일을 공개 URL로
// 노출한다 — 새 호스팅(Vercel Blob 등) 없이 기존 인프라만으로 충분함(실측: /downloads/* 가 터널
// 너머로 200 응답, 2026-10-15).
//
// 흐름: ① 토큰 갱신 ② 패키징된 ep{N}_final.mp4를 터널 공개 URL로 변환 ③ media 컨테이너 생성
//       (media_type=REELS) ④ 상태가 FINISHED 될 때까지 폴링 ⑤ media_publish ⑥ permalink 조회
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mp from './mediaPaths.js'
import { readSecrets, maybeRefresh } from './igInsights.js'

const G = 'https://graph.instagram.com'
const TUNNEL_STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.tunnel-state.json')

async function gfetch(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { method })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`)
  return j
}

function publicTunnelBase() {
  let st
  try { st = JSON.parse(fs.readFileSync(TUNNEL_STATE, 'utf-8')) } catch { throw new Error('터널 상태 파일(.tunnel-state.json)을 못 읽었습니다 — YeoriMcpTunnel 작업이 떠 있는지 확인하세요') }
  if (!st.url) throw new Error('터널 URL이 비어 있습니다')
  return st.url
}

export async function publishReel({ epNum, caption }) {
  const sec = readSecrets()
  const ig = sec.apiKeys?.instagram
  if (!ig?.token || !ig?.userId) throw new Error('인스타 토큰/계정 없음 — studio-secrets.json apiKeys.instagram')
  const token = await maybeRefresh(sec)

  // ③ 패키징 단계가 만든 downloads/{...}/07_output/ep{N}/ep{N}_final.mp4 를 공개 URL로 변환
  const videoPath = path.join(mp.finalDir(epNum), `ep${epNum}_final.mp4`)
  if (!fs.existsSync(videoPath)) throw new Error(`패키징된 최종본이 없습니다: ${videoPath} — 먼저 ③결과물 패키징을 실행하세요`)
  const videoUrl = publicTunnelBase() + mp.toMediaUrl(videoPath)

  // ① 컨테이너 생성(REELS) — 캡션은 그대로 verbatim(해시태그 포함 문자열)
  const create = await gfetch(`${G}/${ig.userId}/media`, {
    method: 'POST',
    body: { media_type: 'REELS', video_url: videoUrl, caption: caption || '', access_token: token },
  })
  const creationId = create.id
  if (!creationId) throw new Error('컨테이너 생성 응답에 id가 없습니다')

  // ② 영상 처리 완료(FINISHED) 대기 — 최대 4분, 5초 간격. ERROR면 즉시 중단.
  const deadline = Date.now() + 4 * 60 * 1000
  let status = 'IN_PROGRESS'
  while (Date.now() < deadline) {
    const st = await gfetch(`${G}/${creationId}?fields=status_code&access_token=${token}`)
    status = st.status_code
    if (status === 'FINISHED') break
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`영상 처리 실패(${status}) — 컨테이너 ${creationId}`)
    await new Promise(r => setTimeout(r, 5000))
  }
  if (status !== 'FINISHED') throw new Error(`영상 처리 시간 초과(마지막 상태: ${status}) — 나중에 다시 시도하거나 인스타 앱에서 직접 확인하세요`)

  // ③ 실제 게시
  const publish = await gfetch(`${G}/${ig.userId}/media_publish`, {
    method: 'POST',
    body: { creation_id: creationId, access_token: token },
  })
  const mediaId = publish.id
  if (!mediaId) throw new Error('게시 응답에 id가 없습니다')

  // ④ 퍼머링크 조회(실패해도 게시 자체는 이미 성공이므로 무시)
  let permalink = null
  try { permalink = (await gfetch(`${G}/${mediaId}?fields=permalink&access_token=${token}`)).permalink || null } catch { /* noop */ }

  return { mediaId, permalink, videoUrl }
}
