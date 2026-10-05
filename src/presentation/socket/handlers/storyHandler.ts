import type { RegisterOn, SocketContext } from "../guard.js";
import { parseStoryDelete, parseStoryRef, parseStoryUpload } from "../validators.js";
import type { HandlerDeps } from "./types.js";

export function registerStoryHandlers(ctx: SocketContext, on: RegisterOn, deps: HandlerDeps): void {
  const { socket } = ctx;
  const { stories, presence } = deps;

  on("upload-story", { auth: true, bucket: "story" }, (payload, ack) => {
    const upload = parseStoryUpload(payload);
    const user = presence.get(socket.id);
    if (!upload || !user || !ctx.account) {
      ack?.({ ok: false });
      return;
    }

    const view = stories.add(
      ctx.account.persistentUserId,
      { username: user.username, profilePic: user.profilePic },
      upload.data,
      upload.caption,
    );
    if (!view) {
      ack?.({ ok: false, reason: "limit" });
      return;
    }

    deps.audit.log("STORY_UPLOADED", { persistentUserId: ctx.account.persistentUserId });
    deps.broadcaster.storiesChanged();
    ack?.({ ok: true });
  });

  on("story-viewed", { auth: true, bucket: "storyRead" }, (payload) => {
    const ref = parseStoryRef(payload);
    if (!ref || !ctx.account) return;
    if (stories.markViewed(ref.persistentUserId, ref.storyId, ctx.account.persistentUserId)) {
      deps.audit.log("STORY_VIEWED", {
        storyId: ref.storyId,
        owner: ref.persistentUserId,
        viewer: ctx.account.persistentUserId,
      });
    }
  });

  // Image bytes are not part of the broadcast feed; clients fetch them on demand.
  on("get-story", { auth: true, bucket: "storyRead" }, (payload, ack) => {
    const ref = parseStoryRef(payload);
    const data = ref ? stories.getData(ref.persistentUserId, ref.storyId) : null;
    ack?.(data ? { ok: true, data } : { ok: false });
  });

  on("delete-story", { auth: true, bucket: "misc" }, (payload) => {
    const ref = parseStoryDelete(payload);
    if (!ref || !ctx.account) return;
    // Ownership is implicit: the lookup is scoped to the caller's own stories.
    if (stories.remove(ctx.account.persistentUserId, ref.storyId)) {
      deps.audit.log("STORY_DELETED", { storyId: ref.storyId, persistentUserId: ctx.account.persistentUserId });
      deps.broadcaster.storiesChanged();
    }
  });
}
