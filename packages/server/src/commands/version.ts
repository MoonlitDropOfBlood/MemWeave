import type { CliContext, CommandResult, CommandHandler } from './index.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE_NAME = 'memweave';

export const versionCommand: CommandHandler = async (_ctx: CliContext): Promise<CommandResult> => {
  // Read the package.json of this workspace
  let version = 'unknown';
  try {
    // The compiled dist layout puts package.json at the workspace root;
    // tests are run from the workspace root, so process.cwd() works.
    const pkgPath = join(process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === PACKAGE_NAME && pkg.version) version = pkg.version;
    }
  } catch {
    // ignore
  }
  return { ok: true, message: `${PACKAGE_NAME} ${version}` };
};
