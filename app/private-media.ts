import faceDataUrl from "../private/easter_egg.jpg?inline";
import audioDataUrl from "../private/easter_egg.m4a?inline";
import { getChatGPTUser } from "./chatgpt-auth";
import { hasSiteAccess } from "./access";
import { isEasterEggEnabled } from "./server-config";
import { isOwner } from "./authorization";

export async function privateEasterEggImage(request: Request) {
  return privateMediaResponse(request, faceDataUrl, "image/jpeg");
}

export async function privateEasterEggAudio(request: Request) {
  return privateMediaResponse(request, audioDataUrl, "audio/mp4");
}

async function privateMediaResponse(request: Request, dataUrl: string, contentType: string) {
  if (!isEasterEggEnabled()) return notFound();
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return notFound();
  const user = await getChatGPTUser();
  if (!user || (!isOwner(user.email) && !await hasSiteAccess(user.email))) return notFound();

  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": contentType,
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}
