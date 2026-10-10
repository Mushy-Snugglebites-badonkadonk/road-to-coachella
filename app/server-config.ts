import { env } from "cloudflare:workers";
import { trackerConfig } from "./tracker-config";

export function getTrackerConfig() {
  return trackerConfig(env);
}

export function isEasterEggEnabled() {
  return env.EASTER_EGG_ENABLED === "true";
}

export function ownerDisplayName() {
  return String(env.OWNER_DISPLAY_NAME ?? "").trim().slice(0, 80) || "Owner";
}
