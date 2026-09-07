import { Routes } from "@angular/router";

export const INGESTA_ROUTES: Routes = [
  {
    path: "",
    loadComponent: () => import("./pages/dashboard/dashboard.component").then((m) => m.DashboardComponent),
  },
  {
    path: "conectores",
    loadComponent: () => import("./pages/conectores/conectores.component").then((m) => m.ConectoresComponent),
  },
  {
    path: "conectores/:id/repositorios",
    loadComponent: () =>
      import("./pages/administrar-repositorios/administrar-repositorios.component").then((m) => m.AdministrarRepositoriosComponent),
  },
  {
    path: "conectores/:id/carpetas",
    loadComponent: () =>
      import("./pages/seleccionar-carpetas/seleccionar-carpetas.component").then((m) => m.SeleccionarCarpetasComponent),
  },
  {
    path: "conectores/:id/esquemas",
    loadComponent: () =>
      import("./pages/esquemas-mapeados/esquemas-mapeados.component").then((m) => m.EsquemasMapeadosComponent),
  },
  {
    path: "vault",
    loadComponent: () => import("./pages/vault-credenciales/vault-credenciales.component").then((m) => m.VaultCredencialesComponent),
  },
  {
    path: "ejecucion",
    loadComponent: () => import("./pages/ejecucion/ejecucion.component").then((m) => m.EjecucionComponent),
  },
];
