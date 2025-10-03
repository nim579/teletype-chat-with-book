import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  envPrefix: 'APP_',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
