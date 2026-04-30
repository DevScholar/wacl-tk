# wacl-tk JavaScript API

The wacl-tk JavaScript API mirrors [Pyodide][pyodide] so users coming
from Pyodide can pick it up without re-learning anything: replace
`loadPyodide` with `loadWaclTk` and `runPython` with `runTcl`. The
shape, error semantics, and lifecycle are intentionally identical
where the languages allow.

This page documents the **most common** entry points (`loadWaclTk`,
`runTcl`, `runTclAsync`, `globals`, `canvas`, `setStdout`/`setStderr`,
`FS`, `version`). Less-common surface area (foreign function interface,
`pyimport`, lockfiles, package loading) is not yet implemented.

[pyodide]: https://pyodide.org/en/stable/usage/api/js-api.html

---

## Top-level

### `loadWaclTk(config?) → Promise<WaclTkAPI>`

Boot the runtime. Loads `wacl-tk-runtime.{js,wasm,data}`, initialises
Tcl + Tk, installs the em-x11 host on `globalThis.__EMX11__`, and
returns the API object.

```js
import { loadWaclTk } from '/src/wacl-tk.js';

const wacl = await loadWaclTk({ width: 800, height: 600 });
```

#### `WaclTkConfig`

| Field      | Type                          | Default                              | Notes |
|------------|-------------------------------|--------------------------------------|-------|
| `indexURL` | `string`                      | `/build/artifacts/wacl-tk-runtime`   | Base URL for the runtime artifacts. |
| `glueURL`  | `string`                      | `${indexURL}/wacl-tk-runtime.js`     | Override the .js glue URL. |
| `wasmURL`  | `string`                      | `${indexURL}/wacl-tk-runtime.wasm`   | Override the .wasm URL. |
| `canvas`   | `HTMLCanvasElement`           | (auto-create)                        | Existing canvas for Tk to paint into. Pyodide's `setCanvas2D` analog. |
| `width`    | `number`                      | `1024`                               | Logical width of the auto-created canvas. |
| `height`   | `number`                      | `768`                                | Logical height of the auto-created canvas. |
| `stdout`   | `(msg: string) => void`       | `console.log`                        | Replacement for Tcl's `puts stdout`. Receives one line per call. |
| `stderr`   | `(msg: string) => void`       | `console.error`                      | Replacement for Tcl's `puts stderr`. |

---

## `WaclTkAPI`

The object returned by `loadWaclTk`.

### `wacl.runTcl(code) → string`

Evaluate a Tcl script synchronously. Returns the script's result as a
string (same as the `puts $result` you'd see in `tclsh`). Throws
[`TclError`](#class-tclerror) on `TCL_ERROR`.

```js
wacl.runTcl(`
  button .b -text Click -command { incr ::n }
  pack .b
`);
const v = wacl.runTcl('expr {2 + 3}');     // "5"
```

`runTcl` will throw if the script blocks on the event loop (`vwait`,
`tkwait vis`, etc.) — use [`runTclAsync`](#waclruntclasynccode--promisestring)
for those.

### `wacl.runTclAsync(code) → Promise<string>`

Evaluate a Tcl script while the Tk event loop pumps in the background.
Required for scripts that use `vwait`, `tkwait`, or any blocking event
wait. Returns the script's result.

```js
const result = await wacl.runTclAsync(`
  after 200 { set ::done 1 }
  vwait ::done
  return "ok"
`);
```

### `wacl.globals`

Tcl global namespace, mirroring `pyodide.globals`.

| Method                   | Returns              | Description |
|--------------------------|----------------------|-------------|
| `globals.get(name)`      | `string \| undefined` | Read a Tcl global variable. `undefined` if unset. |
| `globals.set(name, val)` | `void`               | Write a Tcl global variable (value coerced via `String()`). |
| `globals.has(name)`      | `boolean`            | True if the variable is defined. |
| `globals.delete(name)`   | `void`               | Unset; no-op if it doesn't exist. |

```js
wacl.runTcl('set ::greeting "hi"');
wacl.globals.get('greeting');         // "hi"
wacl.globals.set('count', 42);
wacl.runTcl('return $::count');       // "42"
```

### `wacl.canvas`

| Method                       | Returns               |
|------------------------------|-----------------------|
| `canvas.getCanvas2D()`       | `HTMLCanvasElement`   |

Returns the HTML5 canvas Tk is painting into. Mirrors
`pyodide.canvas.getCanvas2D()`. To attach an existing canvas instead
of letting wacl-tk create one, pass it as the `canvas` option to
`loadWaclTk` — Pyodide's runtime `setCanvas2D` is not yet supported
because em-x11 binds its renderer at startup.

### `wacl.setStdout(opts)` / `wacl.setStderr(opts)`

Replace the line-buffered stdout/stderr handler. Same shape as
Pyodide's `setStdout` (only the `batched` form is supported).

```js
wacl.setStdout({ batched: (line) => myLog.append(line) });
```

### `wacl.version` · `wacl.tkVersion`

The Tcl and Tk runtime versions, e.g. `"8.6.13"`. Read straight out of
`$tcl_version` / `$tk_version` so you get whatever the linked archives
report.

### `wacl.FS`

The Emscripten in-memory filesystem object. Same surface as
`pyodide.FS` — use it to stage files into Tcl's view of the world or
to mount IDB / NODEFS. The Tcl/Tk script libraries are pre-mounted at
`/tcl` and `/tk` (set via `--preload-file`).

```js
wacl.FS.writeFile('/script.tcl', 'puts hello');
wacl.runTcl('source /script.tcl');
```

### `wacl.host` / `wacl.module`

Escape hatches. `host` is the [em-x11 `Host`](https://github.com/DevScholar/em-x11) instance;
`module` is the raw Emscripten module. Use these only for things the
high-level API doesn't cover yet.

---

## Errors

### `class TclError`

Thrown by `runTcl` / `runTclAsync` when the evaluated script returns
`TCL_ERROR`. The `errorInfo` property and `.message` both contain the
value of Tcl's `$errorInfo` (the closest analog to a Python traceback).

```js
try {
  wacl.runTcl('error "boom"');
} catch (e) {
  if (e instanceof TclError) console.warn(e.errorInfo);
}
```

---

## Mapping from Pyodide

| Pyodide                              | wacl-tk                       |
|--------------------------------------|-------------------------------|
| `loadPyodide(config)`                | `loadWaclTk(config)`          |
| `pyodide.runPython(code)`            | `wacl.runTcl(code)`           |
| `pyodide.runPythonAsync(code)`       | `wacl.runTclAsync(code)`      |
| `pyodide.globals.get(n)`             | `wacl.globals.get(n)`         |
| `pyodide.globals.set(n, v)`          | `wacl.globals.set(n, v)`      |
| `pyodide.canvas.getCanvas2D()`       | `wacl.canvas.getCanvas2D()`   |
| `pyodide.canvas.setCanvas2D(c)`      | `loadWaclTk({ canvas: c })`   |
| `pyodide.setStdout({ batched })`     | `wacl.setStdout({ batched })` |
| `pyodide.setStderr({ batched })`     | `wacl.setStderr({ batched })` |
| `pyodide.version`                    | `wacl.version`                |
| `pyodide.FS`                         | `wacl.FS`                     |
| `PythonError`                        | `TclError`                    |

---

## Calling JavaScript from Tcl (`::wacl::jscall`)

wacl-tk inherits wacl's low-level JS bridge. It lets Tcl call a
JavaScript function that has been registered in Emscripten's function
table.

### Overview

```
JS side     Module.wacl.jswrap(fn, returnType, argType)
                → returns a Tcl command string, e.g. "::wacl::jscall 42 int string"

Tcl side    eval $cmd $arg
                → calls fn($arg), returns the result as a Tcl value
```

### `Module.wacl.jswrap(fn, returnType, argType) → string`

Registers a JavaScript function in Emscripten's indirect call table and
returns the corresponding `::wacl::jscall` command string. Store the
result as a Tcl variable and call it like any other command.

```js
// JS — run before or after loadWaclTk, but before the Tcl code that uses it
const cmd = Module.wacl.jswrap(
  (name) => { console.log('Hello from Tcl:', name); return name.length; },
  'int',    // return type
  'string'  // argument type
);
wacl.globals.set('greetCmd', cmd);
```

```tcl
# Tcl
set result [eval $::greetCmd "world"]
# result == "5", and the browser console shows: Hello from Tcl: world
```

### `::wacl::jscall fcnPtr returnType argType ?arg?`

The Tcl command itself. Normally you never write this by hand — use
`jswrap` on the JS side to produce the right invocation. The arguments:

| Argument     | Type     | Description |
|--------------|----------|-------------|
| `fcnPtr`     | integer  | Emscripten function-table index, as returned by `Runtime.addFunction`. |
| `returnType` | string   | One of `void int bool double string array`. |
| `argType`    | string   | One of `void int bool double string array`. |
| `arg`        | value    | Required when `argType` is not `void`; omit otherwise. |

Currently only **one argument** is supported. Functions with zero
arguments use `argType void` and no `arg`.

```tcl
# zero-argument call
::wacl::jscall $ptr void void

# one-argument call
::wacl::jscall $ptr int string "hello"
```

### Type reference

| Token    | C type          | Tcl representation |
|----------|-----------------|--------------------|
| `void`   | `void`          | empty string       |
| `int`    | `int`           | integer string     |
| `bool`   | `int` (0/1)     | integer string     |
| `double` | `double`        | floating-point string |
| `string` | `const char *`  | string             |
| `array`  | `const char *`  | string (binary-safe usage) |

---

## Not yet implemented

These exist in Pyodide but are out of scope for the first wacl-tk API
cut. None of them are needed to write a typical Tk demo.

- `loadPackage`, `loadPackagesFromImports`, `pyimport`, `unpackArchive`
- Foreign function interface (`pyodide.ffi.*`, proxies, `toPy`)
- `registerJsModule` / `unregisterJsModule` (use [`::wacl::jscall`](#calling-javascript-from-tcl-wacljs call) instead — see dedicated section above)
- `setStdin`, `setInterruptBuffer`, `checkInterrupt`
- Lockfiles, `mountNativeFS`, `mountNodeFS`
- Runtime `canvas.setCanvas2D(c)` (pass `canvas` to `loadWaclTk` instead)

