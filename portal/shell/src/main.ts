import "zone.js";
// Module Federation requires this async boundary: shared singleton modules
// (@angular/core, @angular/router, ...) must finish negotiating their shared
// scope across host + remotes before any of them is actually imported/consumed.
// eslint-disable-next-line @typescript-eslint/no-floating-promises
import("./bootstrap").catch((err) => console.error(err));
