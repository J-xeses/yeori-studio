// planSegmentTTS(proxy.js) + 핸들러 루프의 세그 호출 로직 스텁 검증 (ElevenLabs/ffmpeg 없이)
import fs from 'fs'
import { splitDialogueBySeg, SEG_UNITS, computeSegmentPlans } from '../src/lib/vpDialogue.js'
import { splitSpeakerSegments } from '../server/lib/ttsText.js'
const src = fs.readFileSync(new URL('../server/proxy.js', import.meta.url), 'utf-8')
const fn = src.match(/function planSegmentTTS[\s\S]*?\n}\n/)[0]
const planSegmentTTS = new Function('SEG_UNITS', 'splitDialogueBySeg', 'splitSpeakerSegments', fn + '; return planSegmentTTS')(SEG_UNITS, splitDialogueBySeg, splitSpeakerSegments)

const calls = []
const tts = async (voice, text) => { calls.push({ voice, text }) }
async function run(cut, raw) {
  calls.length = 0
  const sl = planSegmentTTS(cut, raw)
  if (!sl) { for (const sg of splitSpeakerSegments(raw)) await tts(sg.speaker, sg.text); return { sl, calls: [...calls] } }
  for (const s of sl) for (const sg of s.segs) await tts(sg.speaker, sg.text)
  return { sl, calls: [...calls] }
}
const raw = '지아 "오늘은 정말 길게 말할 거야, 잘 들어봐. 첫째는 시작이야." / 여리 "그래서 둘째는 뭔데? 빨리 말해줘!" / 지아 "셋째는 마무리야. 끝까지 해보자."'
const plan = computeSegmentPlans(26)[0]; console.log('plan', plan.combo.join('+'))
let r = await run({ duration: 26, segments: plan.combo }, raw)
console.log('segmented calls:', r.calls.length, 'slices:', r.sl.length)
r.sl.forEach(s => console.log(' s'+s.k, JSON.stringify(s.segs)))
const joined = r.calls.map(c => c.text).join(' ')
const whole = splitSpeakerSegments(raw).map(s => s.text).join(' ')
console.log('order/no-overlap/no-loss:', joined.replace(/\s/g,'') === whole.replace(/\s/g,''))
r = await run({ duration: 8 }, raw); console.log('no segments ->', r.sl, 'calls', r.calls.length, '(old single-path:', splitSpeakerSegments(raw).length, ')')
r = await run({ duration: 8, segments: [8] }, raw); console.log('segments length1 ->', r.sl)
r = await run({ duration: 20, segments: [10,10] }, '지아 "하나, 둘." || 여리 "셋, 넷."'); console.log('|| manual:', JSON.stringify(r.sl))
