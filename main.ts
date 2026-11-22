// Token launch radar: the entry program, Node 22, standard library only.
//
// It reads the sealed DefiLlama snapshot, scores every pre-token protocol
// with the peer-calibrated model in lib/model.ts, and writes the ranked
// board, the dashboard dataset, the dashboard files and the screenshots
// into the output directory, finishing with dossier.json (built with the
// vendored make.fun library) so the scorer can rebuild and compare it.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
//
// The board it writes is deterministic: two runs over the same snapshot
// produce byte-identical board.json and data.js.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DOSSIER_CAP = 1_572_864; // 1.5 MiB
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function readFlag(name: string, fallback: string): string {
  const spaced = process.argv.indexOf(`--${name}`);
  if (spaced >= 0 && spaced + 1 < process.argv.length) return process.argv[spaced + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

// Copy the plain files of one directory into another, skipping dotfiles
// and subdirectories, and return the names copied.
function mirror(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const inputArg = readFlag('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  const outDir = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const problem = boardIssue(board, snapshot);
  if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  const dashboardFiles = mirror(join(HERE, 'dashboard'), join(outDir, 'dashboard'));
  if (dashboardFiles.length < 3) fail(`dashboard/ holds ${dashboardFiles.length} files: hand in index.html, app.css and app.js`);
  const shots = mirror(join(HERE, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }

  // The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );

  // Fail loudly here if the dossier is over its 1.5 MiB cap, instead of at the gate.
  const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
  if (dossierBytes > DOSSIER_CAP) fail(`dossier.json is ${dossierBytes} bytes: over the 1.5 MiB cap`);

  const topThree = board
    .slice(0, 3)
    .map((row) => `#${row.rank} ${row.name} $${row.implied_value_usd.toLocaleString('en-US')}`)
    .join(', ');

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: top three: ${topThree}\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')} (${dossierBytes} bytes)\n`,
  );
}

main();
