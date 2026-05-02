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
        this.container.addEventListener('scroll', this._onScroll, { passive: true });
    }

    _setupDOM() {
        this.container.style.overflowY = 'auto';
        this.container.style.position = 'relative';

        this._phantom = document.createElement('div');
        this._phantom.style.cssText =
            'position:absolute;top:0;left:0;width:1px;pointer-events:none;';
        this.container.appendChild(this._phantom);

        this._listEl = document.createElement('div');
        this._listEl.style.cssText = 'position:relative;width:100%;';
        this.container.appendChild(this._listEl);
    }

    setItems(items) {
        this._items = items;
        this._clearRendered();

        this._phantom.style.height =
            items.length * this.itemHeight + 'px';

        this.container.scrollTop = 0;
        this._scrollTop = 0;

        this._render();
    }

    clear() {
        this._items = [];
        this._clearRendered();
        this._phantom.style.height = '0';
        this._listEl.innerHTML = '';
    }

    destroy() {
        this.container.removeEventListener('scroll', this._onScroll);

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

        let startIdx =
            Math.floor(scrollT / this.itemHeight) - this.overscan;

        let endIdx =
            Math.ceil((scrollT + viewH) / this.itemHeight) + this.overscan;

        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(total - 1, endIdx);

        this._rendered = this._rendered.filter(({ index, el }) => {
            if (index < startIdx || index > endIdx) {
                el.remove();
                return false;
            }

            return true;
        });

        const existingIndexes = new Set(
            this._rendered.map(r => r.index)
        );

        for (let i = startIdx; i <= endIdx; i++) {
            if (existingIndexes.has(i)) continue;

            const item = this._items[i];
            const el = item.render(item);

            el.style.position = 'absolute';
            el.style.top = i * this.itemHeight + 'px';
            el.style.left = '0';
            el.style.right = '0';
            el.style.height = this.itemHeight + 'px';
            el.style.overflow = 'hidden';

            this._listEl.appendChild(el);
            this._rendered.push({ index: i, el });
        }

        this._listEl.style.height =
            total * this.itemHeight + 'px';
    }

    _clearRendered() {
        this._rendered.forEach(({ el }) => el.remove());
        this._rendered = [];
    }
}

function makeChatItem(user, { t, openChat, DEFAULT_PROFILE_PIC }) {
    return {
        type: 'chat',
        data: user,

        render() {
            const el = document.createElement('div');

            el.className =
                'flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800 ' +
                'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer chat-item';

            el.dataset.userId = user.socketId;

            const statusText = user.busy
                ? t('text-busy')
                : t('text-available');

            el.innerHTML = `
                <div class="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium shrink-0">
                    <img
                        src="${user.profilePic || DEFAULT_PROFILE_PIC}"
                        alt="${escapeHtml(user.username)}"
                        class="w-full h-full rounded-full object-cover"
                        loading="lazy"
                    >
                </div>

                <div class="ml-3 flex-1 min-w-0">
                    <div class="flex justify-between">
                        <div class="font-medium truncate text-black dark:text-white">
                            ${escapeHtml(user.username)}
                        </div>
                    </div>

                    <div class="text-sm text-gray-500 truncate">
                        ${escapeHtml(statusText)}
                    </div>
                </div>
            `;

            el.addEventListener('click', () => openChat(user));

            return el;
        }
    };
}

function makeStoryItem(storyData, {
    timeAgo,
    openStory,
    DEFAULT_PROFILE_PIC
}) {
    const { user, stories } = storyData;
    const latestStory = stories[stories.length - 1];

    return {
        type: 'story',
        data: storyData,

        render() {
            const el = document.createElement('div');

            el.className =
                'flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800 ' +
                'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer chat-item';

            el.innerHTML = `
                <div class="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium shrink-0">
                    <img
                        src="${user.profilePic || DEFAULT_PROFILE_PIC}"
                        alt="${escapeHtml(user.username)}"
                        class="w-full h-full rounded-full object-cover"
                        loading="lazy"
                    >
                </div>

                <div class="ml-3 flex-1 min-w-0">
                    <div class="font-medium truncate text-black dark:text-white">
                        ${escapeHtml(user.username)}
                    </div>

                    <div class="text-sm text-gray-500 truncate">
                        ${timeAgo(latestStory.createdAt)}
                    </div>
                </div>
            `;

            el.addEventListener('click', () => openStory(user));

            return el;
        }
    };
}

function makeSettingItem(setting) {
    return {
        type: 'setting',
        data: setting,

        render() {
            const el = document.createElement('div');

            el.className =
                'flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800 ' +
                'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer chat-item';

            el.innerHTML = `
                <div class="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center text-lg shrink-0">
                    ${setting.icon}
                </div>

                <div class="ml-3 flex-1 min-w-0">
                    <div class="font-medium truncate text-black dark:text-white">
                        ${setting.label}
                    </div>
                </div>
            `;

            el.onclick = setting.onClick;

            return el;
        }
    };
}

function makeEmptyItem(message) {
    return {
        type: 'empty',
        data: message,

        render() {
            const el = document.createElement('div');

            el.className =
                'flex items-center justify-center py-10 text-gray-500 dark:text-gray-400 text-sm';

            el.style.height = '73px';
            el.textContent = message;

            return el;
        }
    };
}

function makeLoadingItem(message) {
    return {
        type: 'loading',
        data: message,

        render() {
            const el = document.createElement('div');

            el.className =
                'flex items-center justify-center py-10 text-gray-500 text-sm';

            el.textContent = message;

            return el;
        }
    };
}

function renderChatsList() {
    if (!window._vcl) return;

    if (!state.isConnected) {
        window._vcl.setItems([
            makeLoadingItem(t('connecting'))
        ]);

        return;
    }

    const visibleUsers = state.allUsers.filter(
        u => u.socketId !== state.myId && !u.hidden
    );

    if (!visibleUsers.length) {
        window._vcl.setItems([
            makeEmptyItem(getRandomMessage('renderNotEmpty'))
        ]);

        return;
    }

    window._vcl.setItems(
        visibleUsers.map(u =>
            makeChatItem(u, {
                t,
                openChat,
                DEFAULT_PROFILE_PIC
            })
        )
    );
}

function renderStoriesList() {
    if (!window._vcl) return;

    if (!state.isConnected) {
        window._vcl.setItems([
            makeLoadingItem(t('connecting'))
        ]);

        return;
    }

    const storyEntries = Object.values(state.currentStories)
        .filter(sd => sd?.user && sd?.stories?.length);

    if (!storyEntries.length) {
        window._vcl.setItems([
            makeEmptyItem(getRandomMessage('renderNotEmpty'))
        ]);

        return;
    }

    window._vcl.setItems(
        storyEntries.map(sd =>
            makeStoryItem(sd, {
                timeAgo,
                openStory,
                DEFAULT_PROFILE_PIC
            })
        )
    );
}

function renderSettingsList() {
    if (!window._vcl) return;

    const settings = [
        {
            icon: `<i class="fas fa-copy"></i>`,
            label: t('copy_id'),
            onClick: () => {
                navigator.clipboard.writeText(state.myId);
                showToast(t('copied_id'));
            }
        },

        {
            icon: `<i class="fas fa-camera"></i>`,
            label: t('upload_photo'),
            onClick: () =>
                document
                    .getElementById('uploadAvatarInput')
                    ?.click()
        },

        {
            icon: `<i class="fas fa-user-secret"></i>`,
            label: state.hiddenFromSearch
                ? t('hidden_from_search')
                : t('visible_in_search'),

            onClick: () => toggleSearchVisibility()
        },

        {
            icon: `<i class="fas fa-globe"></i>`,
            label: t('select_language'),
            onClick: () => changeLanguage()
        },

        {
            icon: `<i class="fas fa-sign-out-alt"></i>`,
            label: t('log_out'),
            onClick: () => logoutUser()
        }
    ];

    window._vcl.setItems(
        settings.map(s => makeSettingItem(s))
    );
}

function renderChatSearchResults(users) {
    if (!window._vcl) return;

    if (!users.length) {
        window._vcl.setItems([
            makeEmptyItem('No matching users found.')
        ]);

        return;
    }

    window._vcl.setItems(
        users.map(u =>
            makeChatItem(u, {
                t,
                openChat,
                DEFAULT_PROFILE_PIC
            })
        )
    );
}

function renderStorySearchResults(stories) {
    if (!window._vcl) return;

    if (!stories.length) {
        window._vcl.setItems([
            makeEmptyItem('No matching stories found.')
        ]);

        return;
    }

    window._vcl.setItems(
        stories.map(sd =>
            makeStoryItem(sd, {
                timeAgo,
                openStory,
                DEFAULT_PROFILE_PIC
            })
        )
    );
}

function renderSettingsSearchResults(filteredSettings) {
    if (!window._vcl) return;

    if (!filteredSettings.length) {
        window._vcl.setItems([
            makeEmptyItem('No matching settings found.')
        ]);

        return;
    }

    window._vcl.setItems(
        filteredSettings.map(s =>
            makeSettingItem(s)
        )
    );
}

function changeLanguage() {
    if (!window._vcl) return;

    const langs = [
        {
            icon: `<img src="https://img.icons8.com/?size=96&id=pHfpq4E7vg9Y&format=png">`,
            label: 'Azərbaycan dili',

            onClick: () => {
                localStorage.setItem(STORAGE_KEYS.LANG, 'az');
                currentLang = 'az';
                translatePage();
            }
        },

        {
            icon: `<img src="https://img.icons8.com/?size=64&id=J6RJcdGoJomQ&format=png">`,
            label: 'Türkçe',

            onClick: () => {
                localStorage.setItem(STORAGE_KEYS.LANG, 'tr');
                currentLang = 'tr';
                translatePage();
            }
        },

        {
            icon: `<img src="https://img.icons8.com/?size=96&id=fIgZUHgwc76e&format=png">`,
            label: 'English',

            onClick: () => {
                localStorage.setItem(STORAGE_KEYS.LANG, 'en');
                currentLang = 'en';
                translatePage();
            }
        },

        {
            icon: `<img src="https://img.icons8.com/?size=96&id=vioRCshpCBKv&format=png">`,
            label: 'Русский',

            onClick: () => {
                localStorage.setItem(STORAGE_KEYS.LANG, 'ru');
                currentLang = 'ru';
                translatePage();
            }
        }
    ];

    window._vcl.setItems(
        langs.map(s => makeSettingItem(s))
    );
}