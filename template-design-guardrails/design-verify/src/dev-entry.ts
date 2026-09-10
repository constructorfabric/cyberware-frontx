// The shell's generic dev hook loads src/dev-entry.ts from every installed
// verify package (src-app/verify_packages/*) in dev mode; this side-effect
// module is how this package plugs in without the shell naming it. It
// installs the runtime design-defect checker: findings land in the console
// under [design-defects], and window.__frontxDesignDefects() re-runs the
// sweep on demand (for example after a theme switch).
import { installDesignDefectCheck } from './designDefects';

installDesignDefectCheck();
