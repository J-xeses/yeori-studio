// Windows 게임 바(Xbox Game Bar) 녹화 — Win+Alt+R 토글.
// 포커스된 창을 녹화하고 결과 mp4를 %USERPROFILE%\Videos\Captures\ 에 저장한다.
// 장점: 설정 0, GPU 인코딩. 단점: 시작/종료 타이밍 부정확(핫키+UI 지연), 파일명 예측 불가
// (저장 후 최신 파일을 outPath로 이동). 게임 바 활성화(설정 > 게임 > Xbox Game Bar) 필요.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Recorder } from './base.js'

const CAPTURES = path.join(os.homedir(), 'Videos', 'Captures')

function sendHotkey() {
  // PowerShell SendKeys 로 Win+Alt+R. (Win 단독은 SendKeys로 못 보내 nircmd/AHK가 더 확실하지만
  // 의존성 없이 가려면 이 방법. 안 먹으면 nircmd 경로를 opts로 받게 확장.)
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%^{r}')`
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', ps])
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('SendKeys 실패'))))
  })
}

export class GameBarRecorder extends Recorder {
  async start(outPath, _spec = {}) {
    this.outPath = outPath
    this._before = new Set(fs.existsSync(CAPTURES) ? fs.readdirSync(CAPTURES) : [])
    this.log('GameBar: Win+Alt+R (시작)')
    await sendHotkey()
    await new Promise((r) => setTimeout(r, 1500))   // 녹화 시작 UI 지연
  }

  async stop() {
    this.log('GameBar: Win+Alt+R (종료)')
    await sendHotkey()
    // 파일 flush 대기 후 새로 생긴 mp4를 outPath로 이동
    await new Promise((r) => setTimeout(r, 3000))
    const now = fs.existsSync(CAPTURES) ? fs.readdirSync(CAPTURES) : []
    const fresh = now.filter((f) => !this._before.has(f) && /\.mp4$/i.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(CAPTURES, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    if (!fresh.length) { this.log('⚠ GameBar 결과 파일을 못 찾음'); return }
    fs.mkdirSync(path.dirname(this.outPath), { recursive: true })
    fs.renameSync(path.join(CAPTURES, fresh[0].f), this.outPath)
    this.log(`GameBar 결과 → ${this.outPath}`)
  }
}
