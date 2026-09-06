const { withModuleFederationPlugin } = require("@angular-architects/module-federation/webpack");

// Remote MicroUI exposing the ingestion screens (dashboard, conectores/fuentes)
// described in 00-REQSPEC/REQSPEC_PRD_Portal_Ingesta_KM.md.
module.exports = withModuleFederationPlugin({
  name: "microUiIngesta",
  exposes: {
    "./Routes": "./src/app/ingesta.routes.ts",
  },
  shared: {
    "@angular/core": { singleton: true, strictVersion: true },
    "@angular/common": { singleton: true, strictVersion: true },
    "@angular/router": { singleton: true, strictVersion: true },
    rxjs: { singleton: true, strictVersion: true },
  },
});
