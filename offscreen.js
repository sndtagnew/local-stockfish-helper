/*
 * Local analysis bridge.
 *
 * Runs the bundled Stockfish build inside an offscreen document so the
 * extension no longer depends on a paid remote analysis service.
 */

const OFFSCREEN_TARGET = "chesshelper-offscreen";
const ENGINE_WASM = "engine/stockfish.wasm.js";
const ENGINE_ASM = "engine/stockfish.js";

let engine = null;
let engineReady = false;
let initPromise = null;
let initResolve = null;
let initReject = null;
let initTimer = null;
let current = null;
const queue = [];

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function supportsWasm() {
  try {
    return (
      typeof WebAssembly === "object" &&
      WebAssembly.validate(
        new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      )
    );
  } catch {
    return false;
  }
}

function resetEngine(error) {
  const err =
    error instanceof Error ? error : new Error(String(error || "Engine reset"));
  engineReady = false;
  if (initTimer) {
    clearTimeout(initTimer);
    initTimer = null;
  }
  initResolve = null;
  initReject = null;
  initPromise = null;
  if (engine) {
    try {
      engine.terminate();
    } catch {}
    engine = null;
  }
  failAll(err);
}

function createEngine() {
  const worker = new Worker(
    chrome.runtime.getURL(supportsWasm() ? ENGINE_WASM : ENGINE_ASM),
  );

  worker.onmessage = (event) => handleLine(String(event.data));
  worker.onerror = (event) => {
    const error = new Error(
      event.message || "Stockfish worker failed to start",
    );
    if (initReject) {
      const reject = initReject;
      initReject = null;
      initResolve = null;
      clearTimeout(initTimer);
      initTimer = null;
      initPromise = null;
      engineReady = false;
      if (engine) {
        try {
          engine.terminate();
        } catch {}
        engine = null;
      }
      reject(error);
      failAll(error);
      return;
    }
    resetEngine(error);
  };

  return worker;
}

function init() {
  if (initPromise) return initPromise;
  if (engineReady && engine) return Promise.resolve();

  initPromise = new Promise((resolve, reject) => {
    try {
      engine = createEngine();

      initResolve = () => {
        clearTimeout(initTimer);
        initTimer = null;
        engineReady = true;
        resolve();
      };
      initReject = (error) => {
        const err =
          error instanceof Error
            ? error
            : new Error(String(error || "Engine init failed"));
        clearTimeout(initTimer);
        initTimer = null;
        engineReady = false;
        initResolve = null;
        initReject = null;
        initPromise = null;
        if (engine) {
          try {
            engine.terminate();
          } catch {}
          engine = null;
        }
        reject(err);
        failAll(err);
      };
      initTimer = setTimeout(() => {
        const err = new Error("Stockfish startup timed out");
        if (initReject) {
          initReject(err);
        } else {
          resetEngine(err);
        }
      }, 20000);

      engine.postMessage("uci");
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error(String(error || "Engine init failed"));
      engineReady = false;
      initResolve = null;
      initReject = null;
      clearTimeout(initTimer);
      initTimer = null;
      initPromise = null;
      if (engine) {
        try {
          engine.terminate();
        } catch {}
        engine = null;
      }
      reject(err);
    }
  });

  return initPromise;
}

function handleLine(line) {
  if (line === "uciok") {
    engine.postMessage("isready");
    return;
  }

  if (line === "readyok") {
    if (initResolve) {
      const resolve = initResolve;
      initResolve = null;
      initReject = null;
      resolve();
    }
    drain();
    return;
  }

  if (line.startsWith("info ")) {
    if (current) parseInfo(line);
    return;
  }

  if (line.startsWith("bestmove")) {
    finishCurrent(line);
  }
}

function parseInfo(line) {
  const depth = line.match(/\bdepth (\d+)/);
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/);

  if (depth) current.depth = parseInt(depth[1], 10);
  if (score) {
    current.scoreType = score[1];
    current.score = parseInt(score[2], 10);
  }
  if (pv) current.pv = pv[1].trim().split(/\s+/);
}

function buildResult(request) {
  const side = (request.fen.split(/\s+/)[1] || "w").toLowerCase();
  let evaluation = request.scoreType === "cp" ? request.score : null;
  let mate = request.scoreType === "mate" ? request.score : null;

  // Stockfish reports scores from the side-to-move point of view. The overlay
  // expects White's point of view, so flip the sign when Black is to move.
  if (side === "b") {
    if (evaluation !== null) evaluation = -evaluation;
    if (mate !== null) mate = -mate;
  }

  return {
    success: true,
    bestMove: request.bestMove,
    ponder: request.ponder || null,
    evaluation: mate === null ? (evaluation === null ? 0 : evaluation) : null,
    mate,
    depth: request.depth || request.depthLimit,
  };
}

function finishCurrent(line) {
  const parts = line.trim().split(/\s+/);
  const bestMove = parts[1] || "";
  const ponderIndex = parts.indexOf("ponder");
  const ponder = ponderIndex >= 0 ? parts[ponderIndex + 1] : null;
  const request = current;

  current = null;
  if (request) {
    clearTimeout(request.timeout);
    request.ponder = ponder;

    if (request.cancelled) {
      request.reject(new Error("Analysis cancelled"));
      drain();
      return;
    }

    if (bestMove && bestMove !== "(none)") {
      request.bestMove = bestMove;
      request.resolve(buildResult(request));
    } else if (request.pv && request.pv.length > 0) {
      request.bestMove = request.pv[0];
      request.ponder = request.pv[1] || ponder;
      request.resolve(buildResult(request));
    } else {
      request.reject(new Error("No legal move found for this position"));
    }
  }

  drain();
}

function drain() {
  if (!engineReady || !engine || current || queue.length === 0) return;

  const request = queue.shift();
  current = request;
  request.depth = 0;
  request.scoreType = "cp";
  request.score = 0;
  request.pv = [];

  try {
    engine.postMessage(`position fen ${request.fen}`);
    engine.postMessage(
      `go depth ${request.depthLimit} movetime ${request.maxTimeMs}`,
    );
  } catch (error) {
    current = null;
    clearTimeout(request.timeout);
    request.reject(
      error instanceof Error ? error : new Error(String(error || "Engine error")),
    );
    resetEngine(error);
    return;
  }

  // Stockfish normally stops by itself. This is only a safety net for a
  // position that takes longer than expected.
  request.timeout = setTimeout(() => {
    if (current === request) {
      try {
        engine.postMessage("stop");
      } catch {}
    }
  }, request.maxTimeMs + 8000);
}

function analyze(request) {
  return new Promise((resolve, reject) => {
    const next = {
      fen: request.fen,
      depthLimit: clamp(request.depth, 1, 30),
      maxTimeMs: clamp(request.maxTimeMs || 3000, 100, 30000),
      resolve,
      reject,
    };

    // Keep only the newest pending request; intermediate positions are stale.
    while (queue.length > 0) {
      const dropped = queue.shift();
      try {
        dropped.reject(new Error("Analysis superseded"));
      } catch {}
    }
    queue.push(next);

    const start = () => {
      if (current) {
        current.cancelled = true;
        try {
          engine.postMessage("stop");
        } catch {
          resetEngine(new Error("Engine stop failed"));
        }
      } else {
        drain();
      }
    };

    if (!engineReady || !engine) {
      initPromise = null;
      init()
        .then(() => {
          if (!current) drain();
        })
        .catch((error) => {
          try {
            reject(error);
          } catch {}
        });
      return;
    }

    start();
  });
}

function stop() {
  while (queue.length > 0) {
    queue.shift().reject(new Error("Analysis cancelled"));
  }
  if (current) {
    current.cancelled = true;
    try {
      engine.postMessage("stop");
    } catch {}
  }
}

function failAll(error) {
  if (current) {
    clearTimeout(current.timeout);
    current.reject(error);
    current = null;
  }
  while (queue.length > 0) {
    queue.shift().reject(error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (!message || message.target !== OFFSCREEN_TARGET) return false;

  if (message.type === "LOCAL_ANALYZE") {
    init()
      .then(() => analyze(message))
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error && error.message ? error.message : String(error),
        }),
      );
    return true;
  }

  if (message.type === "LOCAL_STOP") {
    stop();
    sendResponse({ success: true });
    return false;
  }

  return false;
});

// Warm up the engine as soon as the offscreen document is created.
init().catch(() => {});
