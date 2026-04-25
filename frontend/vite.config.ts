import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const backendPort = Number(env.BACKEND_PORT) || 8000;
	const frontendPort = Number(env.FRONTEND_PORT) || 5173;

	return {
		plugins: [react()],
		server: {
			port: frontendPort,
			proxy: {
				"/api": {
					target: `http://localhost:${backendPort}`,
					changeOrigin: true,
					ws: true,
				},
			},
		},
	};
});
