import { Routes } from "@angular/router";
import { authGuard } from "./auth.guard";

// Each functional domain is a lazily loaded Module Federation remote. Adding a
// new MicroUI only requires a new route entry here plus a webpack.config.js remote.
export const routes: Routes = [
  {
    path: "ingesta",
    canActivate: [authGuard],
    loadChildren: () =>
      import("microUiIngesta/Routes").then((m) => m.INGESTA_ROUTES),
  },
  { path: "", pathMatch: "full", redirectTo: "ingesta" },
];
