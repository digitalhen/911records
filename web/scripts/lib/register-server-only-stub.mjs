// Stands in for Next.js's build-time alias of the bare `server-only`/
// `client-only` specifiers (see lib/map/data.ts's import). Next's webpack
// config resolves those to internal shim modules at bundle time; outside
// Next (plain `node`/`tsx`, as web/scripts/check-suggestions.ts uses so it
// can exercise the real production lib/ code with no dev server) there is
// no bundler to do that, and the real npm `server-only` package (not a
// dependency of this app — it always throws by design when required
// directly, even on the "server" side, unless a bundler's alias swaps it
// out first) would break the import outright.
//
// tsx transpiles this project's extensionless-relative-import TS files
// through the CJS loader, so patching `Module._load` here — loaded via
// `node --import`, before tsx's own hook registers — is what actually
// intercepts the require() call; a `node:module` `register()`-based ESM
// resolve hook would only cover the import() graph, not this project's CJS
// interop path.
import Module from 'node:module';

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only' || request === 'client-only') return undefined;
  return realLoad.call(this, request, parent, isMain);
};
