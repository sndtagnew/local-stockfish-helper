/*
 * ChessHelper background worker.
 *
 * Analysis is performed locally by the bundled Stockfish engine (see
 * offscreen.js). There is no account, subscription, checkout, or remote
 * analysis API in this build.
 */

const DEFAULT_SETTINGS = {
  extensionEnabled: true,
  analysisEnabled: true,
  depth: 15,
  autoplayEnabled: false,
  autoplayDelay: 1000,
  autoplayDelayMin: 500,
  autoplayDelayMax: 2000,
  autoplayVariationEnabled: true,
  antidetectEnabled: false,
  antidetectIntervalMin: 5,
  antidetectIntervalMax: 6,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
const OFFSCREEN_TARGET = "chesshelper-offscreen";
const LOCAL_PROFILE = {
  name: "Local Engine",
  email: "",
  subscriptionTier: "local",
  tier: "local",
  usage: {
    daily: { used: 0, limit: 0 },
    weekly: { used: 0, limit: 0 },
  },
};

let selectorDiagnostics = null;
let offscreenPromise = null;

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);
  const settings = {};
  for (const key of SETTINGS_KEYS) {
    settings[key] =
      stored[key] === undefined ? DEFAULT_SETTINGS[key] : stored[key];
  }
  return settings;
}

async function sendSettings(tabId) {
  const settings = await getSettings();
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SETTINGS_RESPONSE",
      settings,
    });
  } catch {
    // The tab may have navigated away or may not have the content script yet.
  }
}

async function broadcastSettings(settings) {
  try {
    const tabs = await chrome.tabs.query({
      url: ["*://*.chess.com/*", "*://*.lichess.org/*"],
    });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs
          .sendMessage(tab.id, { type: "SETTINGS_CHANGED", settings })
          .catch(() => {});
      }
    }
  } catch {
    // Ignore transient tab errors.
  }
}

async function hasOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    try {
      return await chrome.offscreen.hasDocument();
    } catch {
      // Fall through to getContexts or creation.
    }
  }

  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
      return contexts.length > 0;
    } catch {
      // Fall through to creation.
    }
  }

  return false;
}

async function ensureOffscreenDocument() {
  if (offscreenPromise) return offscreenPromise;

  offscreenPromise = (async () => {
    if (await hasOffscreenDocument()) return;

    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification:
          "Run the bundled Stockfish engine for local chess analysis",
      });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (!/single offscreen|already exists|only a single/i.test(message)) {
        throw error;
      }
    }
  })().finally(() => {
    offscreenPromise = null;
  });

  return offscreenPromise;
}

async function sendToOffscreen(message, attempts = 5) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * (attempt + 1)),
        );
      }
    }
  }

  throw lastError || new Error("Local engine is not available");
}

async function stopAnalysis() {
  try {
    await sendToOffscreen(
      { target: OFFSCREEN_TARGET, type: "LOCAL_STOP" },
      1,
    );
  } catch {
    // No offscreen document means nothing is running.
  }
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

async function analyzePosition(message) {
  const started = Date.now();
  const depth = clamp(message.depth || DEFAULT_SETTINGS.depth, 1, 30);
  const maxTimeMs = clamp(message.maxTimeMs || 3000, 100, 30000);
  let timeoutId = null;

  try {
    await ensureOffscreenDocument();

    const response = await Promise.race([
      sendToOffscreen({
        target: OFFSCREEN_TARGET,
        type: "LOCAL_ANALYZE",
        fen: message.fen,
        depth,
        maxTimeMs,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Local analysis timed out")),
          maxTimeMs + 30000,
        );
      }),
    ]);

    if (!response || !response.success || !response.bestMove) {
      throw new Error(
        (response && response.error) || "Local engine did not return a move",
      );
    }

    return {
      success: true,
      data: {
        success: true,
        analysis: {
          bestMove: response.bestMove,
          ponder: response.ponder || null,
          evaluation:
            response.mate === null || response.mate === undefined
              ? response.evaluation || 0
              : null,
          mate:
            response.mate === null || response.mate === undefined
              ? null
              : response.mate,
          depth: response.depth || depth,
          analysisTime: Date.now() - started,
        },
        meta: {
          requestedDepth: depth,
          actualDepth: response.depth || depth,
          maxDepthForTier: 30,
          tier: "local",
          cached: false,
          fallbackUsed: false,
          alternativeUsed: false,
        },
      },
    };
  } catch (error) {
    await stopAnalysis().catch(() => {});
    return {
      success: false,
      error:
        error && error.message ? error.message : "Local analysis failed",
    };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function getSessionGameId(tabId) {
  const key = `gameId_${tabId}`;
  const stored = await chrome.storage.session.get(key);
  if (stored[key]) return stored[key];

  const gameId = crypto.randomUUID();
  await chrome.storage.session.set({ [key]: gameId });
  return gameId;
}

async function clearSessionGameId(tabId) {
  await chrome.storage.session.remove(`gameId_${tabId}`);
}

async function handleMessage(message, sender, sendResponse) {
  const tabId = sender && sender.tab ? sender.tab.id : null;

  switch (message.type) {
    case "GET_SETTINGS":
      if (tabId) await sendSettings(tabId);
      sendResponse({ success: true });
      return;

    case "API_ANALYZE":
      if (!message || typeof message.fen !== "string" || !message.fen.trim()) {
        sendResponse({ success: false, error: "Invalid FEN" });
        return;
      }
      sendResponse(await analyzePosition(message));
      return;

    case "STOP_ANALYSIS":
      await stopAnalysis();
      sendResponse({ success: true });
      return;

    case "GET_AUTH_STATE":
      sendResponse({
        authenticated: true,
        profile: LOCAL_PROFILE,
        anonymousGamesCount: 0,
      });
      return;

    case "FETCH_PROFILE":
      sendResponse({ profile: LOCAL_PROFILE });
      return;

    case "GET_BASE_URL":
      sendResponse({ baseUrl: "" });
      return;

    case "SET_EXTENSION_TOKEN":
    case "CLEAR_TOKEN":
    case "OPEN_AUTH_TAB":
    case "API_CHECKOUT":
      sendResponse({
        success: false,
        error: "Not supported in local build",
      });
      return;

    case "GET_GAME_ID":
      if (tabId) {
        sendResponse({ gameId: await getSessionGameId(tabId) });
      } else {
        sendResponse({ gameId: null });
      }
      return;

    case "RESET_GAME_ID":
      if (tabId) await clearSessionGameId(tabId);
      sendResponse({ success: true });
      return;

    case "TRACK_ANONYMOUS_GAME":
    case "GAME_STARTED":
    case "GAME_ENDED":
    case "DOM_HEALTH_REPORT":
    case "CLOSE_CONNECT_TAB":
      sendResponse({ success: true });
      return;

    case "SELECTOR_DIAGNOSTICS":
      selectorDiagnostics = {
        platform: message.platform,
        results: message.results,
        timestamp: Date.now(),
      };
      sendResponse({ success: true });
      return;

    case "GET_SELECTOR_DIAGNOSTICS":
      sendResponse({ diagnostics: selectorDiagnostics });
      return;

    default:
      sendResponse({ success: true });
  }
}

function isAllowedSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const url = sender.url || sender.tab?.url || "";
  if (!url) return true;
  if (url.startsWith(chrome.runtime.getURL(""))) return true;
  return /^https?:\/\/([a-z0-9-]+\.)?(chess\.com|lichess\.org)\//i.test(url);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAllowedSender(sender)) return false;

  handleMessage(message, sender, sendResponse).catch((error) => {
    try {
      sendResponse({
        success: false,
        error: error && error.message ? error.message : String(error),
      });
    } catch {
      // The message port may already be closed.
    }
  });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  const settings = {};
  for (const [key, change] of Object.entries(changes)) {
    if (SETTINGS_KEYS.includes(key)) {
      settings[key] = change.newValue;
    }
  }

  if (Object.keys(settings).length > 0) {
    broadcastSettings(settings);
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const stored = await chrome.storage.local.get(SETTINGS_KEYS);
    const initial = {};
    for (const key of SETTINGS_KEYS) {
      if (stored[key] === undefined) initial[key] = DEFAULT_SETTINGS[key];
    }
    if (Object.keys(initial).length > 0) {
      await chrome.storage.local.set(initial);
    }
  }

  // Remove data left behind by older account/subscription based builds.
  await chrome.storage.local.remove([
    "extensionToken",
    "userProfile",
    "lastProfileFetch",
    "anonymousGameIds",
    "anonymousGamesCount",
  ]);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await clearSessionGameId(tabId);
  } catch {
    // Ignore tabs that no longer have a session id.
  }
});
