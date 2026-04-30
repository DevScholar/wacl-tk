/**
 * tk-hello demo: drive the wacl-tk runtime from JavaScript using the
 * Pyodide-style API. The Tcl script lives here in JS rather than being
 * baked into a per-demo C wasm.
 */

import { loadWaclTk } from '../../src/wacl-tk.js';

const wacl = await loadWaclTk();

wacl.runTcl(`
  label .title -text {Tk on WebAssembly} -font {Helvetica 14 bold} -pady 6
  pack  .title -fill x
  frame .sep -height 2 -relief sunken -bd 1
  pack  .sep  -fill x -padx 8 -pady 2

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

console.log(`tk-hello: Tcl ${wacl.version} / Tk ${wacl.tkVersion} ready`);
console.log(`tk-hello: clicks = ${wacl.globals.get('clicks')}`);
