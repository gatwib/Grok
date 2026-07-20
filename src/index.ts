#!/usr/bin/env node
import {
  GRN, YEL, DIM, RST, banner, line, ask, no, wait, askInt,
} from './shared.js';
import { runCreateAccounts } from './create-account.js';
import { runAddRouterMenu } from './add-router.js';

async function main(): Promise<void> {
  banner('WANGLINS SIGNUP RUNNER');
  process.stdout.write(`  ${GRN}[1]${RST} Create Grok accounts\n`);
  process.stdout.write(`  ${GRN}[2]${RST} Add accounts to 9Router (from asukabeh.txt)\n`);
  process.stdout.write(`  ${DIM}[0]${RST} Exit\n`);
  process.stdout.write(`${DIM}${line('-')}${RST}\n`);

  let choice = '';
  while (true) {
    choice = (await ask(`  ${YEL}[?]${RST} Select option [1/2/0]: `)).trim();
    if (choice === '1' || choice === '2' || choice === '0') break;
    no('invalid option - enter 1, 2, or 0');
  }

  if (choice === '0') {
    wait('exiting');
    return;
  }

  if (choice === '2') {
    await runAddRouterMenu();
    return;
  }

  const count = await askInt(`  ${YEL}[?]${RST} How many accounts to create? [1] `, 1);
  const workers = await askInt(`  ${YEL}[?]${RST} How many workers (parallel Chrome)? [1] `, 1);
  await runCreateAccounts(count, workers);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
