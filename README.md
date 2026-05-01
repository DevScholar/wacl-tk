# WaclTk

⚠️ This project is in early development and is not yet stable. Expect breaking changes and missing features.

A WebAssembly build of Tcl/Tk 8.6 that runs real Tk programs in the browser.

![tk-hello demo screenshot](./screenshots/counter.png)

Built on top of [wacl](https://github.com/ecky-l/wacl); Tk's X11 calls are handled by the sibling project [em-x11](https://github.com/DevScholar/em-x11).

# Prerequisites

- Linux
- Emscripten (latest emsdk recommended; `emcc` must be on `PATH`)
- Node.js ≥ 20, pnpm ≥ 9
- make, autoconf, wget
- [em-x11](https://github.com/DevScholar/em-x11) cloned as a sibling directory

```bash
bash setup.sh
cd ../em-x11 && pnpm install && pnpm build:native && cd ../wacl-tk
make config && make waclinstall
make tkinstall
pnpm install
pnpm build:native
```

# Build

```bash
pnpm build:native
```

# Run

```bash
pnpm dev
```

# Documentation

[docs/api.md](docs/api.md)

# License

BSD 3-Clause.
