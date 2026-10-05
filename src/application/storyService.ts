import crypto from "node:crypto";
import { LIMITS, STORY_EXPIRY } from "../config/constants.js";
import type { Clock } from "./ports.js";

interface StoryRecord {
  id: string;
  data: string;
  caption: string;
  createdAt: number;
  viewers: Set<string>;
}

interface OwnerProfile {
  username: string;
  profilePic: string | null;
}

/** Story metadata as broadcast to everybody. Image bytes are fetched on demand. */
export interface StoryView {
  id: string;
  type: "image";
  caption: string;
  createdAt: number;
  viewersCount: number;
}

export interface StoryFeed {
  [persistentUserId: string]: {
    stories: StoryView[];
    user: { username: string; profilePic: string | null; persistentUserId: string };
  };
}

export class StoryService {
  private readonly stories = new Map<string, StoryRecord[]>();
  private readonly owners = new Map<string, OwnerProfile>();

  constructor(
    private readonly now: Clock = Date.now,
    private readonly expiryMs = STORY_EXPIRY,
    private readonly maxPerUser: number = LIMITS.maxStoriesPerUser,
  ) {}

  private active(ownerId: string): StoryRecord[] {
    const cutoff = this.now() - this.expiryMs;
    return (this.stories.get(ownerId) ?? []).filter((s) => s.createdAt > cutoff);
  }

  /** Returns null when the per-user limit is reached. */
  add(ownerId: string, owner: OwnerProfile, data: string, caption = ""): StoryView | null {
    const current = this.active(ownerId);
    if (current.length >= this.maxPerUser) return null;

    const story: StoryRecord = {
      id: crypto.randomUUID(),
      data,
      caption: caption.slice(0, LIMITS.maxCaptionChars),
      createdAt: this.now(),
      viewers: new Set(),
    };
    this.stories.set(ownerId, [...current, story]);
    this.owners.set(ownerId, owner);
    return this.toView(story);
  }

  updateOwner(ownerId: string, owner: OwnerProfile): void {
    if (this.owners.has(ownerId)) this.owners.set(ownerId, owner);
  }

  remove(ownerId: string, storyId: string): boolean {
    const current = this.active(ownerId);
    const next = current.filter((s) => s.id !== storyId);
    if (next.length === current.length) return false;
    if (next.length) this.stories.set(ownerId, next);
    else this.dropOwner(ownerId);
    return true;
  }

  markViewed(ownerId: string, storyId: string, viewerId: string): boolean {
    const story = this.active(ownerId).find((s) => s.id === storyId);
    if (!story) return false;
    story.viewers.add(viewerId);
    return true;
  }

  getData(ownerId: string, storyId: string): string | null {
    return this.active(ownerId).find((s) => s.id === storyId)?.data ?? null;
  }

  feed(): StoryFeed {
    const feed: StoryFeed = {};
    for (const ownerId of this.stories.keys()) {
      const stories = this.active(ownerId);
      const owner = this.owners.get(ownerId);
      if (!stories.length || !owner) continue;
      feed[ownerId] = {
        stories: stories.map((s) => this.toView(s)),
        user: { username: owner.username, profilePic: owner.profilePic, persistentUserId: ownerId },
      };
    }
    return feed;
  }

  /** Returns true when something expired (so a refreshed feed should be sent). */
  purgeExpired(): boolean {
    let changed = false;
    for (const ownerId of Array.from(this.stories.keys())) {
      const before = this.stories.get(ownerId)?.length ?? 0;
      const live = this.active(ownerId);
      if (live.length === before) continue;
      changed = true;
      if (live.length) this.stories.set(ownerId, live);
      else this.dropOwner(ownerId);
    }
    return changed;
  }

  private dropOwner(ownerId: string): void {
    this.stories.delete(ownerId);
    this.owners.delete(ownerId);
  }

  private toView(story: StoryRecord): StoryView {
    return {
      id: story.id,
      type: "image",
      caption: story.caption,
      createdAt: story.createdAt,
      viewersCount: story.viewers.size,
    };
  }
}
