import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(frontendDir, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const backendPort = env.OPENCOZY_PORT || process.env.OPENCOZY_PORT || "8788";
  const frontendPort = Number(env.OPENCOZY_FRONTEND_PORT || process.env.OPENCOZY_FRONTEND_PORT || "5175");
  const allowedHosts = (env.OPENCOZY_ALLOWED_HOSTS || process.env.OPENCOZY_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: frontendPort,
      strictPort: true,
      ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
