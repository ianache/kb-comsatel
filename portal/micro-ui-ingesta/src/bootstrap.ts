import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { INGESTA_ROUTES } from "./app/ingesta.routes";

@Component({
  selector: "km-ingesta-root",
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class StandaloneHostComponent {}

bootstrapApplication(StandaloneHostComponent, {
  providers: [provideRouter(INGESTA_ROUTES)],
}).catch((err) => console.error(err));
