class VirtualizedChatList {
  constructor(container, options = {}) {
    this.container = container;
    this.itemHeight = options.itemHeight ?? 73;
    this.overscan = options.overscan ?? 5;

    this._items = [];
    this._rendered = [];
    this._scrollTop = 0;
    this._frameId = null;

    this._setupDOM();

    this._onScroll = this._onScroll.bind(this);
    this.container.addEventListener("scroll", this._onScroll, {
      passive: true,
    });
  }

  _setupDOM() {
    this.container.style.overflowY = "auto";
    this.container.style.position = "relative";

    this._phantom = document.createElement("div");
    this._phantom.style.cssText =
      "position:absolute;top:0;left:0;width:1px;pointer-events:none;";
    this.container.appendChild(this._phantom);

    this._listEl = document.createElement("div");
    this._listEl.style.cssText = "position:relative;width:100%;";
    this.container.appendChild(this._listEl);
  }

  setItems(items, keepScroll = false) {
    const top = keepScroll ? this.container.scrollTop : 0;
    this._items = items;
    this._clearRendered();

    this._phantom.style.height = items.length * this.itemHeight + "px";

    this.container.scrollTop = top;
    this._scrollTop = top;

    this._render();
  }

  clear() {
    this._items = [];
    this._clearRendered();
    this._phantom.style.height = "0";
    this._listEl.replaceChildren();
  }

  destroy() {
    this.container.removeEventListener("scroll", this._onScroll);

    if (this._frameId) {
      cancelAnimationFrame(this._frameId);
    }
  }

  _onScroll() {
    this._scrollTop = this.container.scrollTop;

    if (this._frameId) return;

    this._frameId = requestAnimationFrame(() => {
      this._frameId = null;
      this._render();
    });
  }

  _render() {
    const viewH = this.container.clientHeight;
    const scrollT = this._scrollTop;
    const total = this._items.length;

    if (total === 0) return;

    let startIdx = Math.floor(scrollT / this.itemHeight) - this.overscan;

    let endIdx = Math.ceil((scrollT + viewH) / this.itemHeight) + this.overscan;

    startIdx = Math.max(0, startIdx);
    endIdx = Math.min(total - 1, endIdx);

    this._rendered = this._rendered.filter(({ index, el }) => {
      if (index < startIdx || index > endIdx) {
        el.remove();
        return false;
      }

      return true;
    });

    const existingIndexes = new Set(this._rendered.map((r) => r.index));

    for (let i = startIdx; i <= endIdx; i++) {
      if (existingIndexes.has(i)) continue;

      const item = this._items[i];
      const el = item.render(item);

      el.style.position = "absolute";
      el.style.top = i * this.itemHeight + "px";
      el.style.left = "0";
      el.style.right = "0";
      el.style.height = this.itemHeight + "px";
      el.style.overflow = "hidden";

      this._listEl.appendChild(el);
      this._rendered.push({ index: i, el });
    }

    this._listEl.style.height = total * this.itemHeight + "px";
  }

  _clearRendered() {
    this._rendered.forEach(({ el }) => el.remove());
    this._rendered = [];
  }
}

// ---- DOM builders: every dynamic value goes through textContent / property
// ---- assignment, never through HTML parsing.
const ITEM_CLASS = "pp-item chat-item";

function buildAvatar(profilePic, alt, { ring = false, online = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = `pp-avatar${ring ? " pp-avatar--ring" : ""}`;
  const img = document.createElement("img");
  img.src = safeImageSrc(profilePic);
  img.alt = alt || "";
  img.loading = "lazy";
  wrap.appendChild(img);
  if (online) {
    const dot = document.createElement("span");
    dot.className = "pp-online-dot";
    wrap.appendChild(dot);
  }
  return wrap;
}

function buildTextBlock(title, subtitle) {
  const block = document.createElement("div");
  block.className = "pp-item-text";
  const titleEl = document.createElement("div");
  titleEl.className = "pp-item-title";
  titleEl.textContent = title;
  block.appendChild(titleEl);
  if (subtitle !== undefined) {
    const sub = document.createElement("div");
    sub.className = "pp-item-sub";
    sub.textContent = subtitle;
    block.appendChild(sub);
  }
  return block;
}

function makeChatItem(user, { t, openChat }) {
  return {
    type: "chat",
    data: user,

    render() {
      const el = document.createElement("div");
      el.className = ITEM_CLASS;
      el.dataset.userId = user.socketId;
      el.append(
        buildAvatar(user.profilePic, user.username, { online: true }),
        buildTextBlock(user.username, user.busy ? t("text-busy") : t("text-available")),
      );
      el.addEventListener("click", () => openChat(user));
      return el;
    },
  };
}

// A conversation kept in the encrypted local history; the person may be offline.
function makeSavedChatItem(peer, { t, openArchive }) {
  return {
    type: "saved-chat",
    data: peer,

    render() {
      const el = document.createElement("div");
      el.className = ITEM_CLASS;
      el.append(
        buildAvatar(null, peer.username),
        buildTextBlock(peer.username, t("saved_chat_sub")),
      );
      const clock = document.createElement("i");
      clock.className = "fas fa-clock-rotate-left pp-item-trail";
      clock.setAttribute("aria-hidden", "true");
      el.appendChild(clock);
      el.addEventListener("click", () => openArchive(peer));
      return el;
    },
  };
}

// Online people first, then saved conversations with people who are not online.
function buildChatItems(users, savedPeers) {
  return [
    ...users.map((u) => makeChatItem(u, { t, openChat })),
    ...savedPeers.map((p) => makeSavedChatItem(p, { t, openArchive })),
  ];
}

function makeStoryItem(storyData, { timeAgo, openStory }) {
  const { user, stories } = storyData;
  const latestStory = stories[stories.length - 1];

  return {
    type: "story",
    data: storyData,

    render() {
      const el = document.createElement("div");
      el.className = ITEM_CLASS;
      const mine = user.persistentUserId === state.myPersistentId;
      const restricted = mine && stories.some((s) => s.visibility === "selected");
      el.append(
        buildAvatar(user.profilePic, user.username, { ring: true }),
        buildTextBlock(
          mine ? `${user.username} (${t("you")})` : user.username,
          restricted ? `${timeAgo(latestStory.createdAt)} · ${t("story_vis_selected")}` : timeAgo(latestStory.createdAt),
        ),
      );
      el.addEventListener("click", () => openStory(user));
      return el;
    },
  };
}

// setting: { label, onClick, subtitle?, toggle?: boolean, danger?: boolean, iconClass?: "fa-copy", iconSrc?: "https://..." }
function makeSettingItem(setting) {
  return {
    type: "setting",
    data: setting,

    render() {
      const el = document.createElement("div");
      el.className = `${ITEM_CLASS}${setting.danger ? " pp-item--danger" : ""}`;
      el.setAttribute("role", typeof setting.toggle === "boolean" ? "switch" : "button");
      if (typeof setting.toggle === "boolean") el.setAttribute("aria-checked", String(setting.toggle));
      el.tabIndex = 0;

      const iconWrap = document.createElement("div");
      iconWrap.className = "pp-item-icon";
      if (setting.iconClass) {
        const icon = document.createElement("i");
        icon.className = `fas ${setting.iconClass}`;
        iconWrap.appendChild(icon);
      } else if (setting.iconSrc) {
        const img = document.createElement("img");
        img.src = setting.iconSrc;
        img.alt = "";
        iconWrap.appendChild(img);
      }

      el.append(iconWrap, buildTextBlock(setting.label, setting.subtitle));

      if (typeof setting.toggle === "boolean") {
        const sw = document.createElement("span");
        sw.className = `pp-switch${setting.toggle ? " is-on" : ""}`;
        el.appendChild(sw);
      }

      el.addEventListener("click", setting.onClick);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setting.onClick();
        }
      });
      return el;
    },
  };
}

function makeEmptyItem(message) {
  return {
    type: "empty",
    data: message,

    render() {
      const el = document.createElement("div");

      el.className = "pp-empty";

      el.style.height = "73px";
      el.textContent = message;

      return el;
    },
  };
}

function makeLoadingItem(message) {
  return {
    type: "loading",
    data: message,

    render() {
      const el = document.createElement("div");

      el.className = "pp-empty";

      el.textContent = message;

      return el;
    },
  };
}

function renderChatsList() {
  if (!window._vcl) return;

  if (!state.isConnected) {
    window._vcl.setItems([makeLoadingItem(t("connecting"))]);

    return;
  }

  const visibleUsers = state.allUsers.filter(
    (u) => u.socketId !== state.myId && !u.hidden,
  );
  const saved = offlineSavedPeers();

  if (!visibleUsers.length && !saved.length) {
    window._vcl.setItems([makeEmptyItem(getRandomMessage("renderNotEmpty"))]);

    return;
  }

  window._vcl.setItems(buildChatItems(visibleUsers, saved));
}

function renderStoriesList() {
  if (!window._vcl) return;

  if (!state.isConnected) {
    window._vcl.setItems([makeLoadingItem(t("connecting"))]);

    return;
  }

  const storyEntries = Object.values(state.currentStories).filter(
    (sd) => sd?.user && sd?.stories?.length,
  );

  if (!storyEntries.length) {
    window._vcl.setItems([makeEmptyItem(getRandomMessage("renderNotEmpty"))]);

    return;
  }

  window._vcl.setItems(
    storyEntries.map((sd) =>
      makeStoryItem(sd, { timeAgo, openStory }),
    ),
  );
}

function renderSettingsList(keepScroll = false) {
  if (!window._vcl) return;

  window._vcl.setItems(getSettingsItems().map((s) => makeSettingItem(s)), keepScroll);
}

function renderChatSearchResults(users, savedPeers = []) {
  if (!window._vcl) return;

  if (!users.length && !savedPeers.length) {
    window._vcl.setItems([makeEmptyItem(t("no_matching_users"))]);

    return;
  }

  window._vcl.setItems(buildChatItems(users, savedPeers));
}

function renderStorySearchResults(stories) {
  if (!window._vcl) return;

  if (!stories.length) {
    window._vcl.setItems([makeEmptyItem(t("no_matching_stories"))]);

    return;
  }

  window._vcl.setItems(
    stories.map((sd) =>
      makeStoryItem(sd, { timeAgo, openStory }),
    ),
  );
}

function renderSettingsSearchResults(filteredSettings) {
  if (!window._vcl) return;

  if (!filteredSettings.length) {
    window._vcl.setItems([makeEmptyItem(t("no_matching_settings"))]);

    return;
  }

  window._vcl.setItems(filteredSettings.map((s) => makeSettingItem(s)));
}

const LANGUAGE_ICONS = {
  az: "https://img.icons8.com/?size=96&id=pHfpq4E7vg9Y&format=png",
  tr: "https://img.icons8.com/?size=64&id=J6RJcdGoJomQ&format=png",
  en: "https://img.icons8.com/?size=96&id=fIgZUHgwc76e&format=png",
  ru: "https://img.icons8.com/?size=96&id=vioRCshpCBKv&format=png",
};

function changeLanguage() {
  if (!window._vcl) return;

  const langs = availableLanguages().map(({ code, name }) => ({
    iconSrc: LANGUAGE_ICONS[code],
    label: name,
    onClick: () => {
      setLanguage(code);
      changeLanguage();
    },
  }));

  window._vcl.setItems(langs.map((s) => makeSettingItem(s)));
}
