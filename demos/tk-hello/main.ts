/**
 * tk-hello demo: drive the wacl-tk runtime from JavaScript using the
 * Pyodide-style API. The Tcl script lives here in JS rather than being
 * baked into a per-demo C wasm.
 */

import { loadWaclTk } from '../../src/wacl-tk.js';

const t0 = performance.now();

(() => {
  const orig = window.setTimeout;
  const log: { ms: number; delay: number; stack?: string }[] = [];
  (window as any).__stcounts__ = log;
  let bigStackCaptured = 0;
  (window as any).setTimeout = ((fn: any, ms?: number, ...rest: any[]) => {
    const now = performance.now() - t0;
    log.push({ ms: now, delay: ms ?? 0 });
    if ((ms ?? 0) > 100 && bigStackCaptured < 1) {
      bigStackCaptured++;
      console.log(`[BIG sleep ms=${ms} @${now.toFixed(0)}ms]`);
      console.log(new Error().stack);
    }
    return orig(fn as any, ms as any, ...rest);
  }) as any;
})();

const wacl = await loadWaclTk();
const t1 = performance.now();
console.log(`tk-hello: loadWaclTk took ${(t1 - t0).toFixed(0)}ms`);

wacl.runTcl(`
  label .title -text {Tk on WebAssembly} -font {Helvetica 14 bold} -pady 6
  pack  .title -fill x
  frame .sep -height 2 -relief sunken -bd 1
  pack  .sep  -fill x -padx 8 -pady 2

  # Direct system-font usage. The em-x11 Xft layer pipes any vendor
  # family straight to CSS, with a generic fallback appended, so the
  # browser picks whatever the OS has installed.
  label .yh   -text {Microsoft YaHei sample — quick brown fox} \
              -font {{Microsoft YaHei} 12} -pady 2
  label .mono -text {const greeting = "monospace"; // Cascadia Code} \
              -font {{Cascadia Code} 11} -pady 2
  label .ser  -text {Georgia serif sample — quick brown fox} \
              -font {Georgia 12 italic} -pady 2
  label .heavy -text {Bold sample} \
              -font {Helvetica 13 bold}
  pack .yh .mono .ser .heavy -anchor w -padx 8

  frame .row1
  label  .row1.l -text {Name:} -width 8 -anchor e
  entry  .row1.e -textvariable ::name -width 18
  button .row1.b -text {Greet} -command {
      set m "Hello, [expr {$::name eq {} ? {World} : $::name}]!"
      .out configure -text $m
  }
  pack .row1.l .row1.e .row1.b -side left -padx 4 -pady 6
  pack .row1

  frame .row2
  label  .row2.cl  -text {Clicks:} -width 8 -anchor e
  label  .row2.cv  -textvariable ::clicks -width 4 -relief sunken -anchor e
  button .row2.inc -text { + } -command {incr ::clicks}
  button .row2.dec -text { - } -command {if {$::clicks > 0} {incr ::clicks -1}}
  button .row2.rst -text {Reset} -command {set ::clicks 0}
  pack .row2.cl .row2.cv .row2.inc .row2.dec .row2.rst -side left -padx 4 -pady 6
  pack .row2

  label .out -text {(press Greet)} -relief groove -bd 2 -padx 8 -pady 4 -width 32
  pack  .out -padx 12 -pady 8

  set ::name {}
  set ::clicks 0
`);
const t2 = performance.now();
console.log(`tk-hello: runTcl took ${(t2 - t1).toFixed(0)}ms`);

queueMicrotask(() => {
  console.log(`tk-hello: first microtask at ${(performance.now() - t0).toFixed(0)}ms`);
});
setTimeout(() => {
  console.log(`tk-hello: first setTimeout(0) at ${(performance.now() - t0).toFixed(0)}ms`);
}, 0);
requestAnimationFrame(() => {
  const t4 = performance.now();
  console.log(`tk-hello: first rAF after init at ${(t4 - t0).toFixed(0)}ms from start`);
  const ps = (globalThis as any).__wacltk_pump__;
  if (ps) {
    console.log(
      `tk-hello: pump stats — sync ${ps.sync}, async ${ps.async} (in ${ps.asyncMs.toFixed(0)}ms)`,
    );
  }
  const sts = (globalThis as any).__stcounts__ as { ms: number; delay: number }[];
  if (sts) {
    const total = sts.length;
    const before1s = sts.filter((s) => s.ms < 1000).length;
    const _1to2 = sts.filter((s) => s.ms >= 1000 && s.ms < 2000).length;
    const _2to3 = sts.filter((s) => s.ms >= 2000 && s.ms < 3000).length;
    const _3to4 = sts.filter((s) => s.ms >= 3000 && s.ms < 4000).length;
    console.log(
      `tk-hello: setTimeout calls — total ${total}; <1s ${before1s}, 1-2s ${_1to2}, 2-3s ${_2to3}, 3-4s ${_3to4}`,
    );
  }
});

console.log(`tk-hello: Tcl ${wacl.version} / Tk ${wacl.tkVersion} ready`);
console.log(`tk-hello: clicks = ${wacl.globals.get('clicks')}`);
const fs = (globalThis as any).__emx11_fontStats__;
if (fs) {
  console.log(
    `tk-hello: font measure stats — font ${fs.fontHits}/${fs.fontCalls} hits in ${fs.fontMs.toFixed(1)}ms; ` +
    `text ${fs.textHits}/${fs.textCalls} hits in ${fs.textMs.toFixed(1)}ms`,
  );
}
