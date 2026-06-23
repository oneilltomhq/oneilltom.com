import { defineConfig } from 'vite';

// Vite resolves bare `three` imports from node_modules, gives HMR while
// tweaking shaders, and ships plain readable ES modules — minification is off
// on purpose so the deployed source stays inspectable.
export default defineConfig({
	build: {
		target: 'esnext', // top-level await in the inline page modules
		minify: false,
	},
});
