// Token launch radar, entry program (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the
// peer-calibrated model in lib/model.ts, writes the ranked board to
// /output/board.json, writes the dashboard dataset to /output/data.js,
// copies dashboard/ and screenshots/ into /output, and writes
// /output/dossier.json last with the vendored make.fun library.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function die(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) die(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) die(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyDir(join(root, 'dashboard'), join(outDir, 'dashboard'));
if (dashboardFiles.length < 3) die(`dashboard/ holds ${dashboardFiles.length} files: hand in index.html, app.css and app.js`);
const shots = copyDir(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!SHOT_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

// Guard the dossier cap here too, so a too-large entry fails loudly now
// instead of at the gate: 1.5 MiB is 1,572,864 bytes.
const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
if (dossierBytes > 1_572_864) die(`dossier.json is ${dossierBytes} bytes: over the 1.5 MiB cap`);

const topThree = board
  .slice(0, 3)
  .map((row) => `#${row.rank} ${row.name} $${row.implied_value_usd.toLocaleString('en-US')}`)
  .join(', ');

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: top three: ${topThree}\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')} (${dossierBytes} bytes)\n`,
);
