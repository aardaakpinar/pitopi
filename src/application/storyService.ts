import crypto from "node:crypto";
import { LIMITS, STORY_EXPIRY } from "../config/constants.js";
import type { Clock } from "./ports.js";

export type StoryVisibility = "everyone" | "selected";

interface StoryRecord {
  id: string;
  data: string;
  caption: string;
  createdAt: number;
  viewers: Set<string>;
  visibility: StoryVisibility;
  /** Persistent ids that may view a "selected" story. Never sent to clients. */
  audience: Set<string>;
}

interface OwnerProfile {
  username: string;
  profilePic: string | null;
}

export interface AddStoryOptions {
  caption?: string;
  visibility?: StoryVisibility;
  audience?: readonly string[];
}

/** Story metadata as broadcast to viewers. Image bytes are fetched on demand. */
export interface StoryView {
  id: string;
  type: "image";
  caption: string;
  createdAt: number;
  viewersCount: number;
  /** Only present for the owner's own stories. */
  visibility?: StoryVisibility;
  audienceCount?: number;
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

  /** A story is visible to its owner, to everyone ("everyone"), or to its audience ("selected"). */
  private canSee(story: StoryRecord, ownerId: string, viewerId: string): boolean {
    if (viewerId === ownerId) return true;
    return story.visibility === "everyone" || story.audience.has(viewerId);
  }

  /** True when at least one active story is limited to an audience (feeds then differ per viewer). */
  hasRestricted(): boolean {
    for (const ownerId of this.stories.keys()) {
      if (this.active(ownerId).some((s) => s.visibility === "selected")) return true;
    }
    return false;
  }

  /** Returns null when the per-user limit is reached. */
  add(ownerId: string, owner: OwnerProfile, data: string, options: AddStoryOptions = {}): StoryView | null {
    const current = this.active(ownerId);
    if (current.length >= this.maxPerUser) return null;

    const visibility = options.visibility ?? "everyone";
    const story: StoryRecord = {
      id: crypto.randomUUID(),
      data,
      caption: (options.caption ?? "").slice(0, LIMITS.maxCaptionChars),
      createdAt: this.now(),
      viewers: new Set(),
      visibility,
      // The owner is never part of their own audience list.
      audience: new Set(visibility === "selected" ? (options.audience ?? []).filter((id) => id !== ownerId) : []),
    };
    this.stories.set(ownerId, [...current, story]);
    this.owners.set(ownerId, owner);
    return this.toView(story, true);
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
    if (!story || !this.canSee(story, ownerId, viewerId)) return false;
    // The owner opening their own story is not a "view".
    if (viewerId !== ownerId) story.viewers.add(viewerId);
    return true;
  }

  getData(ownerId: string, storyId: string, viewerId: string): string | null {
    const story = this.active(ownerId).find((s) => s.id === storyId);
    return story && this.canSee(story, ownerId, viewerId) ? story.data : null;
  }

  /** The feed as `viewerId` is allowed to see it. */
  feed(viewerId: string): StoryFeed {
    const feed: StoryFeed = {};
    for (const ownerId of this.stories.keys()) {
      const stories = this.active(ownerId).filter((s) => this.canSee(s, ownerId, viewerId));
      const owner = this.owners.get(ownerId);
      if (!stories.length || !owner) continue;
      feed[ownerId] = {
        stories: stories.map((s) => this.toView(s, ownerId === viewerId)),
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

  private toView(story: StoryRecord, forOwner: boolean): StoryView {
    const view: StoryView = {
      id: story.id,
      type: "image",
      caption: story.caption,
      createdAt: story.createdAt,
      viewersCount: story.viewers.size,
    };
    if (forOwner) {
      view.visibility = story.visibility;
      view.audienceCount = story.audience.size;
    }
    return view;
  }
}
