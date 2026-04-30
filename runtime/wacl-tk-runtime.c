/*
 * wacl-tk-runtime -- generic Tcl/Tk wasm runtime exposing a Pyodide-style
 * JS API. main() initialises Tcl + Tk + the browser notifier and returns;
 * the runtime stays alive (noExitRuntime). All evaluation happens through
 * cwrap'd entry points the JS loader calls:
 *
 *   wacl_init        -- create interp, run Tcl_Init / Tk_Init.
 *   wacl_eval        -- Tcl_Eval into a private result slot.
 *   wacl_result      -- last captured result (or errorInfo on TCL_ERROR).
 *   wacl_get_var     -- Tcl_GetVar in global scope.
 *   wacl_set_var     -- Tcl_SetVar in global scope.
 *   wacl_do_one_event-- pump the Tcl/Tk event queue once (TCL_DONT_WAIT).
 *
 * The browser notifier is the same shape as demos/tk-hello/tk-hello.c:
 * yield to the browser per-tick and pump every registered fd handler so
 * Tk's X-fd DisplayFileProc actually runs. See
 * project_tk_browser_notifier in memory for the full why.
 */

#include <tcl.h>
#include <tk.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#define MAX_FILE_HANDLERS 8
typedef struct {
    int fd;
    int mask;
    Tcl_FileProc *proc;
    ClientData cd;
    int in_use;
} FileHandler;
static FileHandler g_handlers[MAX_FILE_HANDLERS];

static void track_CreateFileHandler(int fd, int mask, Tcl_FileProc *proc, ClientData cd) {
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && g_handlers[i].fd == fd) {
            g_handlers[i].mask = mask;
            g_handlers[i].proc = proc;
            g_handlers[i].cd   = cd;
            return;
        }
    }
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (!g_handlers[i].in_use) {
            g_handlers[i].in_use = 1;
            g_handlers[i].fd   = fd;
            g_handlers[i].mask = mask;
            g_handlers[i].proc = proc;
            g_handlers[i].cd   = cd;
            return;
        }
    }
    fprintf(stderr, "wacl-tk: file handler table full (fd=%d dropped)\n", fd);
}

static void track_DeleteFileHandler(int fd) {
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && g_handlers[i].fd == fd) {
            g_handlers[i].in_use = 0;
            return;
        }
    }
}

static void  nop_SetTimer(const Tcl_Time *t)        { (void)t; }
static void *nop_InitNotifier(void)                 { return (void *)1; }
static void  nop_FinalizeNotifier(ClientData cd)    { (void)cd; }
static void  nop_AlertNotifier(ClientData cd)       { (void)cd; }
static void  nop_ServiceModeHook(int mode)          { (void)mode; }

static int yield_WaitForEvent(const Tcl_Time *timePtr) {
    /* timePtr == NULL means block-until-event; timePtr->{0,0} means
     * poll. We must NOT yield to JS on the poll path: the JS loader
     * polls every animation frame to keep Tk responsive, and yielding
     * from inside a synchronous user runTcl() would let the JS-side
     * pump re-enter wasm and corrupt Asyncify state. Drain the
     * registered fd handlers either way -- that's how Tk's
     * DisplayFileProc consumes em-x11 events without us ever sleeping. */
    int polling = (timePtr && timePtr->sec == 0 && timePtr->usec == 0);
    if (!polling) {
        emscripten_sleep(1);
    }
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && (g_handlers[i].mask & TCL_READABLE)) {
            g_handlers[i].proc(g_handlers[i].cd, TCL_READABLE);
        }
    }
    return 0;
}

static void install_browser_notifier(void) {
    Tcl_NotifierProcs procs;
    procs.setTimerProc           = nop_SetTimer;
    procs.waitForEventProc       = yield_WaitForEvent;
    procs.createFileHandlerProc  = track_CreateFileHandler;
    procs.deleteFileHandlerProc  = track_DeleteFileHandler;
    procs.initNotifierProc       = nop_InitNotifier;
    procs.finalizeNotifierProc   = nop_FinalizeNotifier;
    procs.alertNotifierProc      = nop_AlertNotifier;
    procs.serviceModeHookProc    = nop_ServiceModeHook;
    Tcl_SetNotifier(&procs);
}

/* --------------------------------------------------------------------- */

static Tcl_Interp *g_interp   = NULL;
static char       *g_result   = NULL;   /* malloc'd; result of last eval/get */
static int         g_last_rc  = TCL_OK;

static void set_result(const char *s) {
    if (g_result) { free(g_result); g_result = NULL; }
    if (s) {
        size_t n = strlen(s);
        g_result = (char *)malloc(n + 1);
        if (g_result) memcpy(g_result, s, n + 1);
    }
}

EMSCRIPTEN_KEEPALIVE
int wacl_init(void) {
    if (g_interp) return 0;

    install_browser_notifier();

    setenv("TCL_LIBRARY", "/tcl", 1);
    setenv("TK_LIBRARY",  "/tk",  1);
    setenv("DISPLAY",     ":0",   1);

    Tcl_FindExecutable("wacl-tk-runtime");
    g_interp = Tcl_CreateInterp();
    if (!g_interp) { set_result("Tcl_CreateInterp failed"); return 1; }

    if (Tcl_Init(g_interp) != TCL_OK) {
        set_result(Tcl_GetStringResult(g_interp));
        return 1;
    }

    /* Belt-and-braces: source auto.tcl so tcl_findLibrary is loaded
     * before Tk_Init asks for it. */
    Tcl_Eval(g_interp, "catch {source /tcl/auto.tcl}");

    if (Tk_Init(g_interp) != TCL_OK) {
        set_result(Tcl_GetStringResult(g_interp));
        return 1;
    }

    /* Force one update so Tk's main window realises before the first
     * user eval has a chance to pack widgets. Without this, the first
     * `pack` call against `.` runs before the wrapper is mapped and
     * the toplevel paints with stale geometry. */
    Tcl_Eval(g_interp, "update");
    set_result("");
    g_last_rc = TCL_OK;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int wacl_eval(const char *code) {
    if (!g_interp) { set_result("wacl: interp not initialised"); return TCL_ERROR; }
    g_last_rc = Tcl_Eval(g_interp, code);
    if (g_last_rc == TCL_OK) {
        set_result(Tcl_GetStringResult(g_interp));
    } else {
        /* Match Pyodide's PythonError: include the traceback (errorInfo). */
        const char *info = Tcl_GetVar(g_interp, "errorInfo", TCL_GLOBAL_ONLY);
        set_result(info ? info : Tcl_GetStringResult(g_interp));
    }
    return g_last_rc;
}

EMSCRIPTEN_KEEPALIVE
const char *wacl_result(void) {
    return g_result ? g_result : "";
}

EMSCRIPTEN_KEEPALIVE
const char *wacl_get_var(const char *name) {
    if (!g_interp) return NULL;
    return Tcl_GetVar(g_interp, name, TCL_GLOBAL_ONLY);
}

EMSCRIPTEN_KEEPALIVE
const char *wacl_set_var(const char *name, const char *value) {
    if (!g_interp) return NULL;
    return Tcl_SetVar(g_interp, name, value, TCL_GLOBAL_ONLY);
}

/* Pump the event queue once with TCL_ALL_EVENTS|TCL_DONT_WAIT. JS
 * drives this on requestAnimationFrame so Tk's idle callbacks (the
 * ones that actually run geometry-manager redraws) fire even when
 * the page is otherwise idle. Returns nonzero if an event was
 * processed. We pin the flag combo here so the JS side doesn't have
 * to duplicate Tcl's bit definitions and get them wrong --
 * `TCL_ALL_EVENTS = ~TCL_DONT_WAIT` is a sign-extended ~0, which is
 * easy to misencode as 0x1f and silently drop TCL_IDLE_EVENTS (0x20). */
EMSCRIPTEN_KEEPALIVE
int wacl_do_one_event(void) {
    if (!g_interp) return 0;
    return Tcl_DoOneEvent(TCL_ALL_EVENTS | TCL_DONT_WAIT);
}

EMSCRIPTEN_KEEPALIVE
int wacl_main_windows(void) {
    return Tk_GetNumMainWindows();
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    /* Initialise eagerly. The JS loader calls wacl_init again as a
     * no-op for the result-code, but doing the work here means the
     * loader's first wacl_eval is ready immediately. */
    if (wacl_init() != 0) {
        fprintf(stderr, "wacl-tk-runtime: init failed: %s\n", wacl_result());
        return 1;
    }
    /* Return immediately; Module.noExitRuntime keeps the runtime alive
     * so wacl_eval / wacl_do_one_event remain callable from JS. */
    return 0;
}
