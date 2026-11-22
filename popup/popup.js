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

const ELO_MAP = {
  1: 800, 2: 1000, 3: 1200, 4: 1350, 5: 1500, 6: 1600, 7: 1700, 8: 1800,
  9: 1900, 10: 2000, 11: 2100, 12: 2200, 13: 2350, 14: 2500, 15: 2600,
  16: 2700, 17: 2800, 18: 2900, 19: 3000, 20: 3200,
};

const el = {};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  el.popupContainer = document.querySelector(".popup-container");
  el.brandLink = $("brand-link");
  el.enabledToggle = $("enabled-toggle");
  el.analysisToggle = $("analysis-toggle");
  el.depthInput = $("depth-input");
  el.depthValue = $("depth-value");
  el.autoplayToggle = $("autoplay-toggle");
  el.autoplaySettings = $("autoplay-settings");
  el.variationToggle = $("variation-toggle");
  el.delayMinSection = $("delay-min-section");
  el.delayMaxSection = $("delay-max-section");
  el.delayFixedSection = $("delay-fixed-section");
  el.delayMinInput = $("delay-min-input");
  el.delayMinValue = $("delay-min-value");
  el.delayMaxInput = $("delay-max-input");
  el.delayMaxValue = $("delay-max-value");
  el.delayInput = $("delay-input");
  el.delayValue = $("delay-value");
  el.antidetectToggle = $("antidetect-toggle");
  el.antidetectSettings = $("antidetect-settings");
  el.antidetectMinInput = $("antidetect-min-input");
  el.antidetectMinValue = $("antidetect-min-value");
  el.antidetectMaxInput = $("antidetect-max-input");
  el.antidetectMaxValue = $("antidetect-max-value");
  el.status = $("status");
  el.statusDot = document.querySelector(".status-dot");
  el.statusText = document.querySelector(".status-text");
  el.domHealth = $("dom-health");
  el.domHealthDot = $("dom-health-dot");
  el.domHealthText = $("dom-health-text");
}

function depthToElo(depth) {
  return `~${ELO_MAP[depth] || 2600}`;
}

function setStatus(text, type = "ready") {
  if (el.statusText) el.statusText.textContent = text;
  if (el.statusDot) {
    el.statusDot.classList.remove("status-success", "status-error");
    if (type === "success") el.statusDot.classList.add("status-success");
    if (type === "error") el.statusDot.classList.add("status-error");
  }
  if (type !== "ready") {
    setTimeout(() => setStatus("Ready", "ready"), 2000);
  }
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (stored[key] !== undefined) settings[key] = stored[key];
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSetting(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
    setStatus("Saved", "success");
  } catch {
    setStatus("Error saving", "error");
  }
}

function updateDelayVisibility(useVariation) {
  if (el.delayMinSection) el.delayMinSection.style.display = useVariation ? "block" : "none";
  if (el.delayMaxSection) el.delayMaxSection.style.display = useVariation ? "block" : "none";
  if (el.delayFixedSection) el.delayFixedSection.style.display = useVariation ? "none" : "block";
}

function applySettings(settings) {
  if (el.enabledToggle) el.enabledToggle.checked = !!settings.extensionEnabled;
  if (el.popupContainer) {
    el.popupContainer.classList.toggle("popup-disabled", !settings.extensionEnabled);
  }

  if (el.analysisToggle) el.analysisToggle.checked = !!settings.analysisEnabled;

  if (el.depthInput) el.depthInput.value = String(settings.depth);
  if (el.depthValue) el.depthValue.textContent = depthToElo(settings.depth);

  if (el.autoplayToggle) el.autoplayToggle.checked = !!settings.autoplayEnabled;
  if (el.variationToggle) el.variationToggle.checked = !!settings.autoplayVariationEnabled;
  updateDelayVisibility(!!settings.autoplayVariationEnabled);

  if (el.delayMinInput) el.delayMinInput.value = String(settings.autoplayDelayMin);
  if (el.delayMinValue) el.delayMinValue.textContent = `${settings.autoplayDelayMin}ms`;
  if (el.delayMaxInput) el.delayMaxInput.value = String(settings.autoplayDelayMax);
  if (el.delayMaxValue) el.delayMaxValue.textContent = `${settings.autoplayDelayMax}ms`;
  if (el.delayInput) el.delayInput.value = String(settings.autoplayDelay);
  if (el.delayValue) el.delayValue.textContent = `${settings.autoplayDelay}ms`;

  if (el.antidetectToggle) el.antidetectToggle.checked = !!settings.antidetectEnabled;
  if (el.antidetectMinInput) el.antidetectMinInput.value = String(settings.antidetectIntervalMin);
  if (el.antidetectMinValue) el.antidetectMinValue.textContent = String(settings.antidetectIntervalMin);
  if (el.antidetectMaxInput) el.antidetectMaxInput.value = String(settings.antidetectIntervalMax);
  if (el.antidetectMaxValue) el.antidetectMaxValue.textContent = String(settings.antidetectIntervalMax);
}

function bindEvents() {
  el.enabledToggle?.addEventListener("change", (e) => {
    const enabled = !!e.target.checked;
    saveSetting("extensionEnabled", enabled);
    el.popupContainer?.classList.toggle("popup-disabled", !enabled);
  });

  el.analysisToggle?.addEventListener("change", (e) => {
    saveSetting("analysisEnabled", !!e.target.checked);
  });

  el.depthInput?.addEventListener("input", (e) => {
    const value = parseInt(e.target.value, 10);
    if (el.depthValue) el.depthValue.textContent = depthToElo(value);
  });
  el.depthInput?.addEventListener("change", (e) => {
    saveSetting("depth", parseInt(e.target.value, 10));
  });

  el.autoplayToggle?.addEventListener("change", (e) => {
    saveSetting("autoplayEnabled", !!e.target.checked);
  });

  el.variationToggle?.addEventListener("change", (e) => {
    const enabled = !!e.target.checked;
    saveSetting("autoplayVariationEnabled", enabled);
    updateDelayVisibility(enabled);
  });

  el.delayMinInput?.addEventListener("input", (e) => {
    const min = parseInt(e.target.value, 10);
    if (el.delayMinValue) el.delayMinValue.textContent = `${min}ms`;
    if (el.delayMaxInput) {
      const max = parseInt(el.delayMaxInput.value, 10);
      if (min >= max) {
        const nextMax = Math.min(10000, min + 100);
        el.delayMaxInput.value = String(nextMax);
        if (el.delayMaxValue) el.delayMaxValue.textContent = `${nextMax}ms`;
      }
    }
  });
  el.delayMinInput?.addEventListener("change", (e) => {
    const min = parseInt(e.target.value, 10);
    saveSetting("autoplayDelayMin", min);
    if (el.delayMaxInput) {
      const max = parseInt(el.delayMaxInput.value, 10);
      if (min >= max) saveSetting("autoplayDelayMax", Math.min(10000, min + 100));
    }
  });

  el.delayMaxInput?.addEventListener("input", (e) => {
    const max = parseInt(e.target.value, 10);
    if (el.delayMaxValue) el.delayMaxValue.textContent = `${max}ms`;
    if (el.delayMinInput) {
      const min = parseInt(el.delayMinInput.value, 10);
      if (max <= min) {
        const nextMin = Math.max(100, max - 100);
        el.delayMinInput.value = String(nextMin);
        if (el.delayMinValue) el.delayMinValue.textContent = `${nextMin}ms`;
      }
    }
  });
  el.delayMaxInput?.addEventListener("change", (e) => {
    const max = parseInt(e.target.value, 10);
    saveSetting("autoplayDelayMax", max);
    if (el.delayMinInput) {
      const min = parseInt(el.delayMinInput.value, 10);
      if (max <= min) saveSetting("autoplayDelayMin", Math.max(100, max - 100));
    }
  });

  el.delayInput?.addEventListener("input", (e) => {
    const value = parseInt(e.target.value, 10);
    if (el.delayValue) el.delayValue.textContent = `${value}ms`;
  });
  el.delayInput?.addEventListener("change", (e) => {
    saveSetting("autoplayDelay", parseInt(e.target.value, 10));
  });

  el.antidetectToggle?.addEventListener("change", (e) => {
    saveSetting("antidetectEnabled", !!e.target.checked);
  });

  el.antidetectMinInput?.addEventListener("input", (e) => {
    const min = parseInt(e.target.value, 10);
    if (el.antidetectMinValue) el.antidetectMinValue.textContent = String(min);
    if (el.antidetectMaxInput) {
      const max = parseInt(el.antidetectMaxInput.value, 10);
      if (min >= max) {
        const nextMax = Math.min(20, min + 1);
        el.antidetectMaxInput.value = String(nextMax);
        if (el.antidetectMaxValue) el.antidetectMaxValue.textContent = String(nextMax);
      }
    }
  });
  el.antidetectMinInput?.addEventListener("change", (e) => {
    const min = parseInt(e.target.value, 10);
    saveSetting("antidetectIntervalMin", min);
    if (el.antidetectMaxInput) {
      const max = parseInt(el.antidetectMaxInput.value, 10);
      if (min >= max) saveSetting("antidetectIntervalMax", Math.min(20, min + 1));
    }
  });

  el.antidetectMaxInput?.addEventListener("input", (e) => {
    const max = parseInt(e.target.value, 10);
    if (el.antidetectMaxValue) el.antidetectMaxValue.textContent = String(max);
    if (el.antidetectMinInput) {
      const min = parseInt(el.antidetectMinInput.value, 10);
      if (max <= min) {
        const nextMin = Math.max(1, max - 1);
        el.antidetectMinInput.value = String(nextMin);
        if (el.antidetectMinValue) el.antidetectMinValue.textContent = String(nextMin);
      }
    }
  });
  el.antidetectMaxInput?.addEventListener("change", (e) => {
    const max = parseInt(e.target.value, 10);
    saveSetting("antidetectIntervalMax", max);
    if (el.antidetectMinInput) {
      const min = parseInt(el.antidetectMinInput.value, 10);
      if (max <= min) saveSetting("antidetectIntervalMin", Math.max(1, max - 1));
    }
  });
}

async function checkActiveTabs() {
  try {
    const chessTabs = await chrome.tabs.query({ url: "*://*.chess.com/*" });
    const lichessTabs = await chrome.tabs.query({ url: "*://*.lichess.org/*" });
    if (chessTabs.length + lichessTabs.length > 0) {
      setStatus("Connected", "success");
      setTimeout(() => setStatus("Ready", "ready"), 1500);
    } else {
      setStatus("Open chess.com or lichess.org", "ready");
    }
  } catch {
    setStatus("Ready", "ready");
  }
}

async function loadDomHealth() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_SELECTOR_DIAGNOSTICS" });
    const diagnostics = res?.diagnostics;
    if (!diagnostics?.results || !el.domHealth) return;

    const results = diagnostics.results;
    const entries = Object.entries(results).filter(([, v]) => v.category !== "event");
    const broken = entries.filter(([, v]) => !v.working).map(([k]) => k);
    const critical = broken.filter((k) => ["board", "pieces"].includes(k));

    el.domHealth.style.display = "flex";
    el.domHealth.classList.remove("health-ok", "health-warn", "health-error");
    el.domHealthDot?.classList.remove("health-ok", "health-warn", "health-error");

    if (critical.length > 0) {
      el.domHealth.classList.add("health-error");
      el.domHealthDot?.classList.add("health-error");
      el.domHealthText.textContent = `DOM: ${critical.length} critical selector(s) broken`;
      el.domHealth.title = `Broken: ${broken.join(", ")}`;
    } else if (broken.length > 0) {
      el.domHealth.classList.add("health-warn");
      el.domHealthDot?.classList.add("health-warn");
      el.domHealthText.textContent = `DOM: ${broken.length} non-critical selector(s) missing`;
      el.domHealth.title = `Missing: ${broken.join(", ")}`;
    } else {
      el.domHealth.classList.add("health-ok");
      el.domHealthDot?.classList.add("health-ok");
      el.domHealthText.textContent = `DOM: All selectors OK (${diagnostics.platform || "unknown"})`;
      el.domHealth.title = "All selectors matched successfully";
    }

    el.domHealth.onclick = () => {
      console.log("[Chess Helper] Selector diagnostics", diagnostics);
    };
  } catch {
    // Ignore diagnostics errors.
  }
}

function applyBrandLink() {
  if (!el.brandLink) return;
  const url = globalThis._cfg?.APP_URL || "https://chesshelper.ai";
  el.brandLink.href = url;
}

async function init() {
  cacheElements();
  applyBrandLink();
  const settings = await loadSettings();
  applySettings(settings);
  bindEvents();
  await checkActiveTabs();
  await loadDomHealth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
