import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** `@/` names the website's own source, as the shadcn components import it. */
export const webAlias = { '@': fileURLToPath(new URL('./src/web', import.meta.url)) };

// Builds the React website from src/web and the Worker from src/worker in one pass.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias: webAlias },
});
