/*
 * tk-hello -- smoke test for Tk 8.6 on top of em-x11.
 *
 * Minimal Tk app: create a single button. If this paints, it proves
 * Tcl + Tk + em-x11 all compose correctly without a real X server.
 */

#include <tcl.h>
#include <tk.h>
#include <stdio.h>
#include <stdlib.h>
#include <emscripten.h>

/*
 * Browser-friendly Tcl notifier.
 *
 * Tcl's default Unix notifier calls select() on a pipe fd inside
 * Tcl_WaitForEvent. Under Emscripten that select() blocks the main
 * thread forever: no emscripten_sleep yield means no browser event
 * pump, no queued X events, and the page freezes hard. The symptom we
 * saw was output stopping exactly at `Tk initialized` -- the very next
 * Tcl_Eval (containing `update`) enters the notifier and never returns.
 *
 * Replacement strategy: Tcl_SetNotifier with procs that yield to the
 * browser in waitForEventProc, plus a minimal file-handler table so
 * Tk's DisplayFileProc (registered on the X connection fd via
 * Tcl_CreateFileHandler) actually runs every tick. Without invoking
 * those handlers, em-x11's event queue fills up but Tk never drains
 * it; the visible symptom was push_map_notify firing for Tk's wrapper
 * window but `winfo ismapped .` still reporting 0 because Tk's
 * WrapperEventProc -- which sets TK_MAPPED on the toplevel and chains
 * an XMapWindow to the inner `.` -- was never invoked.
 */
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
    fprintf(stderr, "tk-hello: file handler table full (fd=%d dropped)\n", fd);
}

static void track_DeleteFileHandler(int fd) {
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && g_handlers[i].fd == fd) {
            g_handlers[i].in_use = 0;
            return;
        }
    }
}

static void  nop_SetTimer(const Tcl_Time *t) { (void)t; }
static void *nop_InitNotifier(void)          { return (void *)1; }
static void  nop_FinalizeNotifier(ClientData cd) { (void)cd; }
static void  nop_AlertNotifier(ClientData cd)    { (void)cd; }
static void  nop_ServiceModeHook(int mode)       { (void)mode; }

static int yield_WaitForEvent(const Tcl_Time *timePtr) {
    /* One browser tick per call, then pump every registered file
     * handler with TCL_READABLE. DisplayFileProc is idempotent when
     * XEventsQueued returns 0 (it XNoOp's and returns), so unconditional
     * invocation is safe. Always return 0 -- we're not claiming to have
     * serviced a Tcl event here; the events we drain land on Tcl's
     * queue via Tk_HandleEvent inside the handler. */
    (void)timePtr;
    emscripten_sleep(1);
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

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    printf("tk-hello: main entered\n"); fflush(stdout);

    /* Must happen before Tcl_CreateInterp so the interp picks up our
     * procs on first notifier initialization. */
    install_browser_notifier();
    printf("tk-hello: browser notifier installed\n"); fflush(stdout);

    /* The Tcl/Tk script libraries are preloaded into the Emscripten
     * virtual FS at /tcl and /tk respectively (see CMakeLists). Pointing
     * TCL_LIBRARY/TK_LIBRARY at those mounts lets Tcl_Init / Tk_Init
     * find init.tcl / tk.tcl without depending on argv[0]-based path
     * inference, which doesn't give anything useful under emscripten. */
    setenv("TCL_LIBRARY", "/tcl", 1);
    setenv("TK_LIBRARY",  "/tk",  1);
    /* Tk_Init calls XOpenDisplay(NULL), which reads $DISPLAY. em-x11
     * ignores the string value but needs *something* non-NULL -- an
     * empty $DISPLAY triggers "no display name" before XOpenDisplay
     * even runs. */
    setenv("DISPLAY",     ":0",  1);

    Tcl_FindExecutable(argv[0]);
    Tcl_Interp *interp = Tcl_CreateInterp();
    if (!interp) {
        fprintf(stderr, "tk-hello: Tcl_CreateInterp failed\n");
        return 1;
    }

    if (Tcl_Init(interp) != TCL_OK) {
        fprintf(stderr, "tk-hello: Tcl_Init: %s\n",
                Tcl_GetStringResult(interp));
        return 1;
    }

    /* Tk_Init needs tcl_findLibrary. auto-load usually handles this via
     * tclIndex, but source auto.tcl directly as a belt-and-braces guard. */
    if (Tcl_Eval(interp, "source /tcl/auto.tcl") != TCL_OK) {
        fprintf(stderr, "tk-hello: source auto.tcl: %s\n",
                Tcl_GetStringResult(interp));
    }

    if (Tk_Init(interp) != TCL_OK) {
        fprintf(stderr, "tk-hello: Tk_Init: %s\n",
                Tcl_GetStringResult(interp));
        return 1;
    }

    printf("tk-hello: Tk initialized\n"); fflush(stdout);

    /* Build the button, then probe Tk's view of the widget tree. If `.b`
     * is created and mapped but em-x11 shows only the root, the fault is
     * in the draw path (XFillRectangle / XDrawString). If it's unmapped
     * or has zero geometry, the fault is in window creation / geometry
     * propagation back from em-x11 to Tk. */
    const char *script =
        /* Title */
        "label .title -text {Tk on WebAssembly} -font {Helvetica 14 bold} -pady 6\n"
        "pack  .title -fill x\n"
        "frame .sep -height 2 -relief sunken -bd 1\n"
        "pack  .sep  -fill x -padx 8 -pady 2\n"

        /* Input row */
        "frame .row1\n"
        "label  .row1.l -text {Name:} -width 8 -anchor e\n"
        "entry  .row1.e -textvariable ::name -width 18\n"
        "button .row1.b -text {Greet} -command {\n"
        "    set m \"Hello, [expr {$::name eq {} ? {World} : $::name}]!\"\n"
        "    .out configure -text $m\n"
        "}\n"
        "pack .row1.l .row1.e .row1.b -side left -padx 4 -pady 6\n"
        "pack .row1\n"

        /* Counter row */
        "frame .row2\n"
        "label  .row2.cl  -text {Clicks:} -width 8 -anchor e\n"
        "label  .row2.cv  -textvariable ::clicks -width 4 -relief sunken -anchor e\n"
        "button .row2.inc -text { + } -command {incr ::clicks}\n"
        "button .row2.dec -text { - } -command {if {$::clicks > 0} {incr ::clicks -1}}\n"
        "button .row2.rst -text {Reset} -command {set ::clicks 0}\n"
        "pack .row2.cl .row2.cv .row2.inc .row2.dec .row2.rst -side left -padx 4 -pady 6\n"
        "pack .row2\n"

        /* Output label */
        "label .out -text {(press Greet)} -relief groove -bd 2 -padx 8 -pady 4 -width 32\n"
        "pack  .out -padx 12 -pady 8\n"

        "set ::name {}\n"
        "set ::clicks 0\n"

        "update\n"
        "puts \"tk-hello: winfo ismapped . = [winfo ismapped .]\"\n"
        "puts \"tk-hello: winfo geometry . = [winfo geometry .]\"\n";
    if (Tcl_Eval(interp, script) != TCL_OK) {
        fprintf(stderr, "tk-hello: script error: %s\n",
                Tcl_GetStringResult(interp));
        return 1;
    }

    printf("tk-hello: entering main loop\n"); fflush(stdout);
    while (Tk_GetNumMainWindows() > 0) {
        Tcl_DoOneEvent(0);
    }
    return 0;
}
