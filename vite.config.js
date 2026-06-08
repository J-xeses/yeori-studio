import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // /api/claude/v1/messages  →  https://api.anthropic.com/v1/messages
      '/api/claude': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/claude/, ''),
        configure: proxy => {
          proxy.on('proxyReq', proxyReq => {
            // Anthropic은 Origin/Referer 헤더가 있으면 브라우저 직접 호출로 판단해 차단.
            // 프록시 요청에서는 두 헤더를 제거해 서버-to-서버 요청처럼 보이게 함.
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
          proxy.on('error', err =>
            console.error('[proxy:claude]', err.message)
          )
        },
      },

      // /api/elevenlabs/user              →  https://api.elevenlabs.io/v1/user
      // /api/elevenlabs/text-to-speech/*  →  https://api.elevenlabs.io/v1/text-to-speech/*
      // /api/ffmpeg → 로컬 프록시 서버 (FFmpeg 실행)
      '/api/ffmpeg': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },

      '/api/elevenlabs': {
        target: 'https://api.elevenlabs.io',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/elevenlabs/, '/v1'),
        configure: proxy => {
          proxy.on('proxyReq', proxyReq => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
          proxy.on('error', err =>
            console.error('[proxy:elevenlabs]', err.message)
          )
        },
      },
    },
  },
})
