import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/FinanceStock/', // replace 'consolidate' with your repo name
  plugins: [react()],
})