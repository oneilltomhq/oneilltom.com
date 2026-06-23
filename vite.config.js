import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		target: 'esnext',
		minify: false,
		rollupOptions: {
			input: {
				main: resolve(import.meta.dirname, 'index.html'),
				smoke: resolve(import.meta.dirname, 'lib3-smoke.html'),
			},
		},
	},
});
