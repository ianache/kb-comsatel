import "zone.js";
// Standalone bootstrap for `ng serve` (developing this MicroUI in isolation, without
// the shell). Module Federation requires this async boundary even for a remote's own
// standalone entry: shared singleton modules (@angular/core, @angular/router, ...)
// must finish negotiating their shared scope before any of them is consumed.
import("./bootstrap").catch((err) => console.error(err));
