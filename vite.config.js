import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages phục vụ project site tại /<tên-repo>/.
// Đổi 'kpi-review' thành tên repo GitHub thực tế của bạn nếu khác.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/kpi-review/',
})
