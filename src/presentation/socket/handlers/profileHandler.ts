import type { RegisterOn, SocketContext } from "../guard.js";
import { parseHidden, parseProfilePic } from "../validators.js";
import type { HandlerDeps } from "./types.js";

export function registerProfileHandlers(ctx: SocketContext, on: RegisterOn, deps: HandlerDeps): void {
  const { socket } = ctx;

  on("update-visibility", { auth: true, bucket: "misc" }, async (payload) => {
    const hidden = parseHidden(payload);
    if (hidden === null || !ctx.account) return;

    await deps.users.updateHidden(ctx.account.accountId, hidden);
    deps.presence.setHidden(socket.id, hidden);
    deps.broadcaster.presenceChanged();
  });

  on("update-profile-pic", { auth: true, bucket: "profile" }, async (payload) => {
    // Only real raster images as data: URLs. An arbitrary string here would be
    // rendered as <img src> in every other user's browser (tracking pixels,
    // IP leaks) and stored in the database.
    const pic = parseProfilePic(payload);
    const user = deps.presence.get(socket.id);
    if (!pic || !user || !ctx.account) return;

    await deps.users.updateProfilePic(ctx.account.accountId, pic);
    deps.presence.setProfilePic(socket.id, pic);
    deps.stories.updateOwner(ctx.account.persistentUserId, { username: user.username, profilePic: pic });
    deps.broadcaster.presenceChanged();
    deps.broadcaster.storiesChanged();
  });

  on("ping", { auth: false, bucket: "misc" }, () => {
    socket.emit("pong");
  });
}
