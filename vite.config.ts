import vinext from "vinext";
import { defineConfig, type ViteDevServer } from "vite";
import { sites } from "./build/sites-vite-plugin";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "127.0.0.1",
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      {
        name: "local-development-identity",
        enforce: "pre" as const,
        configureServer(server: ViteDevServer) {
          // configureServer only runs for development, never in the built Worker.
          server.middlewares.use((request, _response, next) => {
            const remote = request.socket.remoteAddress;
            if (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") {
              const identity = {
                "oai-authenticated-user-id": "local-dev",
                "oai-authenticated-user-email": "local@example.test",
              };
              // The Worker adapter reads rawHeaders, while Vite reads headers.
              for (const [name, value] of Object.entries(identity)) {
                request.headers[name] = value;
                for (let i = request.rawHeaders.length - 2; i >= 0; i -= 2) {
                  if (request.rawHeaders[i].toLowerCase() === name) request.rawHeaders.splice(i, 2);
                }
                request.rawHeaders.push(name, value);
              }
            }
            next();
          });
        },
      },
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        configPath: "./wrangler.jsonc",
      }),
    ],
  };
});
