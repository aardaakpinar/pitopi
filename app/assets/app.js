/*
 * 1. Configuration Constants
 */
const STORAGE_KEYS = {
    USER_ID: "pitopi_user_id",
    PROFILE_PIC: "p2p_pp_base64",
    HIDDEN: "p2p_hidden",
    REMOTE_ID: "p2p_remote_id",
    CONNECTION_STATUS: "p2p_connection_status",
    LANG: "p2p_current_lang",
};

const CONNECTION_STATES = {
    CONNECTED: "Connection established",
    CONNECTING: "Connecting...",
    DISCONNECTED: "Connection lost",
};

const SOCKET_SERVER = (() => {
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  if (hostname === "pitopi.onrender.com") return "https://pitopi.onrender.com/";
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3000/";
  return `${protocol}//${hostname}:3000/`;
})();
const DEFAULT_PROFILE_PIC = "assets/boringavatar.svg";
const STORY_DURATION = {
    IMAGE: 4000,
};

/*
 * 2. Session Setup and Socket Init
 */
const savedUserId = localStorage.getItem(STORAGE_KEYS.USER_ID);
if (!savedUserId) window.location.href = "login.html";

const socket = io(SOCKET_SERVER, {
    transports: ["websocket"],
});

/*
 * 3. Global State
 */
const state = {
    // WebRTC — tek referans noktası
    peer: null,                 // RTCPeerConnection (tek, her zaman burası kullanılır)
    dataChannel: null,
    isDisconnecting: false,     // handlePeerDisconnect re-entry koruması

    // ICE candidate buffer — remoteDescription set edilene kadar bekletir
    iceCandidateBuffer: [],
    remoteDescriptionSet: false,

    receivedBuffers: [],
    incomingFileInfo: null,
    connectionStatus: false,
    remoteId: sessionStorage.getItem(STORAGE_KEYS.REMOTE_ID) || null,
    myId: null,
    myPersistentId: null,
    myUsername: null,
    myProfilePic: null,
    allUsers: [],
    hiddenFromSearch: localStorage.getItem(STORAGE_KEYS.HIDDEN) === "true",
    currentStories: {},
    currentStoryIndex: 0,
    currentUserStories: [],
    storyTimer: null,
    currentView: "home",
    selectedUser: null,
    activeChat: null,
    activeFilter: "all",
    chats: [],
    messages: {},
    isConnected: null,
};

const receivingFile = {
    meta: null,
    chunks: [],
};

/*
 * 4. DOM Elements
 */
const elements = {
    get TabChat() { return document.getElementById("TabChat"); },
    get TabStory() { return document.getElementById("TabStory"); },
    get TabSetting() { return document.getElementById("TabSetting"); },
    get chatsList() { return document.getElementById("chats-list"); },
    get chatPanel() { return document.getElementById("chat-panel"); },
    get noChatPlaceholder() { return document.getElementById("no-chat-placeholder"); },
    get chatContent() { return document.getElementById("chat-content"); },
    get chatName() { return document.getElementById("chat-name"); },
    get chatAvatar() { return document.getElementById("chat-avatar"); },
    get chatStatus() { return document.getElementById("chat-status"); },
    get messagesContainer() { return document.getElementById("messages-container"); },
    get messageInput() { return document.getElementById("message-input"); },
    get sendMessageBtn() { return document.getElementById("send-message"); },
    get backToChatBtn() { return document.getElementById("back-to-chats"); },
    get searchInput() { return document.getElementById("searchId"); },
    get toggleThemeBtn() { return document.getElementById("toggle-theme"); },
    get storyInput() { return document.getElementById("storyInput"); },
    get uploadAvatarInput() { return document.getElementById("uploadAvatarInput"); },
};

let currentLang = localStorage.getItem(STORAGE_KEYS.LANG) || "en";
let translations = {};

/*
 * 5. Initialization
 */
function initApp() {
    setupEventListeners();
    initUIEventListeners();
    initFileUpload();
}

function initFileUpload() {
    const fileInput = document.getElementById("fileInput");
    if (!fileInput) return;

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            showToast(t("file_limit"));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const base64Data = reader.result;
            const fileMeta = {
                type: "file",
                name: file.name,
                size: file.size,
                mimeType: file.type,
                data: base64Data,
            };
            sendFileInChunks(fileMeta);
            renderFilePreview(fileMeta, "me");
            fileInput.value = "";
        };
        reader.readAsDataURL(file);
    });
}

function sendFileInChunks(fileMeta) {
    const chunkSize = 16000;
    const { name, mimeType, data } = fileMeta;
    const totalChunks = Math.ceil(data.length / chunkSize);

    sendSafe(state.dataChannel, JSON.stringify({ type: "file-meta", name, mimeType, totalChunks }));

    for (let i = 0; i < totalChunks; i++) {
        const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
        sendSafe(state.dataChannel, JSON.stringify({ type: "file-chunk", index: i, chunk }));
    }
}

function setupEventListeners() {
    if (elements.toggleThemeBtn) {
        elements.toggleThemeBtn.addEventListener("click", () => {
            document.documentElement.classList.toggle("dark");
        });
    }

    if (elements.sendMessageBtn) {
        elements.sendMessageBtn.addEventListener("click", sendMessage);
    }

    if (elements.messageInput) {
        elements.messageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (elements.backToChatBtn) {
        elements.backToChatBtn.addEventListener("click", () => {
            elements.chatPanel.classList.remove("mobile-chat-open");
            elements.chatPanel.classList.add("mobile-chat-closed");
        });
    }

    if (elements.searchInput) {
        elements.searchInput.addEventListener("input", (e) => {
            searchInCurrentTab(e.target.value.trim().toLowerCase());
        });
    }
}

function initUIEventListeners() {
    let typingTimeout;
    if (elements.messageInput) {
        elements.messageInput.addEventListener("input", () => {
            if (state.connectionStatus && state.dataChannel?.readyState === "open") {
                try { state.dataChannel.send(JSON.stringify({ type: "typing" })); } catch (e) {}
            }
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                if (state.connectionStatus && state.dataChannel?.readyState === "open") {
                    try { state.dataChannel.send(JSON.stringify({ type: "stop-typing" })); } catch (e) {}
                }
            }, 2000);
        });
    }
}

function initStoryFunctionality() {
    if (elements.storyInput) elements.storyInput.addEventListener("change", handleStoryUpload);
}

function initProfilePictureUpload() {
    if (elements.uploadAvatarInput) elements.uploadAvatarInput.addEventListener("change", handleProfilePictureUpload);
}

/*
 * 6. UI Render Functions
 */
function getRandomMessage(key) {
    const arr = translations[currentLang]?.[key];
    if (Array.isArray(arr)) return arr[Math.floor(Math.random() * arr.length)];
    return key;
}

function getFileIconClass(fileName = "", mimeType = "") {
    const ext = fileName.split(".").pop().toLowerCase();
    const map = {
        pdf: "fa-file-pdf", doc: "fa-file-word", docx: "fa-file-word",
        xls: "fa-file-excel", xlsx: "fa-file-excel", csv: "fa-file-csv",
        ppt: "fa-file-powerpoint", pptx: "fa-file-powerpoint",
        zip: "fa-file-zipper", rar: "fa-file-zipper",
        txt: "fa-file-lines", js: "fa-file-code", html: "fa-file-code",
        css: "fa-file-code", json: "fa-file-code",
    };
    return map[ext] || "fa-file";
}

function escapeHtml(unsafe) {
    return String(unsafe)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderFilePreview(fileMeta, from) {
    const { name, mimeType, data } = fileMeta;
    let content = "";

    if (mimeType.startsWith("image/")) {
        content = `<img src="${data}" alt="${escapeHtml(name)}" class="max-w-[200px] rounded-lg" />`;
    } else if (mimeType.startsWith("audio/")) {
        content = `<audio controls src="${data}" class="mt-2"></audio>`;
    } else {
        const iconClass = getFileIconClass(name, mimeType);
        content = `
      <div class="flex items-center space-x-4 bg-gray-100 dark:bg-gray-800 p-3 rounded shadow-md max-w-md">
        <div class="flex-shrink-0">
          <i class="fas ${iconClass} text-3xl text-gray-600 dark:text-gray-300"></i>
        </div>
        <div class="flex-grow">
          <p class="text-md font-semibold text-gray-900 dark:text-gray-100 truncate">${escapeHtml(name)}</p>
          <a href="${data}" download="${name}" class="text-sm text-blue-600 hover:underline">Dosyayı indir</a>
        </div>
      </div>`;
    }
    logMessage(content, from);
}

function sendSafe(channel, data) {
    try {
        if (channel?.readyState === "open") {
            channel.send(data);
        } else {
            console.warn("Kanal kapalı, mesaj gönderilemedi");
        }
    } catch (err) {
        console.error("sendSafe hatası:", err);
    }
}

/*
 * 7. Navigation and Button Logic
 */
let activeTabId = "btnChats";

const sidebarButtons = [
    { id: "btnChats", action: renderChats },
    { id: "btnStorys", action: renderStorys },
    { id: "btnSettings", action: renderSettings },
];

function activateButton(buttonList, activeId) {
    buttonList.forEach(({ id }) => {
        const btn = document.getElementById(id);
        if (id === activeId) {
            btn.classList.add("text-accent");
            btn.classList.remove("text-gray-500");
        } else {
            btn.classList.remove("text-accent");
            btn.classList.add("text-gray-500");
        }
    });
}

sidebarButtons.forEach(({ id, action }) => {
    document.getElementById(id)?.addEventListener("click", () => {
        activeTabId = id;
        activateButton(sidebarButtons, id);
        action();
    });
});

const mobileButtons = [
    { id: "mobBtnChats", action: renderChats },
    { id: "mobBtnStorys", action: renderStorys },
    { id: "mobBtnSettings", action: renderSettings },
];

mobileButtons.forEach(({ id, action }) => {
    document.getElementById(id)?.addEventListener("click", () => {
        activeTabId = id;
        activateButton(mobileButtons, id);
        action();
    });
});

/*
 * 8. Media Upload Handlers
 */
function handleProfilePictureUpload() {
    const file = elements.uploadAvatarInput.files[0];
    if (!file?.type.startsWith("image/")) { showToast(t("image_file_valid")); return; }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
        const MAX = 256;
        let { width, height } = img;
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }

        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);

        const base64Image = canvas.toDataURL("image/jpeg", 0.7);
        URL.revokeObjectURL(objectUrl);

        localStorage.setItem(STORAGE_KEYS.PROFILE_PIC, base64Image);
        document.querySelector("#btnSettings img").src = base64Image;
        document.querySelector("#mobBtnSettings img").src = base64Image;
        showToast(t("pp_update"));
        socket.emit("update-profile-pic", base64Image);
    };
    img.src = objectUrl;
}

function handleStoryUpload() {
    const file = elements.storyInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast(t("image_file_valid")); return; }
    if (file.size > 10 * 1024 * 1024) { showToast(t("file_limit")); return; }

    const reader = new FileReader();
    reader.onload = () => {
        socket.emit("upload-story", { data: reader.result, type: "image", caption: "" });
        showToast(t("story_upload"));
    };
    reader.readAsDataURL(file);
}

/*
 * 9. View Logic
 */
function renderChats() { renderChatsList(); showOnlyTab(TabChat); }
function renderStorys() { renderStoriesList(); showOnlyTab(TabStory); }
function renderSettings() { renderSettingsList(); showOnlyTab(TabSetting); }

function showOnlyTab(tab) {
    TabChat.classList.add("hidden");
    TabStory.classList.add("hidden");
    TabSetting.classList.add("hidden");
    tab.classList.remove("hidden");
}

/*
 * 10. Messaging
 */
function sendMessage() {
    const text = elements.messageInput?.value.trim();
    if (!text) return;

    console.log("Attempting to send message, dataChannel:", state.dataChannel, "readyState:", state.dataChannel?.readyState);

    if (!state.dataChannel || state.dataChannel.readyState !== "open") {
        showSystemMessage("Mesaj gönderilemedi. Bağlantı kapalı.");
        return;
    }

    try {
        state.dataChannel.send(JSON.stringify({ type: "text", message: text }));
        logMessage(text, "me");
        elements.messageInput.value = "";
    } catch (error) {
        console.error("Error sending message:", error);
        showSystemMessage("Mesaj gönderilemedi: " + error.message);
    }
}

function handleData(data) {
    if (typeof data !== "string") return;

    try {
        const msg = JSON.parse(data);

        if (msg.type === "file-meta") {
            receivingFile.meta = msg;
            receivingFile.chunks = [];
        } else if (msg.type === "file-chunk") {
            receivingFile.chunks[msg.index] = msg.chunk;
            const allReceived =
                receivingFile.chunks.length === receivingFile.meta.totalChunks &&
                receivingFile.chunks.every(Boolean);

            if (allReceived) {
                renderFilePreview({
                    type: "file",
                    name: receivingFile.meta.name,
                    mimeType: receivingFile.meta.mimeType,
                    data: receivingFile.chunks.join(""),
                }, "them");
                playNotificationSound();
                receivingFile.meta = null;
                receivingFile.chunks = [];
            }
            return;
        }

        if (msg.type === "file") { renderFilePreview(msg, "them"); playNotificationSound(); return; }
        if (msg.type === "text") { logMessage(msg.message, "them"); playNotificationSound(); }
        else if (msg.type === "typing") {
            if (elements.chatStatus) { elements.chatStatus.textContent = "Yazıyor..."; elements.chatStatus.style.color = "orange"; }
        }
        else if (msg.type === "stop-typing") {
            if (elements.chatStatus) { elements.chatStatus.textContent = t("text-available"); elements.chatStatus.style.color = ""; }
        }
    } catch (e) {
        console.error("Error parsing message:", e);
    }
}

function formatTime(date) {
    return date.toLocaleString("en-US", { hour: "numeric", minute: "numeric", hour12: false });
}

function logMessage(text, from) {
    if (!elements.messagesContainer) return;

    const wrapper = document.createElement("div");
    wrapper.className = "mb-4";

    const row = document.createElement("div");
    row.className = `flex ${from === "me" ? "justify-end" : "justify-start"}`;

    const msgDiv = document.createElement("div");
    msgDiv.className = `max-w-[80%] px-3 py-2 rounded-lg ${
        from === "me"
            ? "bg-messageBg-light dark:bg-messageBg-dark rounded-br-none"
            : "bg-messageBg-light dark:bg-messageBg-dark rounded-bl-none"
    }`;

    const isHtml = text.includes("<img") || text.includes("<audio") || text.includes("<video") || text.includes("<div");

    if (isHtml) {
        msgDiv.innerHTML = text;
    } else {
        const parts = text.split(/(https?:\/\/[^\s]+)/g);
        parts.forEach((part) => {
            if (part.match(/https?:\/\/[^\s]+/)) {
                try {
                    const url = new URL(part);
                    const a = document.createElement("a");
                    a.href = url.href; a.target = "_blank"; a.rel = "noopener noreferrer";
                    a.style.textDecoration = "underline"; a.textContent = part;
                    msgDiv.appendChild(a);
                } catch { msgDiv.appendChild(document.createTextNode(part)); }
            } else {
                msgDiv.appendChild(document.createTextNode(part));
            }
        });
    }

    row.appendChild(msgDiv);

    const timeDiv = document.createElement("div");
    timeDiv.className = `text-xs text-gray-500 dark:text-gray-400 ${from === "me" ? "text-right" : "text-left"} mt-1`;
    timeDiv.textContent = formatTime(new Date());

    wrapper.appendChild(row);
    wrapper.appendChild(timeDiv);
    elements.messagesContainer.appendChild(wrapper);
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function showSystemMessage(message) {
    if (!elements.messagesContainer) return;
    const wrapper = document.createElement("div");
    wrapper.className = "flex justify-center mb-4";
    const msgDiv = document.createElement("div");
    msgDiv.className = "bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded-full text-sm text-gray-600 dark:text-gray-300";
    msgDiv.textContent = message;
    wrapper.appendChild(msgDiv);
    elements.messagesContainer.appendChild(wrapper);
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

/*
 * 11. WebRTC Functions
 */

/**
 * ICE candidate buffer'ını flush et.
 * setRemoteDescription tamamlandıktan hemen sonra çağrılmalı.
 */
async function flushIceCandidateBuffer() {
    if (!state.peer) return;
    console.log(`Flushing ${state.iceCandidateBuffer.length} buffered ICE candidates`);
    const buffered = state.iceCandidateBuffer.splice(0);
    for (const candidate of buffered) {
        try {
            await state.peer.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("Added buffered ICE candidate:", candidate.type);
        } catch (err) {
            console.warn("Buffer'dan ICE candidate eklenemedi:", err.message);
        }
    }
}

/**
 * Tek bir yerde peer oluşturulur. activePeerConnection kaldırıldı,
 * her zaman state.peer kullanılır.
 */
function createPeer() {
    const config = {
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
        ],
    };

    const peer = new RTCPeerConnection(config);

    peer.onicecandidate = (e) => {
        if (e.candidate) {
            console.log("Sending ICE candidate:", e.candidate.type, e.candidate.candidate);
            socket.emit("send-ice-candidate", { targetId: state.remoteId, candidate: e.candidate });
        } else {
            console.log("ICE gathering complete");
        }
    };

    peer.ondatachannel = (e) => {
        console.log("Received dataChannel from peer");
        state.dataChannel = e.channel;
        setupChannel();
    };

    peer.onconnectionstatechange = () => {
        console.log("Connection state:", peer.connectionState);
        if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
            handlePeerDisconnect();
        }
    };

    return peer;
}

function setupChannel() {
    if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true; // Disable until open

    state.dataChannel.onopen = () => {
        console.log("DataChannel opened successfully");
        updateStatus(CONNECTION_STATES.CONNECTED);
        localStorage.setItem(STORAGE_KEYS.CONNECTION_STATUS, "true");
        if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = false; // Enable when open
    };

    // onclose → handlePeerDisconnect zaten re-entry koruması var
    state.dataChannel.onclose = () => {
        console.log("DataChannel closed");
        if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true;
        handlePeerDisconnect();
    };

    state.dataChannel.onerror = (error) => {
        console.warn("⚠️ Data channel error:", error?.error?.message || error);
        if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true;
        if (state.connectionStatus) handlePeerDisconnect();
    };

    state.dataChannel.onmessage = (e) => handleData(e.data);
}

async function startCall(id) {
    if (!id) { showToast(t("select_chat_title")); return; }

    if (state.connectionStatus) {
        const confirmReconnect = confirm("Zaten bir sohbete bağlısınız...");
        if (!confirmReconnect) return;
        handlePeerDisconnect();
    }

    // Önceki peer'ı temizle
    cleanupPeer();

    try {
        state.remoteId = id;
        state.remoteDescriptionSet = false;
        state.iceCandidateBuffer = [];
        sessionStorage.setItem(STORAGE_KEYS.REMOTE_ID, id);

        state.peer = createPeer();
        state.dataChannel = state.peer.createDataChannel("chat");
        console.log("Created dataChannel for outgoing call");
        setupChannel();
        updateStatus(CONNECTION_STATES.CONNECTING);

        if (state.peer.signalingState !== "stable") {
            console.warn("signalingState:", state.peer.signalingState, "— offer iptal");
            return;
        }

        const offer = await state.peer.createOffer();

        if (state.peer.signalingState !== "stable") {
            console.warn("signalingState setLocalDescription öncesinde değişti");
            return;
        }

        await state.peer.setLocalDescription(offer);
        socket.emit("call-user", { targetId: state.remoteId, offer });

    } catch (error) {
        if (error?.name === "InvalidStateError") {
            console.warn("Glare durumu — offer iptal edildi.");
            return;
        }
        console.error("Teklif hatası:", error);
        handlePeerDisconnect();
    }
}

/**
 * Peer ve dataChannel event listener'larını temizler, kapatır.
 * state sıfırlamaz — sadece WebRTC kaynaklarını serbest bırakır.
 */
function cleanupPeer() {
    if (state.dataChannel) {
        state.dataChannel.onopen = null;
        state.dataChannel.onclose = null;
        state.dataChannel.onmessage = null;
        state.dataChannel.onerror = null;
        try { state.dataChannel.close(); } catch (e) {}
        state.dataChannel = null;
    }

    if (state.peer) {
        state.peer.onicecandidate = null;
        state.peer.ondatachannel = null;
        state.peer.onconnectionstatechange = null;
        try { state.peer.close(); } catch (e) {}
        state.peer = null;
    }
}

function handlePeerDisconnect() {
    // Re-entry koruması — çift tetiklenmeyi önler
    if (state.isDisconnecting) return;
    state.isDisconnecting = true;

    console.log("Peer disconnected, cleaning up...");
    updateStatus(CONNECTION_STATES.DISCONNECTED);

    if (state.connectionStatus) {
        showSystemMessage("Karşı taraf bağlantıyı kapattı veya bağlantı kaybedildi.");
    }

    // Sunucuya bildir (listener'lar silinmeden önce)
    if (state.remoteId) {
        socket.emit("connection-ended", { targetId: state.remoteId });
    }

    // WebRTC kaynaklarını temizle
    cleanupPeer();

    // UI'ı kapat
    closeChat();

    // State sıfırla
    state.connectionStatus = false;
    state.remoteId = null;
    state.receivedBuffers = [];
    state.incomingFileInfo = null;
    state.activeChat = null;
    state.selectedUser = null;
    state.iceCandidateBuffer = [];
    state.remoteDescriptionSet = false;

    sessionStorage.removeItem(STORAGE_KEYS.REMOTE_ID);
    localStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);

    if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true;
    renderChatsList();

    // Korumayı kaldır — bir sonraki bağlantı için hazır
    state.isDisconnecting = false;
}

/*
 * 13. Story Screen
 */
let isStoryPlaying = false;
let storyTimeout = null;

function openStory(user) {
    if (isStoryPlaying) return;
    if (!user?.persistentUserId) return;

    closeChat();

    const storyData = state.currentStories[user.persistentUserId];
    const stories = storyData?.stories?.filter((s) => s.type === "image") || [];
    if (!stories.length) return;

    isStoryPlaying = true;

    const panel = document.getElementById("story-panel");
    const img = document.getElementById("story-image");
    const progressContainer = document.getElementById("story-progress-container");
    const usernameLabel = document.getElementById("story-username");
    const avatar = document.getElementById("story-avatar");
    const viewersCountDiv = document.getElementById("story-viewersCount");

    elements.noChatPlaceholder?.classList.add("hidden");
    panel.classList.remove("hidden");
    document.getElementById("chat-panel")?.classList.remove("hidden");
    document.getElementById("chat-panel")?.classList.remove("mobile-chat-closed");
    document.getElementById("chat-panel")?.classList.add("mobile-chat-open");

    usernameLabel.textContent = user.username;
    avatar.src = user.profilePic || DEFAULT_PROFILE_PIC;

    progressContainer.innerHTML = "";
    stories.forEach((_, i) => {
        const bar = document.createElement("div");
        bar.className = "h-full bg-gray-700 relative flex-1 mx-0.5 overflow-hidden rounded";
        bar.innerHTML = `<div id="progress-fill-${i}" class="absolute top-0 left-0 h-full bg-accent w-0 transition-all"></div>`;
        progressContainer.appendChild(bar);
    });

    let index = 0;

    function showNextStory() {
        if (!isStoryPlaying) return;
        if (index >= stories.length) { closeStory(); return; }

        const story = stories[index];
        img.src = story.data;

        socket.emit("story-viewed", { persistentUserId: user.persistentUserId, storyId: story.id });
        viewersCountDiv.innerHTML = `<i class="fas fa-eye"></i>  ${story.viewersCount || 0}`;

        if (user.persistentUserId === state.myPersistentId) {
            const deleteBtn = document.getElementById("delete-story-btn");
            if (deleteBtn) {
                deleteBtn.classList.remove("hidden");
                deleteBtn.onclick = () => {
                    if (confirm("Bu hikayeyi silmek istediğine emin misin?")) {
                        socket.emit("delete-story", { storyId: story.id });
                        closeStory();
                    }
                };
            }
        }

        img.draggable = false;
        img.ontouchstart = e => e.preventDefault();
        img.onmousedown = e => e.preventDefault();
        img.classList.remove("hidden");

        const fill = document.getElementById(`progress-fill-${index}`);
        fill.style.width = "0%";
        fill.style.transition = "none";
        requestAnimationFrame(() => {
            fill.style.transition = `width ${STORY_DURATION.IMAGE}ms linear`;
            fill.style.width = "100%";
        });

        storyTimeout = setTimeout(() => { index++; showNextStory(); }, STORY_DURATION.IMAGE);
    }

    showNextStory();
}

function closeStory() {
    if (storyTimeout) { clearTimeout(storyTimeout); storyTimeout = null; }
    isStoryPlaying = false;

    const deleteBtn = document.getElementById("delete-story-btn");
    if (deleteBtn) deleteBtn.classList.add("hidden");

    const img = document.getElementById("story-image");
    if (img) img.src = "";

    document.getElementById("story-panel")?.classList.add("hidden");
    document.getElementById("story-progress-container").innerHTML = "";

    const chatPanel = document.getElementById("chat-panel");
    chatPanel?.classList.add("hidden");
    chatPanel?.classList.add("mobile-chat-closed");
    chatPanel?.classList.remove("mobile-chat-open");

    elements.noChatPlaceholder?.classList.remove("hidden");
}

/*
 * 14. User Chat Screen
 */
function prepareChatUI() {
    if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = false;
    elements.noChatPlaceholder?.classList.add("hidden");

    if (elements.chatContent) {
        elements.chatContent.classList.remove("hidden");
        elements.chatContent.classList.add("flex");
    }

    if (elements.chatPanel) {
        elements.chatPanel.classList.remove("hidden");
        elements.chatPanel.classList.add("mobile-chat-open");
        elements.chatPanel.classList.remove("mobile-chat-closed");
    }

    if (elements.messagesContainer) elements.messagesContainer.innerHTML = "";
    setTimeout(() => elements.messageInput?.focus(), 0);
}

function openChat(user) {
    closeStory();
    state.activeChat = user;
    state.selectedUser = user;
    state.currentView = "chat";

    prepareChatUI();

    if (elements.chatName) elements.chatName.textContent = user.username;
    if (elements.chatAvatar) {
        elements.chatAvatar.innerHTML = `<img src="${user.profilePic || DEFAULT_PROFILE_PIC}" alt="${user.username}" class="w-full h-full rounded-full object-cover">`;
    }
    if (elements.chatStatus) elements.chatStatus.textContent = t("text-available");

    startCall(user.socketId);
}

function closeChat() {
    state.activeChat = null;
    state.selectedUser = null;
    state.currentView = null;

    if (elements.chatContent) {
        elements.chatContent.classList.add("hidden");
        elements.chatContent.classList.remove("flex");
    }

    if (elements.chatPanel) {
        elements.chatPanel.classList.remove("mobile-chat-open");
        elements.chatPanel.classList.add("mobile-chat-closed");
    }

    elements.noChatPlaceholder?.classList.remove("hidden");
    if (elements.messagesContainer) elements.messagesContainer.innerHTML = "";
}

function toggleFloatingMenu() {
    const menu = document.getElementById("floating-menu");
    const isVisible = !menu.classList.contains("hidden");

    if (isVisible) { menu.classList.add("hidden"); return; }

    const copyBtn = document.getElementById("copy-id-btn");
    const leaveBtn = document.getElementById("leave-btn");

    if (state.currentView === "chat") {
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(state.selectedUser.socketId);
            showToast(t("copied_id"));
            menu.classList.add("hidden");
        };
        leaveBtn.classList.remove("hidden");
        leaveBtn.onclick = () => { handlePeerDisconnect(); menu.classList.add("hidden"); };
    }

    menu.classList.remove("hidden");
}

/*
 * 15. Utilities
 */
function updateStatus(text) {
    console.log("Status:", text);
    if (text === CONNECTION_STATES.CONNECTED) {
        state.connectionStatus = true;
    } else if (text === CONNECTION_STATES.DISCONNECTED) {
        state.connectionStatus = false;
    }
}

function timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (seconds < 60) return `${seconds} saniye önce paylaşıldı`;
    if (minutes < 60) return `${minutes} dakika önce paylaşıldı`;
    if (hours < 24) return `${hours} saat önce paylaşıldı`;
    return `${days} gün önce paylaşıldı`;
}

function playNotificationSound() {
    let audio = document.getElementById("notification-sound");
    if (!audio) {
        audio = document.createElement("audio");
        audio.id = "notification-sound";
        audio.src = "assets/notification.mp3";
        document.body.appendChild(audio);
    }
    audio.play().catch((e) => console.log("Audio play error:", e));
}

function searchInCurrentTab(query) {
    if (!state.isConnected) {
        elements.chatsList.innerHTML = `<div class="text-center text-gray-500 dark:text-gray-400 py-10">${t("connecting")}</div>`;
        return;
    }

    const q = query.trim().toLowerCase();
    const settings = [
        { icon: `<i class="fas fa-copy"></i>`, label: t("copy_id"), onClick: () => { navigator.clipboard.writeText(state.myId); showToast(t("copied_id")); } },
        { icon: `<i class="fas fa-camera"></i>`, label: t("upload_photo"), onClick: () => document.getElementById("uploadAvatarInput")?.click() },
        { icon: `<i class="fas fa-user-secret"></i>`, label: state.hiddenFromSearch ? t("hidden_from_search") : t("visible_in_search"), onClick: () => toggleSearchVisibility() },
        { icon: `<i class="fas fa-globe"></i>`, label: t("select_language"), onClick: () => changeLanguage() },
        { icon: `<i class="fas fa-sign-out-alt"></i>`, label: t("log_out"), onClick: () => logoutUser() },
    ];

    if (activeTabId === "btnChats" || activeTabId === "mobBtnChats") {
        renderChatSearchResults(state.allUsers.filter(u => u.socketId !== state.myId && !u.hidden && u.username.toLowerCase().includes(q)));
    } else if (activeTabId === "btnStorys" || activeTabId === "mobBtnStorys") {
        renderStorySearchResults(Object.values(state.currentStories).filter(s => s?.user?.username.toLowerCase().includes(q)));
    } else if (activeTabId === "btnSettings" || activeTabId === "mobBtnSettings") {
        renderSettingsSearchResults(settings.filter(s => s.label.toLowerCase().includes(query.toLowerCase())));
    }
}

function showToast(message) {
    document.querySelector(".toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "toast fixed top-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 transform translate-x-full transition-transform duration-300";
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.remove("translate-x-full"));
    setTimeout(() => { toast.classList.add("translate-x-full"); setTimeout(() => toast.remove(), 300); }, 3000);
}

/*
 * 16. Socket Events
 */
socket.on("connect", () => {
    state.isConnected = true;
    initApp();
    socket.emit("auth", savedUserId);
});

socket.on("your-id", ({ socketId, persistentUserId, username, profilePic }) => {
    state.myId = socketId;
    state.myPersistentId = persistentUserId;
    state.myUsername = username;
    state.myProfilePic = profilePic || DEFAULT_PROFILE_PIC;
    document.querySelector("#btnSettings img").src = state.myProfilePic;
    document.querySelector("#mobBtnSettings img").src = state.myProfilePic;
    console.log(`Connected: socketId=${socketId}, persistentId=${persistentUserId}`);
});

socket.on("auth_ok", ({ user }) => {
    console.log("Auth successful:", user);
});

socket.on("auth_failed", (reason) => {
    console.error("Auth failed:", reason);
    alert("Authentication failed: " + reason);
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    window.location.href = "login.html";
});

socket.on("nickname-restricted", (message) => {
    alert(message || "Kullanıcı adınız kısıtlanmış.");
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    window.location.href = "login.html";
});

socket.on("nickname-taken", (reason) => {
    alert((reason || "Bu kullanıcı adı zaten kullanılıyor.") + " Lütfen tekrar giriş yapın.");
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    window.location.href = "login.html";
});

socket.on("online-users", (users) => {
    state.allUsers = users;
    if (activeTabId === "btnChats" || activeTabId === "mobBtnChats") renderChatsList();
});

socket.on("peer-disconnected", ({ from }) => {
    if (state.remoteId === from) {
        handlePeerDisconnect();
        renderChatsList();
    }
});

socket.on("user-disconnected", (userId) => {
    if (state.connectionStatus && state.remoteId === userId) handlePeerDisconnect();
    renderChatsList();
});

socket.on("stories-updated", (stories) => {
    state.currentStories = stories;
    if (activeTabId === "btnStorys" || activeTabId === "mobBtnStorys") renderStoriesList(stories);
});

socket.on("incoming-call", async ({ from, offer }) => {
    const caller = state.allUsers.find((u) => u.socketId === from);
    if (!caller) return;

    if (state.connectionStatus) {
        // Glare: ikisi aynı anda çağrıyorsa küçük ID geri çekilir
        if (state.peer?.localDescription?.type === "offer" && state.myId < from) {
            socket.emit("call-rejected", { targetId: from, reason: "Simultaneous offer" });
            return;
        } else {
            socket.emit("call-rejected", { targetId: from, reason: "Busy" });
            return;
        }
    }

    const confirmConnect = confirm(`${caller.username} ${t("confirm_connect")}`);
    if (!confirmConnect) {
        socket.emit("call-rejected", { targetId: from, reason: "Rejected" });
        return;
    }

    state.remoteId = from;
    state.remoteDescriptionSet = false;
    state.iceCandidateBuffer = [];

    try {
        // Önceki peer'ı temizle
        cleanupPeer();
        state.peer = createPeer();
        updateStatus("Yanıtlanıyor...");

        // Chat UI hazırla
        closeStory();
        state.activeChat = caller;
        state.selectedUser = caller;
        state.currentView = "chat";
        prepareChatUI();

        if (elements.chatName) elements.chatName.textContent = caller.username;
        if (elements.chatAvatar) {
            elements.chatAvatar.innerHTML = `<img src="${caller.profilePic || DEFAULT_PROFILE_PIC}" alt="${caller.username}" class="w-full h-full rounded-full object-cover">`;
        }
        if (elements.chatStatus) elements.chatStatus.textContent = t("text-available");

        await state.peer.setRemoteDescription(new RTCSessionDescription(offer));
        console.log("Set remote description (offer) successfully");

        // remoteDescription set edildi — buffer'daki candidate'leri ekle
        state.remoteDescriptionSet = true;
        await flushIceCandidateBuffer();

        const answer = await state.peer.createAnswer();
        await state.peer.setLocalDescription(answer);
        socket.emit("send-answer", { targetId: state.remoteId, answer });

        state.connectionStatus = true;
        sessionStorage.setItem(STORAGE_KEYS.REMOTE_ID, from);

    } catch (error) {
        console.error("Gelen çağrı işlenirken hata:", error);
        handlePeerDisconnect();
    }
});

socket.on("call-answered", async ({ answer }) => {
    try {
        if (!state.peer) return;
        await state.peer.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("Set remote description (answer) successfully");

        // remoteDescription set edildi — buffer'daki candidate'leri ekle
        state.remoteDescriptionSet = true;
        await flushIceCandidateBuffer();

        state.connectionStatus = true;
        showToast(t("call_answered"));
    } catch (error) {
        console.error("Error handling call answer:", error);
        handlePeerDisconnect();
    }
});

socket.on("call-rejected", ({ reason }) => {
    updateStatus("Bağlantı reddedildi: " + reason);
    showToast(t("busy"));
    sessionStorage.removeItem(STORAGE_KEYS.REMOTE_ID);
    cleanupPeer();
    state.connectionStatus = false;
    state.remoteId = null;
    closeChat();
});

socket.on("ice-candidate", async ({ candidate }) => {
    console.log("Received ICE candidate:", candidate.type, candidate.candidate);
    if (!state.peer || state.peer.signalingState === "closed") {
        // Peer kapalı — sessizce yoksay
        return;
    }

    if (!state.remoteDescriptionSet) {
        // remoteDescription henüz set edilmedi — buffer'la
        state.iceCandidateBuffer.push(candidate);
        return;
    }

    try {
        await state.peer.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added ICE candidate successfully");
    } catch (error) {
        console.warn("ICE candidate eklenemedi:", error.message);
    }
});

/*
 * 17. Settings Functions
 */
function logoutUser() {
    localStorage.removeItem(STORAGE_KEYS.USER_ID);
    window.location.href = "login.html";
}

function toggleSearchVisibility() {
    state.hiddenFromSearch = !state.hiddenFromSearch;
    localStorage.setItem(STORAGE_KEYS.HIDDEN, state.hiddenFromSearch);
    showToast(state.hiddenFromSearch ? t("hidden_from_search") : t("visible_in_search"));
    socket.emit("update-visibility", { hidden: state.hiddenFromSearch });
    renderSettingsList();
}

/*
 * 18. App Ready
 */
document.addEventListener("DOMContentLoaded", () => {
    initStoryFunctionality();
    initProfilePictureUpload();
    sessionStorage.removeItem(STORAGE_KEYS.REMOTE_ID);
    localStorage.removeItem(STORAGE_KEYS.CONNECTION_STATUS);
    if (elements.noChatPlaceholder) elements.noChatPlaceholder.classList.remove("hidden");
    if (elements.chatContent) elements.chatContent.classList.add("hidden");
});

document.addEventListener("click", (e) => {
    const menu = document.getElementById("floating-menu");
    if (!menu.contains(e.target) && !e.target.closest("[onclick='toggleFloatingMenu()']")) {
        menu.classList.add("hidden");
    }
});

window.sendMessage = sendMessage;

/*
 * 19. Translations
 */
fetch("assets/translations.json")
    .then((res) => res.json())
    .then((data) => {
        translations = data;
        translatePage();
        const chatListEl = document.getElementById('chats-list');
        window._vcl = new VirtualizedChatList(chatListEl, { itemHeight: 73, overscan: 5 });
        renderChats();
    });

function t(key) {
    return translations[currentLang]?.[key] || key;
}

function translatePage() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        el.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
}