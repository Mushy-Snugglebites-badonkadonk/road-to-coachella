import { ownerDisplayName, isEasterEggEnabled } from "./server-config";
import { Tracker } from "./tracker";
import { getChatGPTUser } from "./chatgpt-auth";
import { isOwner } from "./authorization";
import { hasSiteAccess } from "./access";
import { InviteGate } from "./invite-gate";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) return <InviteGate />;
  const owner = isOwner(user.email);
  if (!owner && !await hasSiteAccess(user.email)) {
    return <InviteGate displayName={user.displayName} ownerName={ownerDisplayName()} />;
  }
  return <Tracker easterEggEnabled={isEasterEggEnabled()} currentUser={{ displayName: owner ? ownerDisplayName() : user.displayName, isOwner: owner }} />;
}
