// How long the GPU spent on each drawn frame, for the globe's performance display.
//
// Frame times say whether the globe kept up, but not who fell behind: the page's JavaScript is
// timed already, and a slow frame with little JavaScript in it points at the GPU without
// proving it. WebGL2's disjoint timer query measures it outright -- the GPU timestamps the start
// and the end of the frame's commands, and the answer comes back a frame or more later.
//
// Only some browsers offer it. MDN's compatibility data has desktop Chrome and Edge with it, and
// Safari (macOS and iOS), Firefox and Chrome on Android without. So on a phone this is usually
// missing, and the display says so rather than guessing at a number.
//
// Answers come back in the order the queries went out. A "disjoint" event -- the GPU's clock
// reset, or the GPU switched or throttled -- makes any answer still in flight meaningless, so
// those are thrown away rather than reported.

const EXTENSION = 'EXT_disjoint_timer_query_webgl2';

// Frames timed and not yet answered. More than this means the answers are not coming, and new
// frames go untimed until they do rather than piling up GPU objects.
export const MAX_PENDING = 6;

export function createGpuTimer(gl) {
  const timer = { gl, ext: null, pending: [], open: null };
  restartGpuTimer(timer);
  return timer;
}

// From scratch, as after a lost context comes back: the extension has to be asked for again,
// and nothing issued before the loss will ever be answered. Returns whether timing is possible.
export function restartGpuTimer(timer) {
  timer.pending = [];
  timer.open = null;
  timer.ext = null;
  try {
    if (timer.gl && typeof timer.gl.getExtension === 'function') timer.ext = timer.gl.getExtension(EXTENSION) || null;
  } catch { /* a context that cannot say: untimed */ }
  return !!timer.ext;
}

export function gpuTimerAvailable(timer) {
  return !!(timer && timer.ext);
}

// Start timing a frame: everything the GPU is given from here to endGpuFrame. False when the
// frame goes untimed -- no extension, a frame already open, or too many still unanswered.
export function beginGpuFrame(timer) {
  if (!timer || !timer.ext || timer.open || timer.pending.length >= MAX_PENDING) return false;
  const query = timer.gl.createQuery();
  if (!query) return false;
  timer.gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, query);
  timer.open = query;
  return true;
}

// Stop timing the frame begun last. `tag` comes back with its answer.
export function endGpuFrame(timer, tag) {
  if (!timer || !timer.open) return;
  timer.gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
  timer.pending.push({ query: timer.open, tag });
  timer.open = null;
}

// Whatever has been answered, oldest first: `onResult(ms, tag)` for each frame. Call it once a
// frame; answers are never ready within the frame that asked.
export function pollGpuFrames(timer, onResult) {
  if (!timer || !timer.ext || !timer.pending.length) return;
  const { gl, ext } = timer;
  // The queries died with the context.
  if (gl.isContextLost()) {
    timer.pending = [];
    timer.open = null;
    return;
  }
  // Reading it resets it: it says whether anything disjoint happened since the last read.
  if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
    for (const { query } of timer.pending) gl.deleteQuery(query);
    timer.pending = [];
    return;
  }
  while (timer.pending.length) {
    const { query, tag } = timer.pending[0];
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
    timer.pending.shift();
    const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
    gl.deleteQuery(query);
    if (Number.isFinite(ns) && ns >= 0) onResult(ns / 1e6, tag);
  }
}
