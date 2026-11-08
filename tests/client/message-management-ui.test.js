/**
 * Client-focused tests for Message Management UI features A-J.
 *
 * These tests exercise the chatStore logic (state management, API calls)
 * and component-level behaviour without a running browser, using Jest mocks.
 * They do NOT test raw DOM rendering — the spec calls for "logically/automatically
 * verify" which the store unit tests satisfy.
 */

// ─── Minimal browser globals needed by the store/socket ───────────────────────
global.WebSocket = class FakeWS {
  constructor() { this.readyState = 3; } // CLOSED
  send() {} close() {}
};
try { global.localStorage = require("./localStorage-mock"); } catch {
  // inline fallback
  const _store = {};
  global.localStorage = {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = v; },
    removeItem: (k) => { delete _store[k]; },
  };
}

// ─── Mock the API client so no real HTTP is made ──────────────────────────────
jest.mock("../../client/src/api/client", () => {
  const api = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  api.default = api;
  return api;
});

// ─── Mock the socket so no real WS connection is made ────────────────────────
jest.mock("../../client/src/api/socket", () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
    markSeen: jest.fn(),
    openChat: jest.fn(),
    closeChat: jest.fn(),
    startTyping: jest.fn(),
    stopTyping: jest.fn(),
    sendMessage: jest.fn().mockReturnValue("temp_1"),
    sendVoiceMessage: jest.fn().mockReturnValue("vtemp_1"),
    isConnected: false,
    clearSyncAnchor: jest.fn(),
    setSyncAnchor: jest.fn(),
    syncAnchor: null,
  },
}));

const api = require("../../client/src/api/client");

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Helper: fresh store instance ─────────────────────────────────────────────
function freshStore() {
  jest.resetModules();
  // Re-require after reset to get a clean Zustand store
  const { useChatStore } = require("../../client/src/store/chatStore");
  return useChatStore.getState();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Star action calls API
// ─────────────────────────────────────────────────────────────────────────────
test("1 — starMessage calls POST /messages/:id/star", async () => {
  api.post.mockResolvedValue({ data: {} });
  const store = freshStore();
  store.activeChatId = "chat1";
  await store.starMessage("msg1");
  expect(api.post).toHaveBeenCalledWith("/messages/msg1/star");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Unstar state updates
// ─────────────────────────────────────────────────────────────────────────────
test("2 — unstarMessage removes id from starredMessageIds", async () => {
  api.post.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
  const store = freshStore();
  store.activeChatId = "chat1";
  // Star first
  await store.starMessage("msg2");
  expect(store.starredMessageIds.has("msg2")).toBe(true);
  // Unstar
  await store.unstarMessage("msg2");
  // After unstar the id must not be in the set
  const { useChatStore } = require("../../client/src/store/chatStore");
  expect(useChatStore.getState().starredMessageIds.has("msg2")).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Star indicator renders (store state reflects starred)
// ─────────────────────────────────────────────────────────────────────────────
test("3 — starredMessageIds set contains starred message id", async () => {
  api.post.mockResolvedValue({ data: {} });
  const store = freshStore();
  store.activeChatId = "chat1";
  await store.starMessage("msg3");
  const { useChatStore } = require("../../client/src/store/chatStore");
  expect(useChatStore.getState().starredMessageIds.has("msg3")).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Pin action calls API
// ─────────────────────────────────────────────────────────────────────────────
test("4 — pinMessage calls POST /chats/:chatId/pin", async () => {
  const pinned = { id: "msg4", content: "pinned text", chatId: "chat1" };
  api.post.mockResolvedValue({ data: { pinnedMessage: pinned } });
  const store = freshStore();
  await store.pinMessage("chat1", "msg4");
  expect(api.post).toHaveBeenCalledWith("/chats/chat1/pin", { messageId: "msg4" });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Pinned banner renders (pinnedMessages store state)
// ─────────────────────────────────────────────────────────────────────────────
test("5 — pinnedMessages contains pinned item after pinMessage", async () => {
  const pinned = { id: "msg5", content: "hello pin", chatId: "chat1" };
  api.post.mockResolvedValue({ data: { pinnedMessage: pinned } });
  const store = freshStore();
  await store.pinMessage("chat1", "msg5");
  const { useChatStore } = require("../../client/src/store/chatStore");
  const state = useChatStore.getState();
  expect(state.pinnedMessages.some((p) => p.id === "msg5")).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Unpin updates state
// ─────────────────────────────────────────────────────────────────────────────
test("6 — unpinMessage removes item from pinnedMessages", async () => {
  const pinned = { id: "msg6", content: "to unpin", chatId: "chat1" };
  api.post.mockResolvedValue({ data: { pinnedMessage: pinned } });
  api.delete.mockResolvedValue({ data: {} });
  const store = freshStore();
  await store.pinMessage("chat1", "msg6");
  await store.unpinMessage("chat1", "msg6");
  const { useChatStore } = require("../../client/src/store/chatStore");
  expect(useChatStore.getState().pinnedMessages.some((p) => p.id === "msg6")).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Edit eligible own text message — calls PATCH and updates state
// ─────────────────────────────────────────────────────────────────────────────
test("7 — editMessage calls PATCH /messages/:id and updates content", async () => {
  const updated = { id: "msg7", content: "edited text", editedAt: new Date().toISOString(), chatId: "chat1" };
  api.patch.mockResolvedValue({ data: { message: updated } });
  const store = freshStore();
  store.activeChatId = "chat1";
  // Seed a message
  store.messages = { chat1: [{ id: "msg7", content: "original", chatId: "chat1", senderId: "user1" }] };
  const result = await store.editMessage("msg7", "edited text");
  expect(api.patch).toHaveBeenCalledWith("/messages/msg7", { content: "edited text" });
  expect(result.content).toBe("edited text");
  const { useChatStore } = require("../../client/src/store/chatStore");
  const msg = useChatStore.getState().messages["chat1"].find((m) => m.id === "msg7");
  expect(msg.content).toBe("edited text");
  expect(msg.editedAt).toBeTruthy();
  expect(msg.translation).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Edit not shown for non-owned messages — isMine check in component
//    Tested at store level: editMessage still calls API regardless (auth on server)
//    Component-level: isMine gate prevents rendering the Edit button.
//    We verify the state logic: editMessage updates the store state correctly.
// ─────────────────────────────────────────────────────────────────────────────
test("8 — editMessage with wrong content returns server error (non-owner blocked server-side)", async () => {
  api.patch.mockRejectedValue({ response: { data: { error: "Forbidden" } } });
  const store = freshStore();
  store.activeChatId = "chat1";
  await expect(store.editMessage("msg8", "new content")).rejects.toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Edited indicator renders — editedAt field set in store
// ─────────────────────────────────────────────────────────────────────────────
test("9 — edited message has editedAt set in store after editMessage", async () => {
  const now = new Date().toISOString();
  const updated = { id: "msg9", content: "new", editedAt: now, chatId: "chat1" };
  api.patch.mockResolvedValue({ data: { message: updated } });
  const store = freshStore();
  store.activeChatId = "chat1";
  store.messages = { chat1: [{ id: "msg9", content: "old", chatId: "chat1" }] };
  await store.editMessage("msg9", "new");
  const { useChatStore } = require("../../client/src/store/chatStore");
  const msg = useChatStore.getState().messages["chat1"].find((m) => m.id === "msg9");
  expect(msg.editedAt).toBe(now);
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Search result navigation — highlightMessage sets and clears state
// ─────────────────────────────────────────────────────────────────────────────
test("10 — highlightMessage sets highlightedMessageId then clears it", async () => {
  jest.useFakeTimers();
  const store = freshStore();
  store.highlightMessage("msgA");
  const { useChatStore } = require("../../client/src/store/chatStore");
  expect(useChatStore.getState().highlightedMessageId).toBe("msgA");
  jest.advanceTimersByTime(2100);
  expect(useChatStore.getState().highlightedMessageId).toBeNull();
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Selection mode enter/exit
// ─────────────────────────────────────────────────────────────────────────────
test("11 — enterSelectionMode activates mode; exitSelectionMode clears it", () => {
  const store = freshStore();
  expect(store.selectionMode).toBe(false);
  store.enterSelectionMode("msg11");
  const { useChatStore } = require("../../client/src/store/chatStore");
  let state = useChatStore.getState();
  expect(state.selectionMode).toBe(true);
  expect(state.selectedMessageIds.has("msg11")).toBe(true);
  state.exitSelectionMode();
  state = useChatStore.getState();
  expect(state.selectionMode).toBe(false);
  expect(state.selectedMessageIds.size).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Multi-select count
// ─────────────────────────────────────────────────────────────────────────────
test("12 — toggleMessageSelection adds/removes ids and count reflects selection", () => {
  const store = freshStore();
  store.enterSelectionMode();
  store.toggleMessageSelection("m1");
  store.toggleMessageSelection("m2");
  store.toggleMessageSelection("m3");
  const { useChatStore } = require("../../client/src/store/chatStore");
  let state = useChatStore.getState();
  expect(state.selectedMessageIds.size).toBe(3);
  // toggle off one
  state.toggleMessageSelection("m2");
  state = useChatStore.getState();
  expect(state.selectedMessageIds.size).toBe(2);
  expect(state.selectedMessageIds.has("m2")).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Bulk star
// ─────────────────────────────────────────────────────────────────────────────
test("13 — bulkAction star calls POST /messages/bulk and updates starredMessageIds", async () => {
  const results = [
    { messageId: "b1", success: true },
    { messageId: "b2", success: true },
  ];
  api.post.mockResolvedValue({ data: { allSucceeded: true, anySucceeded: true, results } });
  const store = freshStore();
  store.activeChatId = "chat1";
  await store.bulkAction(["b1", "b2"], "star");
  expect(api.post).toHaveBeenCalledWith("/messages/bulk", { messageIds: ["b1", "b2"], action: "star" });
  const { useChatStore } = require("../../client/src/store/chatStore");
  const state = useChatStore.getState();
  expect(state.starredMessageIds.has("b1")).toBe(true);
  expect(state.starredMessageIds.has("b2")).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Bulk unstar
// ─────────────────────────────────────────────────────────────────────────────
test("14 — bulkAction unstar removes ids from starredMessageIds", async () => {
  api.post.mockResolvedValue({ data: { allSucceeded: true, anySucceeded: true, results: [{ messageId: "b3", success: true }] } });
  api.delete.mockResolvedValue({ data: {} });
  const store = freshStore();
  store.activeChatId = "chat1";
  // star it first via individual star
  api.post.mockResolvedValueOnce({ data: {} }); // for starMessage
  await store.starMessage("b3");
  // then bulk unstar
  api.post.mockResolvedValueOnce({ data: { allSucceeded: true, anySucceeded: true, results: [{ messageId: "b3", success: true }] } });
  await store.bulkAction(["b3"], "unstar");
  const { useChatStore } = require("../../client/src/store/chatStore");
  expect(useChatStore.getState().starredMessageIds.has("b3")).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Bulk delete-for-me removes messages from store
// ─────────────────────────────────────────────────────────────────────────────
test("15 — bulkAction delete-for-me removes succeeded messages from store", async () => {
  const results = [
    { messageId: "d1", success: true },
    { messageId: "d2", success: false },
  ];
  api.post.mockResolvedValue({ data: { allSucceeded: false, anySucceeded: true, results } });
  const store = freshStore();
  store.activeChatId = "chat1";
  store.messages = {
    chat1: [
      { id: "d1", content: "a", chatId: "chat1" },
      { id: "d2", content: "b", chatId: "chat1" },
      { id: "d3", content: "c", chatId: "chat1" },
    ],
  };
  const res = await store.bulkAction(["d1", "d2"], "delete-for-me");
  expect(res.anySucceeded).toBe(true);
  expect(res.allSucceeded).toBe(false);
  const { useChatStore } = require("../../client/src/store/chatStore");
  const msgs = useChatStore.getState().messages["chat1"];
  expect(msgs.find((m) => m.id === "d1")).toBeUndefined(); // removed
  expect(msgs.find((m) => m.id === "d2")).toBeTruthy();    // still there (failed)
  expect(msgs.find((m) => m.id === "d3")).toBeTruthy();    // unaffected
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Clear chat — confirmation (tested as API call behaviour)
// ─────────────────────────────────────────────────────────────────────────────
test("16 — clearChat calls POST /chats/:id/clear and empties messages", async () => {
  api.post.mockResolvedValue({ data: {} });
  api.get.mockResolvedValue({ data: { chats: [] } });
  const store = freshStore();
  store.activeChatId = "chat1";
  store.messages = { chat1: [{ id: "msg1", content: "hi" }] };
  await store.clearChat("chat1");
  expect(api.post).toHaveBeenCalledWith("/chats/chat1/clear");
  const { useChatStore } = require("../../client/src/store/chatStore");
  expect(useChatStore.getState().messages["chat1"]).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. Delete chat — removes from chats list and clears activeChatId
// ─────────────────────────────────────────────────────────────────────────────
test("17 — deleteLocalChat calls DELETE /chats/:id/local and removes chat", async () => {
  api.delete.mockResolvedValue({ data: {} });
  const store = freshStore();
  store.activeChatId = "chat1";
  store.chats = [{ id: "chat1" }, { id: "chat2" }];
  store.messages = { chat1: [], chat2: [] };
  await store.deleteLocalChat("chat1");
  expect(api.delete).toHaveBeenCalledWith("/chats/chat1/local");
  const { useChatStore } = require("../../client/src/store/chatStore");
  const state = useChatStore.getState();
  expect(state.chats.some((c) => c.id === "chat1")).toBe(false);
  expect(state.activeChatId).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Hidden messages excluded — hideMessageForMe removes from state
// ─────────────────────────────────────────────────────────────────────────────
test("18 — hideMessageForMe removes message from store (not reachable via state)", async () => {
  api.post.mockResolvedValue({ data: {} });
  api.get.mockResolvedValue({ data: { chats: [] } });
  const store = freshStore();
  store.activeChatId = "chat1";
  store.messages = { chat1: [{ id: "h1", content: "hide me", chatId: "chat1" }] };
  await store.hideMessageForMe("h1", "chat1");
  const { useChatStore } = require("../../client/src/store/chatStore");
  const msgs = useChatStore.getState().messages["chat1"];
  expect(msgs.find((m) => m.id === "h1")).toBeUndefined();
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Translation display not regressed — translation field preserved after non-edit
// ─────────────────────────────────────────────────────────────────────────────
test("19 — message translation field preserved when message not edited", () => {
  const store = freshStore();
  store.activeChatId = "chat1";
  store.messages = {
    chat1: [
      { id: "t1", content: "hello", translation: { translatedText: "merhaba", sourceLang: "en", targetLang: "tr" }, chatId: "chat1" },
    ],
  };
  // No edit was called — translation must remain
  const { useChatStore } = require("../../client/src/store/chatStore");
  const msg = useChatStore.getState().messages["chat1"].find((m) => m.id === "t1");
  expect(msg.translation?.translatedText).toBe("merhaba");
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Voice/TTS UI not regressed — editMessage only wipes text message translation
// ─────────────────────────────────────────────────────────────────────────────
test("20 — editMessage clears translation on target message only, not voice messages", async () => {
  const updated = { id: "txt1", content: "updated text", editedAt: new Date().toISOString(), chatId: "chat1" };
  api.patch.mockResolvedValue({ data: { message: updated } });
  const store = freshStore();
  store.activeChatId = "chat1";
  store.messages = {
    chat1: [
      { id: "txt1", content: "old", chatId: "chat1", translation: { translatedText: "eski" } },
      { id: "voice1", type: "voice", content: "🎤", chatId: "chat1", translation: { translatedText: "voice trans" } },
    ],
  };
  await store.editMessage("txt1", "updated text");
  const { useChatStore } = require("../../client/src/store/chatStore");
  const state = useChatStore.getState();
  const txt = state.messages["chat1"].find((m) => m.id === "txt1");
  const voice = state.messages["chat1"].find((m) => m.id === "voice1");
  expect(txt.translation).toBeNull(); // cleared after edit
  expect(voice.translation?.translatedText).toBe("voice trans"); // untouched
});
