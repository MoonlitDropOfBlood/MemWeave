#!/usr/bin/env node
/**
 * MemWeave CLI entry point.
 *
 * This file is the executable for the `memweave` bin command. It parses
 * argv, dispatches to the right command, and prints the result.
 */
import { parseCli, runCli, CliError } from './cli.js';

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseCli(process.argv);
  } catch (err) {
    if (err instanceof CliError) {
      // eslint-disable-next-line no-console
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }

  const result = await runCli({
    command: parsed.command,
    args: parsed.args,
    env: process.env,
    configPath: process.env.MEMWEAVE_CONFIG
  });

  // Print message + data, and exit non-zero on failure
  if (result.message) {
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.log(result.message);
    } else {
      // eslint-disable-next-line no-console
      console.error(result.message);
    }
  }
  if (result.data !== undefined) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result.data, null, 2));
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('memweave: unexpected error:', err);
  process.exit(1);
});
