import { glossParts } from '../lib/codeRef'

// 코드 입력칸 바로 아래에 붙는 한글 풀이 한 줄 — 예: SH_MCU(미디엄 클로즈업) → SH_CU(클로즈업).
// 코드북에 없는 코드는 "(?)" + 주황색. 표시 전용이라 저장값은 그대로다.
export default function CodeGloss({ cb, kind, value, sep = ' · ' }) {
  const parts = glossParts(cb, kind, value)
  if (!parts.length) return null
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)', marginTop: 2 }}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && sep}
          <span style={p.warn ? { color: '#f59e0b' } : undefined} title={p.warn ? '레퍼런스(코드북)에 없는 코드' : undefined}>{p.text}</span>
        </span>
      ))}
    </div>
  )
}
