import type { AccessPrincipal } from "../domain/schemas.js";

export interface PrincipalResolver {
  resolve(authorization: string | undefined): Promise<AccessPrincipal>;
}
