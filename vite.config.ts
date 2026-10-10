import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  name: "road-to-coachella",
  main: "./worker/index.ts",
  compatibility_date: "2026-07-21",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "road-to-coachella-local",
          migrations_dir: "./drizzle",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  // Local-only explicit Worker bindings: Vite's process environment alone is
  // not cloudflare:workers env. Never serialize local secrets into a build.
  const localEnv = command === "serve" ? loadEnv(mode, process.cwd(), "") : {};
  const keys = ["OWNER_EMAIL", "OWNER_DISPLAY_NAME", "INVITE_CODE_SECRET", "TRACKER_TOTAL_CENTS", "TRACKER_INSTALLMENT_CENTS", "TRACKER_ANCHOR_DATE", "SITE_URL", "EASTER_EGG_ENABLED"];
  const vars = Object.fromEntries(keys.filter((key) => localEnv[key] !== undefined).map((key) => [key, localEnv[key]]));
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
      watch: isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : undefined,
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: { ...localBindingConfig, vars },
      }),
    ],
  };
});
