// Runs the TabRest regression tests against a real Chrome.
//   node test/run.mjs            all tests
//   node test/run.mjs burst      just one
import burst from "./burst.test.mjs";
import timer from "./timer.test.mjs";
import guards from "./guards.test.mjs";
import options from "./options.test.mjs";

const TESTS = { burst, timer, guards, options };
const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(TESTS);

let failed = 0;
for (const name of names) {
  const fn = TESTS[name];
  if (!fn) { console.error(`unknown test: ${name}`); failed++; continue; }
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name}  (${((Date.now() - t0) / 1000).toFixed(0)}s)  ${detail}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}  (${((Date.now() - t0) / 1000).toFixed(0)}s)  ${e.message}`);
  }
}
console.log(failed ? `\n${failed} failing` : "\nall green");
process.exit(failed ? 1 : 0);
