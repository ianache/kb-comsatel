const { withModuleFederationPlugin } = require("@angular-architects/module-federation/webpack");

// Shell = Module Federation host. Each functional domain is registered here as a
// remote MicroUI; new domains only need a new entry, no shell code changes.
// Angular 18's @angular-architects/module-federation emits ESM remoteEntry containers
// by default (experiments.outputModule), so remotes must be plain remoteEntry.js URLs —
// the "name@url" classic-federation shorthand only applies to non-ESM library output
// and, under ESM, gets passed straight to the browser's native import() instead of
// being intercepted by webpack's federation runtime.
module.exports = withModuleFederationPlugin({
  remotes: {
    microUiIngesta: `${process.env["MICRO_UI_INGESTA_URL"] || "http://localhost:4201"}/remoteEntry.js`,
  },
  shared: {
    "@angular/core": { singleton: true, strictVersion: true },
    "@angular/common": { singleton: true, strictVersion: true },
    "@angular/router": { singleton: true, strictVersion: true },
    rxjs: { singleton: true, strictVersion: true },
  },
});
