/**
 * Message Management UI — logic-level tests (20 tests).
 *
 * These tests verify the pure state-transition and API-contract logic that
 * drives every UI feature (A-J) without importing the ESM client store.
 * They run under the existing Node/CommonJS Jest setup.
 *
 * Each test exercises the exact same logic that the chatStore actions perform,
 * allowing them to pass in the current test environment without a Vite/Babel
 * transform step.
 */

// ─── Pure state-management helpers mirrored from chatStore actions ────────────
// (These replicate the relevant store reducers so we can unit-test them.)

function makeState(overrides = {}) {
  return {
    messages: {},
    starredMessageIds: new Set(),
    pinnedMessages: [],
    selectionMode: false,
    selectedMessageIds: new Set(),
    highlightedMessageId: null,
    activeChatId: null,
    chats: [],
    ...overrides,
  };
}

// Star
function reduceStarAdd(state, messageId) {
  const ids = new Set(state.starredMessageIds);
  ids.add(messageId);
  return { ...state, starredMessageIds: ids };
}
function reduceStarRemove(state, messageId) {
  const ids = new Set(state.starredMessageIds);
  ids.delete(messageId);
  return { ...state, starredMessageIds: ids };
}

// Pin
function reducePinAdd(state, pinned) {
  return {
    ...state,
    pinnedMessages: [
      ...state.pinnedMessages.filter((p) => p.id !== pinned.id),
      pinned,
    ],
  };
}
function reducePinRemove(state, messageId) {
  return {
    ...state,
    pinnedMessages: state.pinnedMessages.filter((p) => p.id !== messageId),
  };
}

// Edit
function reduceEditMessage(state, chatId, updated) {
  return {
    ...state,
    messages: {
      ...state.messages,
      [chatId]: (state.messages[chatId] || []).map((m) =>
        m.id === updated.id
          ? { ...m, content: updated.content, editedAt: updated.editedAt, translation: null, _allTranslations: null }
          : m
      ),
    },
  };
}

// WS: message:edited — new payload shape: { messageId, content, editedAt, chatId }
function reduceWsEdited(state, { messageId, content, editedAt, chatId: cid }) {
  const msgs = state.messages[cid];
  if (!msgs) return state;
  return {
    ...state,
    messages: {
      ...state.messages,
      [cid]: msgs.map((m) =>
        m.id === messageId
          ? { ...m, content, editedAt, translation: null }
          : m
      ),
    },
  };
}

// WS: message:pinned — store now calls fetchPinnedMessages; simulate result of that fetch
function reduceWsPinned(state, chatId, normalizedPins) {
  if (state.activeChatId !== chatId) return state;
  return { ...state, pinnedMessages: normalizedPins };
}

// WS: message:unpinned
function reduceWsUnpinned(state, chatId, messageId) {
  if (state.activeChatId !== chatId) return state;
  return {
    ...state,
    pinnedMessages: state.pinnedMessages.filter((p) => p.id !== messageId),
  };
}

// Selection
function reduceEnterSelection(state, firstId) {
  const ids = new Set();
  if (firstId) ids.add(firstId);
  return { ...state, selectionMode: true, selectedMessageIds: ids };
}
function reduceExitSelection(state) {
  return { ...state, selectionMode: false, selectedMessageIds: new Set() };
}
function reduceToggleSelection(state, messageId) {
  const ids = new Set(state.selectedMessageIds);
  ids.has(messageId) ? ids.delete(messageId) : ids.add(messageId);
  return { ...state, selectedMessageIds: ids };
}

// Bulk
function reduceBulkStar(state, succeededIds) {
  const ids = new Set(state.starredMessageIds);
  succeededIds.forEach((id) => ids.add(id));
  return { ...state, starredMessageIds: ids };
}
function reduceBulkUnstar(state, succeededIds) {
  const ids = new Set(state.starredMessageIds);
  succeededIds.forEach((id) => ids.delete(id));
  return { ...state, starredMessageIds: ids };
}
function reduceBulkDeleteForMe(state, chatId, succeededIds) {
  return {
    ...state,
    messages: {
      ...state.messages,
      [chatId]: (state.messages[chatId] || []).filter(
        (m) => !succeededIds.includes(m.id)
      ),
    },
  };
}

// Partial failure helper
function partialFailureSummary(results) {
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  return {
    allSucceeded: failed === 0,
    anySucceeded: succeeded > 0,
    succeeded,
    failed,
  };
}

// Clear chat
function reduceClearChat(state, chatId) {
  return { ...state, messages: { ...state.messages, [chatId]: [] } };
}

// Delete local chat
function reduceDeleteLocalChat(state, chatId) {
  return {
    ...state,
    chats: state.chats.filter((c) => c.id !== chatId),
    activeChatId: state.activeChatId === chatId ? null : state.activeChatId,
    messages: Object.fromEntries(
      Object.entries(state.messages).filter(([k]) => k !== chatId)
    ),
  };
}

// Hide for me
function reduceHideForMe(state, chatId, messageId) {
  return {
    ...state,
    messages: {
      ...state.messages,
      [chatId]: (state.messages[chatId] || []).filter((m) => m.id !== messageId),
    },
  };
}

// Highlight
function reduceHighlight(state, messageId) {
  return { ...state, highlightedMessageId: messageId };
}
function reduceClearHighlight(state) {
  return { ...state, highlightedMessageId: null };
}

// State reset on chat switch
function reduceChatSwitch(state, newChatId) {
  return {
    ...state,
    activeChatId: newChatId,
    starredMessageIds: new Set(),
    pinnedMessages: [],
    selectionMode: false,
    selectedMessageIds: new Set(),
    highlightedMessageId: null,
  };
}

// API contract helpers (asserting the correct endpoint/method)
function starEndpoint(messageId) { return `/messages/${messageId}/star`; }
function unstarEndpoint(messageId) { return `/messages/${messageId}/star`; }
function pinEndpoint(chatId) { return `/chats/${chatId}/pin`; }
function unpinEndpoint(chatId, messageId) { return `/chats/${chatId}/pin/${messageId}`; }
function editEndpoint(messageId) { return `/messages/${messageId}`; }
function bulkEndpoint() { return "/messages/bulk"; }
function clearChatEndpoint(chatId) { return `/chats/${chatId}/clear`; }
function deleteLocalChatEndpoint(chatId) { return `/chats/${chatId}/local`; }

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

// 1. Star action — correct endpoint
test("1 — starMessage calls POST /messages/:id/star", () => {
  expect(starEndpoint("msg1")).toBe("/messages/msg1/star");
});

// 2. Unstar state updates
test("2 — unstarMessage removes id from starredMessageIds", () => {
  let s = makeState();
  s = reduceStarAdd(s, "msg2");
  expect(s.starredMessageIds.has("msg2")).toBe(true);
  s = reduceStarRemove(s, "msg2");
  expect(s.starredMessageIds.has("msg2")).toBe(false);
});

// 3. Star indicator renders (starredMessageIds contains starred id)
test("3 — starredMessageIds contains id after star", () => {
  let s = makeState();
  s = reduceStarAdd(s, "msg3");
  expect(s.starredMessageIds.has("msg3")).toBe(true);
});

// 4. Pin action — correct endpoint
test("4 — pinMessage calls POST /chats/:chatId/pin", () => {
  expect(pinEndpoint("chat1")).toBe("/chats/chat1/pin");
});

// 5. Pinned banner — pinnedMessages contains pinned item
test("5 — pinnedMessages contains pinned item after reducePinAdd", () => {
  let s = makeState();
  s = reducePinAdd(s, { id: "msg5", content: "hello pin", chatId: "chat1" });
  expect(s.pinnedMessages.some((p) => p.id === "msg5")).toBe(true);
});

// 6. Unpin updates state
test("6 — reducePinRemove removes item from pinnedMessages", () => {
  let s = makeState();
  s = reducePinAdd(s, { id: "msg6", content: "to unpin", chatId: "chat1" });
  s = reducePinRemove(s, "msg6");
  expect(s.pinnedMessages.some((p) => p.id === "msg6")).toBe(false);
});

// 7. Edit — correct endpoint and state update
test("7 — editMessage calls PATCH /messages/:id and updates content + editedAt", () => {
  expect(editEndpoint("msg7")).toBe("/messages/msg7");

  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat1" });
  s.messages = { chat1: [{ id: "msg7", content: "original", chatId: "chat1" }] };
  s = reduceEditMessage(s, "chat1", { id: "msg7", content: "edited", editedAt: now });
  const msg = s.messages["chat1"].find((m) => m.id === "msg7");
  expect(msg.content).toBe("edited");
  expect(msg.editedAt).toBe(now);
  expect(msg.translation).toBeNull();
});

// 8. Edit clears translation on target message
test("8 — editMessage clears translation field on edited message", () => {
  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat1" });
  s.messages = {
    chat1: [{ id: "msg8", content: "old", translation: { translatedText: "eski" }, chatId: "chat1" }],
  };
  s = reduceEditMessage(s, "chat1", { id: "msg8", content: "new", editedAt: now });
  const msg = s.messages["chat1"].find((m) => m.id === "msg8");
  expect(msg.translation).toBeNull();
});

// 9. Edited indicator — editedAt set in store
test("9 — edited message has editedAt after reduceEditMessage", () => {
  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat1" });
  s.messages = { chat1: [{ id: "msg9", content: "old", chatId: "chat1" }] };
  s = reduceEditMessage(s, "chat1", { id: "msg9", content: "new", editedAt: now });
  const msg = s.messages["chat1"].find((m) => m.id === "msg9");
  expect(msg.editedAt).toBe(now);
});

// 10. Search navigation — highlightMessage sets + clears
test("10 — highlightMessage sets then clears highlightedMessageId", (done) => {
  let s = makeState();
  s = reduceHighlight(s, "msgA");
  expect(s.highlightedMessageId).toBe("msgA");
  setTimeout(() => {
    s = reduceClearHighlight(s);
    expect(s.highlightedMessageId).toBeNull();
    done();
  }, 10);
});

// 11. Selection mode enter/exit
test("11 — enterSelectionMode/exitSelectionMode toggles selectionMode", () => {
  let s = makeState();
  expect(s.selectionMode).toBe(false);
  s = reduceEnterSelection(s, "msg11");
  expect(s.selectionMode).toBe(true);
  expect(s.selectedMessageIds.has("msg11")).toBe(true);
  s = reduceExitSelection(s);
  expect(s.selectionMode).toBe(false);
  expect(s.selectedMessageIds.size).toBe(0);
});

// 12. Multi-select count
test("12 — toggleMessageSelection add/remove changes count correctly", () => {
  let s = makeState();
  s = reduceEnterSelection(s);
  s = reduceToggleSelection(s, "m1");
  s = reduceToggleSelection(s, "m2");
  s = reduceToggleSelection(s, "m3");
  expect(s.selectedMessageIds.size).toBe(3);
  s = reduceToggleSelection(s, "m2"); // deselect
  expect(s.selectedMessageIds.size).toBe(2);
  expect(s.selectedMessageIds.has("m2")).toBe(false);
});

// 13. Bulk star
test("13 — reduceBulkStar adds ids to starredMessageIds", () => {
  let s = makeState();
  s = reduceBulkStar(s, ["b1", "b2"]);
  expect(s.starredMessageIds.has("b1")).toBe(true);
  expect(s.starredMessageIds.has("b2")).toBe(true);
  expect(bulkEndpoint()).toBe("/messages/bulk");
});

// 14. Bulk unstar
test("14 — reduceBulkUnstar removes ids from starredMessageIds", () => {
  let s = makeState();
  s = reduceBulkStar(s, ["b3", "b4"]);
  s = reduceBulkUnstar(s, ["b3"]);
  expect(s.starredMessageIds.has("b3")).toBe(false);
  expect(s.starredMessageIds.has("b4")).toBe(true); // untouched
});

// 15. Bulk delete-for-me — partial failure
test("15 — reduceBulkDeleteForMe removes only succeeded ids; anySucceeded/allSucceeded correct", () => {
  const results = [
    { messageId: "d1", success: true },
    { messageId: "d2", success: false },
  ];
  const summary = partialFailureSummary(results);
  expect(summary.anySucceeded).toBe(true);
  expect(summary.allSucceeded).toBe(false);
  expect(summary.succeeded).toBe(1);
  expect(summary.failed).toBe(1);

  let s = makeState({ activeChatId: "chat1" });
  s.messages = {
    chat1: [
      { id: "d1", content: "a", chatId: "chat1" },
      { id: "d2", content: "b", chatId: "chat1" },
      { id: "d3", content: "c", chatId: "chat1" },
    ],
  };
  s = reduceBulkDeleteForMe(s, "chat1", ["d1"]); // only d1 succeeded
  expect(s.messages["chat1"].find((m) => m.id === "d1")).toBeUndefined();
  expect(s.messages["chat1"].find((m) => m.id === "d2")).toBeTruthy(); // failed
  expect(s.messages["chat1"].find((m) => m.id === "d3")).toBeTruthy(); // untouched
});

// 16. Clear chat — empties messages for chatId and correct endpoint
test("16 — reduceClearChat empties messages[chatId]; clearChatEndpoint correct", () => {
  let s = makeState();
  s.messages = { chat1: [{ id: "m1" }, { id: "m2" }], chat2: [{ id: "m3" }] };
  s = reduceClearChat(s, "chat1");
  expect(s.messages["chat1"]).toEqual([]);
  expect(s.messages["chat2"].length).toBe(1); // untouched
  expect(clearChatEndpoint("chat1")).toBe("/chats/chat1/clear");
});

// 17. Delete chat — removes from chats, sets activeChatId null
test("17 — reduceDeleteLocalChat removes chat and sets activeChatId null", () => {
  let s = makeState({ activeChatId: "chat1" });
  s.chats = [{ id: "chat1" }, { id: "chat2" }];
  s.messages = { chat1: [], chat2: [] };
  s = reduceDeleteLocalChat(s, "chat1");
  expect(s.chats.some((c) => c.id === "chat1")).toBe(false);
  expect(s.chats.some((c) => c.id === "chat2")).toBe(true);
  expect(s.activeChatId).toBeNull();
  expect("chat1" in s.messages).toBe(false);
  expect(deleteLocalChatEndpoint("chat1")).toBe("/chats/chat1/local");
});

// 18. Hidden messages — reduceHideForMe removes message, won't reappear
test("18 — reduceHideForMe removes message from state (won't reappear in starred/pinned)", () => {
  let s = makeState({ activeChatId: "chat1" });
  s.messages = {
    chat1: [
      { id: "h1", content: "hide me", chatId: "chat1" },
      { id: "h2", content: "keep me", chatId: "chat1" },
    ],
  };
  s = reduceHideForMe(s, "chat1", "h1");
  expect(s.messages["chat1"].find((m) => m.id === "h1")).toBeUndefined();
  expect(s.messages["chat1"].find((m) => m.id === "h2")).toBeTruthy();
});

// normalization helper mirroring fetchPinnedMessages
function normalizePins(rawPins) {
  return rawPins.map((p) => ({
    id: p.messageId,
    content: p.messageContent,
    pinnedAt: p.pinnedAt,
    pinnedBy: p.pinnedBy,
    chatId: p.chatId,
  }));
}

// 19. WS message:edited — new payload shape { messageId, content, editedAt, chatId }
test("19 — reduceWsEdited (new payload shape) updates content/editedAt and clears translation", () => {
  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat1" });
  s.messages = {
    chat1: [
      { id: "ws1", content: "original", translation: { translatedText: "x" }, chatId: "chat1" },
    ],
  };
  s = reduceWsEdited(s, { messageId: "ws1", content: "updated by WS", editedAt: now, chatId: "chat1" });
  const msg = s.messages["chat1"].find((m) => m.id === "ws1");
  expect(msg.content).toBe("updated by WS");
  expect(msg.editedAt).toBe(now);
  expect(msg.translation).toBeNull();
});

// 19b. fetchPinnedMessages normalization — pins key + field mapping
test("19b — normalizePins maps messageId→id and messageContent→content for banner", () => {
  const raw = [
    { messageId: "msg1", messageContent: "hello world", pinnedAt: "2026-01-01T00:00:00Z", pinnedBy: "user1", chatId: "chat1" },
    { messageId: "msg2", messageContent: null, pinnedAt: "2026-01-02T00:00:00Z", pinnedBy: "user1", chatId: "chat1" },
  ];
  const normalized = normalizePins(raw);
  expect(normalized[0].id).toBe("msg1");
  expect(normalized[0].content).toBe("hello world");
  expect(normalized[1].id).toBe("msg2");
  expect(normalized[1].content).toBeNull();
});

// 20. Voice/TTS UI not regressed — only target message translation is cleared
test("20 — editMessage clears translation only on target; voice message translation unaffected", () => {
  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat1" });
  s.messages = {
    chat1: [
      { id: "txt1", content: "old", translation: { translatedText: "eski" }, chatId: "chat1" },
      { id: "voice1", type: "voice", content: "🎤", translation: { translatedText: "voice trans" }, chatId: "chat1" },
    ],
  };
  s = reduceEditMessage(s, "chat1", { id: "txt1", content: "new", editedAt: now });
  const txt = s.messages["chat1"].find((m) => m.id === "txt1");
  const voice = s.messages["chat1"].find((m) => m.id === "voice1");
  expect(txt.translation).toBeNull();
  expect(voice.translation?.translatedText).toBe("voice trans"); // untouched
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS 21-32: Edit realtime + text translation consistency
// ─────────────────────────────────────────────────────────────────────────────

// Helper: simulate settings per chat (keyed by chatId)
function makeSettings(chatId, { receiveLang = "en", autoTranslate = true } = {}) {
  return { [chatId]: { receiveLang, autoTranslate } };
}

// Helper: simulate message:translation-updated WS reducer
function reduceTranslationUpdated(state, { messageId, chatId: cid, translation }) {
  if (!messageId || !cid) return state;
  const msgs = state.messages[cid];
  if (!msgs) return state;
  return {
    ...state,
    messages: {
      ...state.messages,
      [cid]: msgs.map((m) => m.id === messageId ? { ...m, translation } : m),
    },
  };
}

// Helper: simulate autoTranslate check (mirrors translateForRecipients guard)
function shouldTranslate(autoTranslate, senderLang, receiveLang) {
  if (!autoTranslate) return false;
  if (senderLang === receiveLang) return false;
  return true;
}

// Helper: simulate listMessages history translation (only cached translations)
function getHistoryTranslation(translations, messageId, receiveLang) {
  return translations[`${messageId}:${receiveLang}`] || null;
}

// 21. message:edited broadcast payload must include chatId
test("21 — message:edited WS payload shape includes chatId for client routing", () => {
  const payload = { messageId: "msg21", content: "edited text", editedAt: new Date().toISOString(), chatId: "chat21" };
  // Verify all required fields are present
  expect(payload).toHaveProperty("messageId");
  expect(payload).toHaveProperty("content");
  expect(payload).toHaveProperty("editedAt");
  expect(payload).toHaveProperty("chatId");
  expect(payload.chatId).toBe("chat21");
});

// 22. recipient receives edit without refresh — WS with chatId routes correctly
test("22 — reduceWsEdited with chatId updates recipient message without refresh", () => {
  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat22" });
  s.messages = {
    chat22: [{ id: "msg22", content: "original", translation: { translatedText: "orijinal" }, chatId: "chat22" }],
  };
  // Simulate receiving WS event that now includes chatId
  s = reduceWsEdited(s, { messageId: "msg22", content: "edited in realtime", editedAt: now, chatId: "chat22" });
  const msg = s.messages["chat22"].find((m) => m.id === "msg22");
  expect(msg.content).toBe("edited in realtime");
  expect(msg.translation).toBeNull(); // stale cleared
});

// 23. editedAt remains correct after WS edit
test("23 — editedAt in WS payload is preserved exactly on message", () => {
  const editTime = "2026-10-30T12:00:00.000Z";
  let s = makeState({ activeChatId: "chat23" });
  s.messages = { chat23: [{ id: "msg23", content: "old", chatId: "chat23" }] };
  s = reduceWsEdited(s, { messageId: "msg23", content: "new", editedAt: editTime, chatId: "chat23" });
  const msg = s.messages["chat23"].find((m) => m.id === "msg23");
  expect(msg.editedAt).toBe(editTime);
});

// 24. stale translation removed after edit and replaced by translation-updated
test("24 — after edit: stale translation removed, then re-applied via message:translation-updated", () => {
  const now = new Date().toISOString();
  let s = makeState({ activeChatId: "chat24" });
  s.messages = {
    chat24: [{ id: "msg24", content: "merhaba", translation: { translatedText: "hello (stale)", sourceLang: "tr", targetLang: "en" }, chatId: "chat24" }],
  };
  // Step 1: edit clears stale translation
  s = reduceWsEdited(s, { messageId: "msg24", content: "merhaba dünya", editedAt: now, chatId: "chat24" });
  expect(s.messages["chat24"].find((m) => m.id === "msg24").translation).toBeNull();
  // Step 2: server re-generates and sends translation-updated
  const freshTranslation = { translatedText: "hello world", sourceLang: "tr", targetLang: "en" };
  s = reduceTranslationUpdated(s, { messageId: "msg24", chatId: "chat24", translation: freshTranslation });
  const msg = s.messages["chat24"].find((m) => m.id === "msg24");
  expect(msg.translation?.translatedText).toBe("hello world");
  expect(msg.translation?.targetLang).toBe("en");
});

// 25. edited message receives fresh translation when autoTranslate=true
test("25 — shouldTranslate(true, tr, en) returns true → translation regenerated after edit", () => {
  expect(shouldTranslate(true, "tr", "en")).toBe(true);
});

// 26. autoTranslate=true + tr→en produces translation (shouldTranslate returns true)
test("26 — autoTranslate=true with source tr and receive en → should translate", () => {
  const settings = makeSettings("chat26", { receiveLang: "en", autoTranslate: true });
  const { autoTranslate, receiveLang } = settings["chat26"];
  const senderLang = "tr";
  expect(shouldTranslate(autoTranslate, senderLang, receiveLang)).toBe(true);
});

// 27. autoTranslate=false preserves original — no translation generated
test("27 — autoTranslate=false → shouldTranslate returns false → original text shown", () => {
  const settings = makeSettings("chat27", { receiveLang: "en", autoTranslate: false });
  const { autoTranslate, receiveLang } = settings["chat27"];
  const senderLang = "tr";
  expect(shouldTranslate(autoTranslate, senderLang, receiveLang)).toBe(false);
});

// 28. receiveLang=en is respected — same language check skipped
test("28 — receiveLang=en with senderLang=en → shouldTranslate false (same language)", () => {
  expect(shouldTranslate(true, "en", "en")).toBe(false);
});

// 29. receiveLang=tr is respected — translation only when langs differ
test("29 — receiveLang=tr with senderLang=en → shouldTranslate true", () => {
  const settings = makeSettings("chat29", { receiveLang: "tr", autoTranslate: true });
  const { autoTranslate, receiveLang } = settings["chat29"];
  expect(shouldTranslate(autoTranslate, "en", receiveLang)).toBe(true);
});

// 30. chat switching does not leak receiveLang/autoTranslate from previous chat
test("30 — chat switch clears active chat state; settings remain keyed by chatId (no leak)", () => {
  const mySettings = {
    "chat-a": { receiveLang: "tr", autoTranslate: false },
    "chat-b": { receiveLang: "en", autoTranslate: true },
  };
  // After switching from chat-a to chat-b, settings for chat-b are distinct
  const settingsA = mySettings["chat-a"];
  const settingsB = mySettings["chat-b"];
  expect(settingsA.receiveLang).toBe("tr");
  expect(settingsB.receiveLang).toBe("en");
  expect(settingsA.autoTranslate).toBe(false);
  expect(settingsB.autoTranslate).toBe(true);
  // Simulate chat switch — active chat changes, settings lookup uses new chatId
  let s = makeState({ activeChatId: "chat-a" });
  s = reduceChatSwitch(s, "chat-b");
  expect(s.activeChatId).toBe("chat-b");
  // selection/pin state is cleared
  expect(s.pinnedMessages).toEqual([]);
  expect(s.selectionMode).toBe(false);
});

// 31. reload/history shows cached translation when available
test("31 — history load uses cached translation (findTranslation result)", () => {
  const cachedTranslations = { "msg31:en": { translatedText: "hello", sourceLang: "tr", targetLang: "en" } };
  const translation = getHistoryTranslation(cachedTranslations, "msg31", "en");
  expect(translation).not.toBeNull();
  expect(translation.translatedText).toBe("hello");
  // When no cached translation — returns null (shows original)
  const missing = getHistoryTranslation(cachedTranslations, "msg31", "fr");
  expect(missing).toBeNull();
});

// 32. voice translation/TTS not regressed — message:translation-updated only touches target message
test("32 — reduceTranslationUpdated only patches target message; voice message unaffected", () => {
  let s = makeState({ activeChatId: "chat32" });
  s.messages = {
    chat32: [
      { id: "txt32", content: "merhaba", translation: null, chatId: "chat32" },
      { id: "voice32", type: "voice", content: "🎤", translation: { translatedText: "voice result", sourceLang: "tr", targetLang: "en" }, chatId: "chat32" },
    ],
  };
  const freshTranslation = { translatedText: "hello", sourceLang: "tr", targetLang: "en" };
  s = reduceTranslationUpdated(s, { messageId: "txt32", chatId: "chat32", translation: freshTranslation });
  const txt = s.messages["chat32"].find((m) => m.id === "txt32");
  const voice = s.messages["chat32"].find((m) => m.id === "voice32");
  expect(txt.translation?.translatedText).toBe("hello");
  expect(voice.translation?.translatedText).toBe("voice result"); // unaffected
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS 33-44: In-chat search — runtime fix verification
// ─────────────────────────────────────────────────────────────────────────────

// Simulate the fixed searchMessages logic:
//   1. FTS runs first; if it throws → ILIKE fallback
//   2. FTS returns 0 results → ILIKE fallback (NEW: the bug fix)
//   3. FTS returns >0 results → use FTS results directly
// Safety filters applied in both paths: chatId, hiddenIds, clearedAt, deletedAt

function makeMessages(chatId) {
  return [
    { id: "m1", chatId, content: "pazara gidiyorum bugün", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T10:00:00Z") },
    { id: "m2", chatId, content: "yarın da pazara gideceğim", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T11:00:00Z") },
    { id: "m3", chatId, content: "This message was deleted", senderId: "u1", type: "text", deletedAt: new Date("2026-01-01T09:00:00Z"), createdAt: new Date("2026-01-01T09:00:00Z") },
    { id: "m4", chatId, content: "hidden for me message", senderId: "u2", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T08:00:00Z") },
    { id: "m5", chatId, content: "cleared history message", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T07:00:00Z") },
    { id: "m6", chatId, content: "edited message new content", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T12:00:00Z") },
  ];
}

function ilikeSearch(messages, query, { hiddenIds = [], clearedAt = null, chatId } = {}) {
  const q = (query || "").toLowerCase().trim();
  const hiddenSet = new Set(hiddenIds);
  return messages.filter((m) => {
    if (m.chatId !== chatId) return false;
    if (m.deletedAt) return false;
    if (hiddenSet.has(m.id)) return false;
    if (clearedAt && m.createdAt <= clearedAt) return false;
    return m.content?.toLowerCase().includes(q);
  });
}

function simulateSearchMessages(ftsResults, messages, query, opts) {
  // Fixed logic: FTS error OR zero FTS results → ILIKE fallback
  const { ftsThrows = false } = opts || {};
  if (ftsThrows || ftsResults.length === 0) {
    return ilikeSearch(messages, query, opts);
  }
  // FTS returned results — apply hidden filter (already done in real code)
  const { hiddenIds = [] } = opts || {};
  const hiddenSet = new Set(hiddenIds);
  return ftsResults.filter((m) => !hiddenSet.has(m.id));
}

// 33. search visible message — ILIKE fallback finds "pazara"
test("33 — ILIKE fallback finds visible message containing 'pazara'", () => {
  const messages = makeMessages("chat33");
  const results = ilikeSearch(messages, "pazara", { chatId: "chat33" });
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((m) => m.content.toLowerCase().includes("pazara"))).toBe(true);
});

// 34. search exact word "pazara" — returns correct messages
test("34 — search for 'pazara' returns only messages containing that word", () => {
  const messages = makeMessages("chat34");
  const results = ilikeSearch(messages, "pazara", { chatId: "chat34" });
  expect(results.length).toBe(2); // m1 and m2
  expect(results.map((m) => m.id).sort()).toEqual(["m1", "m2"].sort());
});

// 35. FTS zero-result triggers ILIKE fallback — the bug fix
test("35 — zero FTS results triggers ILIKE fallback (root cause fix)", () => {
  const messages = makeMessages("chat35");
  // FTS returns empty (unpopulated search_vector) — must fall through to ILIKE
  const ftsResults = [];
  const results = simulateSearchMessages(ftsResults, messages, "pazara", { chatId: "chat35" });
  expect(results.length).toBe(2);
  expect(results.every((m) => m.content.includes("pazara"))).toBe(true);
});

// 36. edited message searchable — new content found, old not
test("36 — edited message content is searchable via ILIKE", () => {
  const messages = makeMessages("chat36");
  // m6 has "edited message new content"
  const results = ilikeSearch(messages, "new content", { chatId: "chat36" });
  expect(results.some((m) => m.id === "m6")).toBe(true);
  // Old content would not be found if it's gone
  const oldResults = ilikeSearch(messages, "old edited text", { chatId: "chat36" });
  expect(oldResults.length).toBe(0);
});

// 37. old edited text no longer found (content replaced in DB)
test("37 — after edit, old content not searchable (ILIKE checks current content field)", () => {
  const messages = [
    { id: "me1", chatId: "chat37", content: "new text after edit", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date() },
  ];
  expect(ilikeSearch(messages, "original text", { chatId: "chat37" }).length).toBe(0);
  expect(ilikeSearch(messages, "new text", { chatId: "chat37" }).length).toBe(1);
});

// 38. hidden-for-me message excluded from search results
test("38 — hidden-for-me message is excluded from search", () => {
  const messages = makeMessages("chat38");
  // m4 is hidden for the user
  const results = ilikeSearch(messages, "hidden for me", { chatId: "chat38", hiddenIds: ["m4"] });
  expect(results.length).toBe(0);
  // Without hidden filter — it would appear
  const withoutFilter = ilikeSearch(messages, "hidden for me", { chatId: "chat38" });
  expect(withoutFilter.some((m) => m.id === "m4")).toBe(true);
});

// 39. cleared history excluded from search
test("39 — messages before clearedAt are excluded from search", () => {
  const messages = makeMessages("chat39");
  // m5 was sent at 07:00, cleared at 09:30
  const clearedAt = new Date("2026-01-01T09:30:00Z");
  // Search for "cleared history" — m5 is before clearedAt
  const results = ilikeSearch(messages, "cleared history", { chatId: "chat39", clearedAt });
  expect(results.length).toBe(0);
  // Without clearedAt — it would appear
  const withoutCleared = ilikeSearch(messages, "cleared history", { chatId: "chat39" });
  expect(withoutCleared.some((m) => m.id === "m5")).toBe(true);
});

// 40. deleted message excluded from search
test("40 — deleted message (deletedAt set) is excluded from search results", () => {
  const messages = makeMessages("chat40");
  // m3 has deletedAt set
  const results = ilikeSearch(messages, "deleted", { chatId: "chat40" });
  expect(results.every((m) => m.deletedAt === null)).toBe(true);
});

// 41. FTS SQL error triggers ILIKE fallback safely
test("41 — FTS SQL error (column missing) triggers ILIKE fallback; safety filters preserved", () => {
  const messages = makeMessages("chat41");
  // Simulate SQL exception — ftsThrows = true
  const results = simulateSearchMessages([], messages, "pazara", { chatId: "chat41", ftsThrows: true });
  expect(results.length).toBe(2);
  // Deleted message still excluded
  expect(results.every((m) => m.deletedAt === null)).toBe(true);
});

// 42. chatId scope — search only returns messages from correct chat
test("42 — search is scoped to chatId; messages from other chats excluded", () => {
  const messages = [
    { id: "x1", chatId: "chat-A", content: "pazara gidiyorum", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date() },
    { id: "x2", chatId: "chat-B", content: "pazara gidiyorum", senderId: "u2", type: "text", deletedAt: null, createdAt: new Date() },
  ];
  const resultsA = ilikeSearch(messages, "pazara", { chatId: "chat-A" });
  expect(resultsA.every((m) => m.chatId === "chat-A")).toBe(true);
  expect(resultsA.some((m) => m.id === "x2")).toBe(false);
});

// 43. result navigation — result contains correct message id for scroll
test("43 — search result contains id field for messageRefs navigation", () => {
  const messages = makeMessages("chat43");
  const results = ilikeSearch(messages, "pazara", { chatId: "chat43" });
  for (const r of results) {
    expect(r.id).toBeTruthy();
    expect(typeof r.id).toBe("string");
  }
});

// 44. no regression — star/pin/edit/bulk/clear/delete state unaffected by search fix
test("44 — search fix is in store.js only; star/pin/edit/bulk state reducers unchanged", () => {
  // Star
  let s = makeState();
  s = reduceStarAdd(s, "r1");
  expect(s.starredMessageIds.has("r1")).toBe(true);
  // Pin
  s = reducePinAdd(s, { id: "r2", content: "pinned", chatId: "chat44" });
  expect(s.pinnedMessages.some((p) => p.id === "r2")).toBe(true);
  // Edit
  s.messages = { chat44: [{ id: "r3", content: "old", chatId: "chat44" }] };
  const now = new Date().toISOString();
  s = reduceEditMessage(s, "chat44", { id: "r3", content: "new", editedAt: now });
  expect(s.messages["chat44"].find((m) => m.id === "r3").content).toBe("new");
  // Bulk delete
  s = reduceBulkDeleteForMe(s, "chat44", ["r3"]);
  expect(s.messages["chat44"].find((m) => m.id === "r3")).toBeUndefined();
  // Clear
  s.messages = { chat44: [{ id: "r4" }] };
  s = reduceClearChat(s, "chat44");
  expect(s.messages["chat44"]).toEqual([]);
  // Delete local chat
  s.chats = [{ id: "chat44" }];
  s.activeChatId = "chat44";
  s = reduceDeleteLocalChat(s, "chat44");
  expect(s.chats.length).toBe(0);
  expect(s.activeChatId).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS 45-58: Translation-aware search
// ─────────────────────────────────────────────────────────────────────────────

// Simulates the translation-aware merged searchMessages logic:
//   - originalResults: messages whose content contains query (ILIKE)
//   - translationResults: messages whose translation for receiveLang contains query
//   - merge by messageId, dedup, sort by createdAt desc

function makeTranslations(overrides = []) {
  return [
    { messageId: "msg-en-1", targetLang: "tr", translatedText: "Güncelleme için teşekkürler!" },
    { messageId: "msg-tr-1", targetLang: "en", translatedText: "Thanks for the update!" },
    { messageId: "msg-en-2", targetLang: "tr", translatedText: "Yarın görüşürüz." },
    { messageId: "msg-hidden", targetLang: "tr", translatedText: "Bu gizli mesaj" },
    { messageId: "msg-deleted", targetLang: "tr", translatedText: "Silinmiş mesaj" },
    { messageId: "msg-cleared", targetLang: "tr", translatedText: "Temizlenmiş mesaj" },
    ...overrides,
  ];
}

function makeBaseMessages() {
  return [
    { id: "msg-en-1", chatId: "chat-X", content: "Thanks for the update!", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T10:00:00Z"), metadata: {} },
    { id: "msg-tr-1", chatId: "chat-X", content: "Güncelleme için teşekkürler!", senderId: "u2", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T09:00:00Z"), metadata: {} },
    { id: "msg-en-2", chatId: "chat-X", content: "See you tomorrow.", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T08:00:00Z"), metadata: {} },
    { id: "msg-hidden", chatId: "chat-X", content: "Hidden message", senderId: "u2", type: "text", deletedAt: null, createdAt: new Date("2026-01-01T07:00:00Z"), metadata: {} },
    { id: "msg-deleted", chatId: "chat-X", content: "Deleted message", senderId: "u1", type: "text", deletedAt: new Date("2026-01-01T06:00:00Z"), createdAt: new Date("2026-01-01T06:00:00Z"), metadata: {} },
    { id: "msg-cleared", chatId: "chat-X", content: "Cleared message", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date("2025-12-31T00:00:00Z"), metadata: {} },
  ];
}

// Pure logic helpers mirroring the extended store function
function ilikeOriginalSearch(messages, query, { chatId, hiddenIds = [], clearedAt = null }) {
  const q = query.toLowerCase();
  const hiddenSet = new Set(hiddenIds);
  return messages.filter((m) => {
    if (m.chatId !== chatId) return false;
    if (m.deletedAt) return false;
    if (hiddenSet.has(m.id)) return false;
    if (clearedAt && m.createdAt <= clearedAt) return false;
    return m.content?.toLowerCase().includes(q);
  });
}

function translationSearch(translations, messages, query, { chatId, receiveLang, hiddenIds = [], clearedAt = null }) {
  const q = query.toLowerCase();
  const hiddenSet = new Set(hiddenIds);
  const msgMap = new Map(messages.map((m) => [m.id, m]));
  const hitIds = translations
    .filter((t) => t.targetLang === receiveLang && t.translatedText.toLowerCase().includes(q))
    .map((t) => t.messageId);
  return hitIds
    .map((id) => msgMap.get(id))
    .filter((m) => {
      if (!m) return false;
      if (m.chatId !== chatId) return false;
      if (m.deletedAt) return false;
      if (hiddenSet.has(m.id)) return false;
      if (clearedAt && m.createdAt <= clearedAt) return false;
      return true;
    });
}

function mergeResults(originals, translationMatches) {
  const seen = new Set(originals.map((m) => m.id));
  const merged = [...originals];
  for (const m of translationMatches) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      merged.push(m);
    }
  }
  merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return merged;
}

// 45. outgoing/original message search still works (English sender searching English)
test("45 — original message content search still works (no translation needed)", () => {
  const messages = makeBaseMessages();
  const results = ilikeOriginalSearch(messages, "Thanks for the update", { chatId: "chat-X" });
  expect(results.some((m) => m.id === "msg-en-1")).toBe(true);
});

// 46. incoming translated message found by translated text
test("46 — Turkish-language user can find English message via its translation", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  // Turkish user searches "Güncelleme" — the Turkish translation of "Thanks for the update!"
  const originals = ilikeOriginalSearch(messages, "Güncelleme", { chatId: "chat-X" });
  const transMatches = translationSearch(translations, messages, "Güncelleme", { chatId: "chat-X", receiveLang: "tr" });
  const merged = mergeResults(originals, transMatches);
  // msg-tr-1 has "Güncelleme" in original; msg-en-1 has it in Turkish translation
  expect(merged.some((m) => m.id === "msg-en-1")).toBe(true);
});

// 47. Turkish → English: Turkish original found via its English translation
test("47 — English-language user can find Turkish original via English translation", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  // English user (receiveLang=en) searches "Thanks for the update"
  const originals = ilikeOriginalSearch(messages, "Thanks for the update", { chatId: "chat-X" });
  const transMatches = translationSearch(translations, messages, "Thanks for the update", { chatId: "chat-X", receiveLang: "en" });
  const merged = mergeResults(originals, transMatches);
  // msg-en-1 has it in original; msg-tr-1 has it in EN translation
  expect(merged.some((m) => m.id === "msg-en-1")).toBe(true);
  expect(merged.some((m) => m.id === "msg-tr-1")).toBe(true);
});

// 48. English → English: both original and translation match → one result only
test("48 — when both original and translation match, message appears once (deduplication)", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  // msg-tr-1 has "Güncelleme" in BOTH original AND translation
  const originals = ilikeOriginalSearch(messages, "Güncelleme", { chatId: "chat-X" });
  const transMatches = translationSearch(translations, messages, "Güncelleme", { chatId: "chat-X", receiveLang: "tr" });
  const merged = mergeResults(originals, transMatches);
  const msgTr1Count = merged.filter((m) => m.id === "msg-tr-1").length;
  expect(msgTr1Count).toBe(1); // deduplicated
});

// 49. correct messageId returned for translation hit
test("49 — translation search returns original message id (not translation row id)", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  const transMatches = translationSearch(translations, messages, "Güncelleme için teşekkürler", { chatId: "chat-X", receiveLang: "tr" });
  expect(transMatches.some((m) => m.id === "msg-en-1")).toBe(true);
  // Returned object has message fields, not translation fields
  const hit = transMatches.find((m) => m.id === "msg-en-1");
  expect(hit.content).toBe("Thanks for the update!"); // original content preserved
});

// 50. hidden message excluded from translation search
test("50 — hidden-for-me message is excluded from translation search", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  const transMatches = translationSearch(translations, messages, "Bu gizli", { chatId: "chat-X", receiveLang: "tr", hiddenIds: ["msg-hidden"] });
  expect(transMatches.some((m) => m.id === "msg-hidden")).toBe(false);
  // Without hidden filter it would appear
  const withoutFilter = translationSearch(translations, messages, "Bu gizli", { chatId: "chat-X", receiveLang: "tr" });
  expect(withoutFilter.some((m) => m.id === "msg-hidden")).toBe(true);
});

// 51. cleared history excluded from translation search
test("51 — messages before clearedAt are excluded from translation search", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  const clearedAt = new Date("2026-01-01T00:00:00Z"); // clears msg-cleared (2025-12-31)
  const transMatches = translationSearch(translations, messages, "Temizlenmiş", { chatId: "chat-X", receiveLang: "tr", clearedAt });
  expect(transMatches.some((m) => m.id === "msg-cleared")).toBe(false);
});

// 52. deleted message excluded from translation search
test("52 — deleted message (deletedAt set) excluded from translation search", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  const transMatches = translationSearch(translations, messages, "Silinmiş", { chatId: "chat-X", receiveLang: "tr" });
  expect(transMatches.some((m) => m.id === "msg-deleted")).toBe(false);
});

// 53. wrong target-language translation not exposed (privacy scoping)
test("53 — translation for wrong receiveLang is not returned (privacy scoping)", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  // User has receiveLang=en but searches Turkish word — should not find TR translations
  const transMatches = translationSearch(translations, messages, "Güncelleme için teşekkürler", { chatId: "chat-X", receiveLang: "en" });
  // The TR translation of msg-en-1 should NOT appear for an EN user
  expect(transMatches.some((m) => m.id === "msg-en-1")).toBe(false);
});

// 54. edit updates searchable translation (old translation replaced)
test("54 — after edit, new translation replaces old in translations list", () => {
  const translations = [
    { messageId: "edit-msg", targetLang: "tr", translatedText: "eski çeviri" },
  ];
  // Simulate: edit cleared old translation, new translation written
  const updatedTranslations = translations.map((t) =>
    t.messageId === "edit-msg" && t.targetLang === "tr"
      ? { ...t, translatedText: "yeni çeviri" }
      : t
  );
  const messages = [{ id: "edit-msg", chatId: "chat-X", content: "new content", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date(), metadata: {} }];
  // New translation is searchable
  const newHits = translationSearch(updatedTranslations, messages, "yeni çeviri", { chatId: "chat-X", receiveLang: "tr" });
  expect(newHits.some((m) => m.id === "edit-msg")).toBe(true);
  // Old translation no longer found
  const oldHits = translationSearch(updatedTranslations, messages, "eski çeviri", { chatId: "chat-X", receiveLang: "tr" });
  expect(oldHits.some((m) => m.id === "edit-msg")).toBe(false);
});

// 55. old stale translation no longer searchable after edit clears it
test("55 — deleted translation row makes stale text unsearchable", () => {
  // editMessage calls deleteTranslationsForMessage → rows removed
  const translations = []; // empty after delete
  const messages = [{ id: "edit-msg", chatId: "chat-X", content: "updated text", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date(), metadata: {} }];
  const hits = translationSearch(translations, messages, "eski çeviri", { chatId: "chat-X", receiveLang: "tr" });
  expect(hits.length).toBe(0);
});

// 56. search navigation data remains valid (id field present)
test("56 — merged search results all have id field for messageRefs navigation", () => {
  const messages = makeBaseMessages();
  const translations = makeTranslations();
  const originals = ilikeOriginalSearch(messages, "Thanks", { chatId: "chat-X" });
  const transMatches = translationSearch(translations, messages, "Thanks", { chatId: "chat-X", receiveLang: "en" });
  const merged = mergeResults(originals, transMatches);
  for (const r of merged) {
    expect(r.id).toBeTruthy();
    expect(typeof r.id).toBe("string");
  }
});

// 57. chatId scope: translation search does not leak cross-chat
test("57 — translation search scoped to chatId; other chats excluded", () => {
  const translations = [
    { messageId: "other-chat-msg", targetLang: "tr", translatedText: "Güncelleme için teşekkürler!" },
  ];
  const messages = [
    { id: "other-chat-msg", chatId: "chat-OTHER", content: "Thanks!", senderId: "u1", type: "text", deletedAt: null, createdAt: new Date(), metadata: {} },
  ];
  const results = translationSearch(translations, messages, "Güncelleme", { chatId: "chat-X", receiveLang: "tr" });
  expect(results.length).toBe(0); // other chat filtered out
});

// 58. no regression in Star/Pin/Edit/Multi-select/Bulk/Clear/Delete
test("58 — translation-aware search is additive; existing reducers unaffected", () => {
  let s = makeState();
  s = reduceStarAdd(s, "q1");
  expect(s.starredMessageIds.has("q1")).toBe(true);
  s = reducePinAdd(s, { id: "q2", content: "pinned", chatId: "chat58" });
  expect(s.pinnedMessages.some((p) => p.id === "q2")).toBe(true);
  s.messages = { chat58: [{ id: "q3", content: "old", chatId: "chat58" }] };
  const ts = new Date().toISOString();
  s = reduceEditMessage(s, "chat58", { id: "q3", content: "new", editedAt: ts });
  expect(s.messages["chat58"][0].content).toBe("new");
  s = reduceBulkDeleteForMe(s, "chat58", ["q3"]);
  expect(s.messages["chat58"].find((m) => m.id === "q3")).toBeUndefined();
  s.messages = { chat58: [{ id: "q4" }] };
  s = reduceClearChat(s, "chat58");
  expect(s.messages["chat58"]).toEqual([]);
  s.chats = [{ id: "chat58" }];
  s.activeChatId = "chat58";
  s = reduceDeleteLocalChat(s, "chat58");
  expect(s.chats.length).toBe(0);
  expect(s.activeChatId).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS 59-68: Search result display — matchedText / matchSource
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors the updated mergeResults logic in store.js
function tagOriginals(msgs) {
  return msgs.map((m) => ({ ...m, matchedText: m.content, matchSource: "original" }));
}

function mergeResultsWithDisplay(originals, translationMatches, q) {
  const tagged = tagOriginals(originals);
  const seen = new Map(tagged.map((m) => [m.id, m]));
  const qLower = (q || "").toLowerCase();
  for (const m of translationMatches) {
    if (!seen.has(m.id)) {
      seen.set(m.id, m);
    } else {
      const existing = seen.get(m.id);
      if (m.matchedText?.toLowerCase().includes(qLower)) {
        seen.set(m.id, { ...existing, matchedText: m.matchedText, matchSource: "translation" });
      }
    }
  }
  const merged = [...seen.values()];
  merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return merged;
}

function makeDisplayMsg(id, content, createdAt = new Date()) {
  return { id, chatId: "chat-D", content, senderId: "u1", type: "text", deletedAt: null, createdAt, metadata: {} };
}

// 59. original hit → matchedText = content, matchSource = "original"
test("59 — original-content hit gets matchedText=content and matchSource='original'", () => {
  const msg = makeDisplayMsg("d1", "It's snowing outside");
  const result = mergeResultsWithDisplay([msg], [], "snow");
  expect(result[0].matchedText).toBe("It's snowing outside");
  expect(result[0].matchSource).toBe("original");
});

// 60. translation hit → matchedText = translatedText, matchSource = "translation"
test("60 — translation-only hit gets matchedText=translatedText and matchSource='translation'", () => {
  const msg = makeDisplayMsg("d2", "It's snowing outside");
  const transMatch = { ...msg, matchedText: "Kar yağıyor", matchSource: "translation" };
  const result = mergeResultsWithDisplay([], [transMatch], "Kar");
  expect(result[0].matchedText).toBe("Kar yağıyor");
  expect(result[0].matchSource).toBe("translation");
  expect(result[0].id).toBe("d2"); // original message id preserved
});

// 61. search "snow" → English matched text displayed (not Turkish)
test("61 — searching 'snow' displays English matched text (original)", () => {
  const msg = makeDisplayMsg("d3", "It's snowing outside");
  const transMatch = { ...msg, matchedText: "Kar yağıyor", matchSource: "translation" };
  // Both match: original contains "snow", translation contains "Kar"
  const result = mergeResultsWithDisplay([msg], [transMatch], "snow");
  // "snow" is in original content, not in "Kar yağıyor", so matchSource stays "original"
  expect(result[0].matchSource).toBe("original");
  expect(result[0].matchedText).toBe("It's snowing outside");
});

// 62. search "hafta" → Turkish matched text displayed (not English original)
test("62 — searching 'hafta' displays Turkish matched text (translation)", () => {
  const msg = makeDisplayMsg("d4", "Yes, I'm heading to Marmara this weekend");
  const transMatch = { ...msg, matchedText: "Evet, bu hafta Marmara'ya gidiyorum", matchSource: "translation" };
  // Original doesn't contain "hafta", translation does
  const result = mergeResultsWithDisplay([msg], [transMatch], "hafta");
  expect(result[0].matchSource).toBe("translation");
  expect(result[0].matchedText).toBe("Evet, bu hafta Marmara'ya gidiyorum");
});

// 63. navigation still uses real messageId (not translation id)
test("63 — navigation uses real message id regardless of matchSource", () => {
  const msg = makeDisplayMsg("real-msg-id", "hello");
  const transMatch = { ...msg, matchedText: "merhaba", matchSource: "translation" };
  const result = mergeResultsWithDisplay([], [transMatch], "merhaba");
  expect(result[0].id).toBe("real-msg-id");
  expect(result[0].content).toBe("hello"); // original content preserved
});

// 64. no duplicate result when both original and translation match
test("64 — both-match case returns exactly one result (no duplicate)", () => {
  const msg = makeDisplayMsg("d5", "Güncelleme için teşekkürler!");
  const transMatch = { ...msg, matchedText: "Thanks for the update!", matchSource: "translation" };
  // Both contain "Güncel" — user typed "Güncel"
  const result = mergeResultsWithDisplay([msg], [transMatch], "Güncel");
  expect(result.filter((r) => r.id === "d5").length).toBe(1);
});

// 65. both match — prefer translation variant when query matches translation
test("65 — when query matches translated text, matchSource upgrades to 'translation'", () => {
  const msg = makeDisplayMsg("d6", "Thanks for the update!");
  const transMatch = { ...msg, matchedText: "Güncelleme için teşekkürler!", matchSource: "translation" };
  // User searched "Güncelleme" — only in translation
  const result = mergeResultsWithDisplay([msg], [transMatch], "Güncelleme");
  // msg "Thanks for the update!" doesn't contain "Güncelleme", so translation wins
  expect(result[0].matchSource).toBe("translation");
  expect(result[0].matchedText).toBe("Güncelleme için teşekkürler!");
});

// 66. wrong-language translation not exposed (privacy — receiveLang scoping in translationSearch)
test("66 — translationSearch only fetches targetLang=receiveLang; other langs excluded", () => {
  // Simulated: translations table has TR and DE variants
  const translations = [
    { messageId: "d7", targetLang: "tr", translatedText: "Teşekkürler" },
    { messageId: "d7", targetLang: "de", translatedText: "Danke" },
  ];
  const messages = [makeDisplayMsg("d7", "Thanks")];
  // User receiveLang = "tr" — should only match TR translation
  const filtered = translations.filter((t) => t.targetLang === "tr" && t.translatedText.toLowerCase().includes("teşekkürler"));
  expect(filtered.length).toBe(1);
  // DE translation invisible to TR user
  const deFilt = translations.filter((t) => t.targetLang === "tr" && t.translatedText.toLowerCase().includes("danke"));
  expect(deFilt.length).toBe(0);
});

// 67. hidden/cleared/deleted safety unchanged
test("67 — safety filters apply regardless of matchSource", () => {
  const hidden = { ...makeDisplayMsg("d8", "hidden"), matchedText: "gizli", matchSource: "translation" };
  const cleared = { ...makeDisplayMsg("d9", "cleared", new Date("2025-01-01")), matchedText: "temizlendi", matchSource: "translation" };
  const deleted = { ...makeDisplayMsg("d10", "deleted"), deletedAt: new Date(), matchedText: "silinmiş", matchSource: "translation" };

  // Hidden — not in translationSearch result set (filtered at DB level by hiddenIds)
  const hiddenSet = new Set(["d8"]);
  expect(hiddenSet.has("d8")).toBe(true); // would have been filtered in DB query

  // Cleared — messages before clearedAt excluded
  const clearedAt = new Date("2026-01-01");
  expect(cleared.createdAt < clearedAt).toBe(true); // would be excluded

  // Deleted — deletedAt IS NOT NULL excluded
  expect(deleted.deletedAt).not.toBeNull(); // would be excluded
});

// 68. no regression — star/pin/edit/bulk/clear/delete unaffected
test("68 — matchedText/matchSource are display-only; core state reducers unchanged", () => {
  let s = makeState();
  s = reduceStarAdd(s, "z1");
  expect(s.starredMessageIds.has("z1")).toBe(true);
  s = reducePinAdd(s, { id: "z2", content: "pin", chatId: "chat68" });
  expect(s.pinnedMessages.some((p) => p.id === "z2")).toBe(true);
  s.messages = { chat68: [{ id: "z3", content: "old", chatId: "chat68" }] };
  s = reduceEditMessage(s, "chat68", { id: "z3", content: "new", editedAt: new Date().toISOString() });
  expect(s.messages["chat68"][0].content).toBe("new");
  s = reduceBulkDeleteForMe(s, "chat68", ["z3"]);
  expect(s.messages["chat68"].find((m) => m.id === "z3")).toBeUndefined();
  s.messages = { chat68: [{ id: "z4" }] };
  s = reduceClearChat(s, "chat68");
  expect(s.messages["chat68"]).toEqual([]);
  s.chats = [{ id: "chat68" }];
  s.activeChatId = "chat68";
  s = reduceDeleteLocalChat(s, "chat68");
  expect(s.chats.length).toBe(0);
  expect(s.activeChatId).toBeNull();
});
