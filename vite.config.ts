import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the React website from src/web and the Worker from src/worker in one pass.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
