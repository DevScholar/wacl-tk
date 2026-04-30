/**
 * wacl-tk: Pyodide-style JavaScript API for the Tcl/Tk WebAssembly
 * runtime. Mirrors the loadPyodide() shape so users coming from
 * Pyodide can pick this up without re-learning anything.
 *
 *   import { loadWaclTk } from './wacl-tk.js';
 *
 *   const wacl = await loadWaclTk();
 *   wacl.runTcl(`
 *     button .b -text Click -command { incr ::n }
 *     pack .b
 *   `);
 *   console.log(wacl.globals.get('tcl_version'));
 *
 * The runtime under the hood is a single wasm built from runtime/
 * (`wacl-tk-runtime.{js,wasm,data}`) that links Tcl, Tk, and em-x11
 * statically. em-x11's Host installs itself on globalThis and paints
 * Tk's X11 calls into a <canvas>. By default we create that canvas
 * inside document.body; the host page can attach an existing one with
 * the `canvas` option (Pyodide's `setCanvas2D` analog).
 */

import { Host } from '../../em-x11/src/host/index.js';
import type { EmscriptenModule } from '../../em-x11/src/types/emscripten.js';

/* ---------------- Errors ---------------- */

/** Thrown by runTcl/runTclAsync when the script returns TCL_ERROR.
 *  Mirrors Pyodide's PythonError. The message contains the value of
 *  Tcl's $errorInfo (the equivalent of a Python traceback). */
export class TclError extends Error {
  override name = 'TclError';
  constructor(public readonly errorInfo: string) {
    super(errorInfo);
  }
}

/* ---------------- Public types ---------------- */

export interface WaclTkConfig {
  /** Base URL where wacl-tk-runtime.{js,wasm,data} live. Default:
   *  `/build/artifacts/wacl-tk-runtime`. */
  indexURL?: string;
  /** Override the URL of the .js glue. Default: `${indexURL}/wacl-tk-runtime.js`. */
  glueURL?: string;
  /** Override the URL of the .wasm. Default: `${indexURL}/wacl-tk-runtime.wasm`. */
  wasmURL?: string;
  /** Existing <canvas> for Tk to paint into. If omitted, a 1024x768
   *  canvas is created and appended to document.body. */
  canvas?: HTMLCanvasElement;
  /** Logical width/height when creating a canvas. Ignored when `canvas`
   *  is provided (its current size is used). */
  width?: number;
  height?: number;
  /** Override the standard output callback. Same semantics as
   *  Pyodide's stdout option: receives one full line per call. */
  stdout?: (msg: string) => void;
  /** Override the standard error callback. */
  stderr?: (msg: string) => void;
}

export interface WaclTkAPI {
  /** Tcl runtime version (e.g. `"8.6.13"`). */
  readonly version: string;
  /** Tk runtime version (e.g. `"8.6.13"`). */
  readonly tkVersion: string;
  /** Emscripten FS object (the in-memory filesystem). */
  readonly FS: typeof FS;
  /** The em-x11 Host driving Tk's X11 calls. Advanced use. */
  readonly host: Host;
  /** Raw Emscripten module. Advanced use. */
  readonly module: EmscriptenModule;

  /** Run a Tcl script synchronously. Returns the script's result as a
   *  string. Throws {@link TclError} on TCL_ERROR. */
  runTcl(code: string): string;

  /** Run a Tcl script while pumping the Tk event loop in the background.
   *  Use this for scripts that call `vwait`, `tkwait`, or `update`. */
  runTclAsync(code: string): Promise<string>;

  /** Tcl global namespace, mirroring `pyodide.globals`. */
  readonly globals: WaclTkGlobals;

  /** Canvas plumbing, mirroring `pyodide.canvas`. */
  readonly canvas: WaclTkCanvas;

  /** Override stdout. */
  setStdout(opts: { batched: (msg: string) => void }): void;
  /** Override stderr. */
  setStderr(opts: { batched: (msg: string) => void }): void;
}

export interface WaclTkGlobals {
  /** Read a Tcl global variable. Returns undefined if it does not exist. */
  get(name: string): string | undefined;
  /** Set a Tcl global variable. The value is converted with String(). */
  set(name: string, value: unknown): void;
  /** True if the global variable is defined. */
  has(name: string): boolean;
  /** Unset a Tcl global variable. No-op if it does not exist. */
  delete(name: string): void;
}

export interface WaclTkCanvas {
  /** The canvas Tk is currently painting into. */
  getCanvas2D(): HTMLCanvasElement;
}

/* ---------------- Implementation ---------------- */

interface CwrapModule {
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
}

export async function loadWaclTk(config: WaclTkConfig = {}): Promise<WaclTkAPI> {
  const indexURL = (config.indexURL ?? '/build/artifacts/wacl-tk-runtime').replace(/\/+$/, '');
  const glueURL  = config.glueURL  ?? `${indexURL}/wacl-tk-runtime.js`;
  const wasmURL  = config.wasmURL  ?? `${indexURL}/wacl-tk-runtime.wasm`;

  const host = new Host({
    element: config.canvas,
    width: config.width,
    height: config.height,
  });
  host.install();

  /* Hide the canvas during boot so the user doesn't see the
   * intermediate states (blank canvas → Tk root toplevel `.`'s
   * default `#d9d9d9` background → first widgets paint) as a visible
   * staircase. Microtasks run before the browser paints, so as long
   * as we reveal before returning from loadWaclTk the page only
   * frames the final state. We don't reset the property if the host
   * page already overrode `visibility` -- that would clobber a
   * caller who explicitly wants the canvas hidden longer. */
  const canvasEl = host.canvas.element;
  const restoreVisibility = canvasEl.style.visibility;
  if (!restoreVisibility) canvasEl.style.visibility = 'hidden';

  /* Hand the print/printErr through Module overrides so Tcl's puts
   * actually lands where the caller asked. We capture the user
   * callbacks in mutable slots so setStdout/setStderr can swap them
   * after launch. */
  let stdoutCb = config.stdout ?? ((m: string) => console.log(m));
  let stderrCb = config.stderr ?? ((m: string) => console.error(m));

  const { module } = await host.launchClient({
    glueUrl: glueURL,
    wasmUrl: wasmURL,
    /* preRun runs after MEMFS init but before main(); using moduleArgs
     * via the launcher would also work, but Module.print/printErr have
     * to be installed before main() to capture init-time output. */
    preRun: [
      (mod) => {
        (mod as unknown as { print: (m: string) => void }).print    = (m: string) => stdoutCb(m);
        (mod as unknown as { printErr: (m: string) => void }).printErr = (m: string) => stderrCb(m);
      },
    ],
  });

  const mod = module as EmscriptenModule & CwrapModule;
  const cwrap = mod.cwrap;

  const c_eval         = cwrap('wacl_eval',         'number', ['string']) as (s: string) => number | Promise<number>;
  const c_result       = cwrap('wacl_result',       'string', [])         as () => string;
  const c_get_var      = cwrap('wacl_get_var',      'string', ['string']) as (n: string) => string | null;
  const c_set_var      = cwrap('wacl_set_var',      'string', ['string', 'string']) as (n: string, v: string) => string | null;
  const c_do_one_event = cwrap('wacl_do_one_event', 'number', [])         as () => number | Promise<number>;

  /* ASYNCIFY-enabled wasm: every imported call returns either a value
   * (when no emscripten_sleep was hit) or a Promise (when it was).
   * We must serialise calls -- two parallel cwrap invocations would
   * stomp on the same Asyncify state. A single-slot Promise chain
   * keeps everything well-ordered without any user-visible API. */
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(fn);
    chain = next.catch(() => undefined);
    return next;
  };

  /* Drive the Tk event loop on requestAnimationFrame so timer/expose/
   * input events keep flowing while no user eval is pending. The pump
   * itself queues onto the same chain, so it'll never run during a
   * script -- it just fills the gaps. */
  const startPump = () => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      void queue(() => c_do_one_event());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { stopped = true; };
  };
  startPump();

  /* Read tclversion / tk_version through the same path so we get
   * whatever the linked archives report. */
  const versionTcl = c_get_var('tcl_version') ?? '';
  const versionTk  = c_get_var('tk_version')  ?? '';

  const runOnce = (code: string): string => {
    /* If the eval doesn't yield, cwrap returns a number synchronously
     * and we can return immediately. If it yields, we still synchronously
     * return -- but the result reflects state-up-to-that-point and any
     * thrown TCL_ERROR will show up on the next tick. For scripts that
     * yield (vwait/update), use runTclAsync. */
    const rc = c_eval(code);
    if (rc instanceof Promise) {
      throw new Error(
        'wacl-tk: runTcl saw an async script (it called vwait/update). ' +
        'Use runTclAsync(...) instead.',
      );
    }
    const result = c_result();
    if (rc !== 0) throw new TclError(result);
    /* Drain pending idle handlers and paint events right away. Without
     * this the result of a `pack` / `wm geometry` chain only paints on
     * the next requestAnimationFrame tick (~16ms later, sometimes more
     * if the browser deprioritises us). The drain is non-blocking
     * (TCL_DONT_WAIT inside wacl_do_one_event) so we never re-enter
     * Asyncify -- it just flushes whatever's already queued. */
    c_do_one_event();
    return result;
  };

  const runOnceAsync = async (code: string): Promise<string> => {
    const rc = await c_eval(code);
    const result = c_result();
    if (rc !== 0) throw new TclError(result);
    await c_do_one_event();
    return result;
  };

  const globals: WaclTkGlobals = {
    get(name) {
      const v = c_get_var(name);
      return v == null ? undefined : v;
    },
    set(name, value) {
      c_set_var(name, String(value));
    },
    has(name) {
      return c_get_var(name) != null;
    },
    delete(name) {
      /* No direct unset entry point -- go through Tcl. */
      void runOnce(`unset -nocomplain ::${name}`);
    },
  };

  const canvas: WaclTkCanvas = {
    getCanvas2D: () => host.canvas.element,
  };

  if (!restoreVisibility) canvasEl.style.visibility = '';

  return {
    version: versionTcl,
    tkVersion: versionTk,
    FS: (mod as unknown as { FS: typeof FS }).FS,
    host,
    module: mod,
    runTcl: (code) => {
      /* runTcl is the simple sync path. Most scripts (widget creation,
       * variable sets, expression eval) finish without yielding. */
      // The pump may have a do-one-event in flight; flush by queueing
      // through the chain but blocking is impossible from sync code.
      // Users who hit the Promise branch get a clear error directing
      // them to runTclAsync.
      return runOnce(code);
    },
    runTclAsync: (code) => queue(() => runOnceAsync(code)),
    globals,
    canvas,
    setStdout: (opts) => { stdoutCb = opts.batched; },
    setStderr: (opts) => { stderrCb = opts.batched; },
  };
}
