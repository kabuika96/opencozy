import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(frontendDir, "..");

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, projectRoot, "") };
  const backendPort = Number(env.LITEHARNESS_BACKEND_PORT ?? 8787);
  const frontendHost = env.LITEHARNESS_FRONTEND_HOST ?? "127.0.0.1";
  const frontendPort = Number(env.LITEHARNESS_FRONTEND_PORT ?? 5173);
  const allowedHosts = Array.from(new Set([
    "localhost",
    "127.0.0.1",
    ...readHostList(env.LITEHARNESS_ALLOWED_HOSTS),
    ...readHostList(env.LITEHARNESS_TAILSCALE_HOST),
  ]));

  return {
    plugins: [react()],
    // Prebundle the lazy PDF reader so first opening it does not trigger a dev reload.
    optimizeDeps: { include: ["pdfjs-dist/legacy/build/pdf.mjs"] },
    server: {
      allowedHosts,
      host: frontendHost,
      port: frontendPort,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${backendPort}`,
          ws: true,
        },
        "/ws": {
          target: `http://127.0.0.1:${backendPort}`,
          ws: true,
        },
      },
      strictPort: true,
    },
  };
});

function readHostList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}
