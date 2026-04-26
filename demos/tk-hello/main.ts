/**
 * tk-hello demo harness: install em-x11 host, then launch the Tk-linked wasm.
 *
 * The Host implementation lives in the sibling em-x11 project; wacl-tk/vite
 * has `server.fs.allow: ['../em-x11']` so this relative import resolves in
 * the dev server.
 */

import { Host } from '../../../em-x11/src/runtime/host.js';

const host = new Host();
host.install();

const base = '/build/artifacts/tk-hello';
await host.launchClient({
  glueUrl: `${base}/tk-hello.js`,
  wasmUrl: `${base}/tk-hello.wasm`,
});
