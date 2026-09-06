import { inject } from "@angular/core";
import { CanActivateFn } from "@angular/router";
import { AuthService } from "./auth.service";

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const session = await auth.loadSession();
  if (session.authenticated) return true;

  auth.redirectToLogin();
  return false;
};
