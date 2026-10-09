import type { Server } from "socket.io";
import type { PresenceService } from "../../application/presenceService.js";
import type { StoryService } from "../../application/storyService.js";

export const AUTHED_ROOM = "authed";

/**
 * Coalesces bursts of changes into one broadcast (O(n) per burst instead of
 * O(n) per change) and only reaches authenticated sockets.
 */
export class Broadcaster {
  private presenceTimer: NodeJS.Timeout | null = null;
  private storiesTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly io: Server,
    private readonly presence: PresenceService,
    private readonly stories: StoryService,
  ) {}

  presenceChanged(): void {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.io.to(AUTHED_ROOM).emit("online-users", this.presence.listVisible());
    }, 100);
  }

  storiesChanged(): void {
    if (this.storiesTimer) return;
    this.storiesTimer = setTimeout(() => {
      this.storiesTimer = null;
      this.emitStories();
    }, 250);
  }

  /**
   * Feeds only differ per viewer while some story is limited to an audience;
   * otherwise one shared payload is enough.
   */
  private emitStories(): void {
    if (!this.stories.hasRestricted()) {
      this.io.to(AUTHED_ROOM).emit("stories-updated", this.stories.feed(""));
      return;
    }
    for (const user of this.presence.allOnline()) {
      this.io.to(user.socketId).emit("stories-updated", this.stories.feed(user.persistentUserId));
    }
  }

  stop(): void {
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (this.storiesTimer) clearTimeout(this.storiesTimer);
  }
}
