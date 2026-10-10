import { env } from "cloudflare:workers";

type RuntimeEnv = typeof env & { OWNER_EMAIL?: string };

export function isOwner(email: string) {
  const ownerEmail = String((env as RuntimeEnv).OWNER_EMAIL ?? "").trim().toLowerCase();
  return Boolean(ownerEmail) && email.trim().toLowerCase() === ownerEmail;
}
