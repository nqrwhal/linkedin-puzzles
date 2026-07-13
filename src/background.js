"use strict";

const attachedTabs = new Set();
const detachTimers = new Map();

function clearDetachTimer(tabId) {
  const timer = detachTimers.get(tabId);
  if (timer) clearTimeout(timer);
  detachTimers.delete(tabId);
}

async function detach(tabId) {
  clearDetachTimer(tabId);
  if (!attachedTabs.has(tabId)) return;
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The tab may have closed or navigated while the solve was finishing.
  }
}

function armSafetyDetach(tabId) {
  clearDetachTimer(tabId);
  detachTimers.set(tabId, setTimeout(() => void detach(tabId), 30000));
}

async function attach(tabId) {
  if (!attachedTabs.has(tabId)) {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
  }
  armSafetyDetach(tabId);
}

async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("The solver could not identify this tab.");

  if (message?.type === "lls-input-start") {
    await attach(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-stop") {
    await detach(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-event") {
    await attach(tabId);
    const { eventType, x, y, button = "none", buttons = 0, clickCount = 0 } = message;
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
      type: eventType,
      x,
      y,
      button,
      buttons,
      clickCount,
    });
    armSafetyDetach(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-text") {
    await attach(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
      text: String(message.text || ""),
    });
    armSafetyDetach(tabId);
    return { ok: true };
  }

  if (message?.type === "lls-input-key") {
    await attach(tabId);
    const { key, code, keyCode = 0, modifiers = 0 } = message;
    const common = {
      key,
      code,
      modifiers,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...common,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      ...common,
    });
    armSafetyDetach(tabId);
    return { ok: true };
  }

  return { ok: false };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse, (error) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true;
});

chrome.debugger.onDetach.addListener((source) => {
  if (Number.isInteger(source.tabId)) {
    attachedTabs.delete(source.tabId);
    clearDetachTimer(source.tabId);
  }
});

chrome.tabs?.onRemoved.addListener((tabId) => void detach(tabId));
