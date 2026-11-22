// Token launch radar, model version radar-2.
//
// One sealed snapshot of the protocol universe in, one ranked board out.
// The board covers the whole watchlist (40 protocols with at least $50M TVL
// and no token on record) plus every rankable pre-token protocol below that
// floor, so the radar finds early launches, not just the big names.
//
// Implied value is priced from the snapshot's own live-token peers, never
// from a hardcoded list of names and never from one flat multiple:
//
//   peer multiple = median(market cap / TVL) of live-token protocols in the
//     same category, shrunk toward the overall median for small samples
//   implied = TVL x peer multiple x growth factor x maturity factor
//
//   growth factor   = 1 + clamp(change_7d, -30, +60) / 100 x 0.25
//     (damped: in this snapshot, fast 7-day growth is associated with
//     lower multiples, so growth is a weak signal, not a value driver)
//   maturity factor = 0.7 + 0.3 x (1 - min(age_days, 1095) / 1095)
//     (younger pre-token protocols keep more launch optionality;
//     age unknown counts as 365 days)
//
// Each row also carries a low/high band from its category's p25/p75 peer
// multiples, and one line saying which factor drives its rank.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface PeerBand {
  category: string;
  n: number;
  median: number;
  p25: number;
  p75: number;
  multiple: number;
}

export interface ModelSettings {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_prior: number;
}

export const MODEL_VERSION = 'radar-2';

export const SETTINGS: ModelSettings = {
  growth_weight: 0.25,
  growth_floor: -30,
  growth_cap: 60,
  maturity_floor: 0.7,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_prior: 5,
};

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  why: string;
  model: {
    peer_multiple: number;
    peer_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  why: string;
  peer_multiple: number;
  peer_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelSettings;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  peers: PeerBand[];
  overall_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentileOf(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// Peer multiples, computed from the snapshot at runtime: for every category,
// the live-token protocols' market cap divided by TVL, summarised as median
// and p25/p75, then shrunk toward the overall median so a category with
// only a few live peers does not get an extreme multiple.
export function peerTable(snapshot: Snapshot, settings: ModelSettings = SETTINGS): { peers: PeerBand[]; overall: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const overall = medianOf(live.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(key, list);
  }
  const peers: PeerBand[] = [...byCategory.entries()]
    .map(([category, values]) => {
      const med = medianOf(values);
      const n = values.length;
      const multiple = (n * med + settings.shrink_prior * overall) / (n + settings.shrink_prior);
      return {
        category,
        n,
        median: Math.round(med * 1e4) / 1e4,
        p25: Math.round(percentileOf(values, 0.25) * 1e4) / 1e4,
        p75: Math.round(percentileOf(values, 0.75) * 1e4) / 1e4,
        multiple: Math.round(multiple * 1e4) / 1e4,
      };
    })
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  return { peers, overall: Math.round(overall * 1e4) / 1e4 };
}

function peerFor(peers: PeerBand[], category: string | null, overall: number): PeerBand | null {
  const key = category ?? 'Other';
  return peers.find((p) => p.category === key) ?? null;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  peers: PeerBand[],
  overall: number,
  settings: ModelSettings = SETTINGS,
): {
  implied: number;
  low: number;
  high: number;
  why: string;
  multiple: number;
  peerN: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const peer = peerFor(peers, p.category, overall);
  const multiple = peer ? peer.multiple : overall;
  const peerN = peer ? peer.n : 0;
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(settings.growth_cap, Math.max(settings.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * settings.growth_weight;
  const ageForModel = age ?? settings.unknown_age_days;
  const maturityMult =
    settings.maturity_floor + (1 - Math.min(Math.max(ageForModel, 0), settings.maturity_days) / settings.maturity_days) * (1 - settings.maturity_floor);
  const base = p.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  const loMult = peer ? (peer.n * peer.p25 + settings.shrink_prior * overall) / (peer.n + settings.shrink_prior) : overall;
  const hiMult = peer ? (peer.n * peer.p75 + settings.shrink_prior * overall) / (peer.n + settings.shrink_prior) : overall;
  const low = Math.max(1, Math.round(p.tvl_usd * loMult * growthMult * maturityMult));
  const high = Math.max(implied, Math.round(p.tvl_usd * hiMult * growthMult * maturityMult));
  const drivers: [string, number][] = [
    ['TVL', Math.log(Math.max(p.tvl_usd, 1))],
    ['category multiple', Math.log(Math.max(multiple, 0.001))],
    ['growth', Math.abs(Math.log(Math.max(growthMult, 0.01)))],
    ['youth', Math.abs(Math.log(Math.max(maturityMult, 0.01)))],
  ];
  drivers.sort((a, b) => b[1] - a[1]);
  const top = drivers[0]![0];
  const why =
    top === 'TVL'
      ? `Largest TVL in its range drives this rank: $${Math.round(p.tvl_usd).toLocaleString('en-US')} locked with no token on record.`
      : top === 'category multiple'
        ? `Its category prices at ${multiple.toFixed(2)}x TVL among live peers, above the ${overall.toFixed(2)}x overall median.`
        : top === 'growth'
          ? `Seven-day TVL moved ${growthPct.toFixed(1)}%, the strongest momentum signal on this row.`
          : `Listed ${age === null ? 'at an unknown date' : `${age} days ago`}, so it keeps more launch optionality than older pre-token protocols.`;
  return { implied, low, high, why, multiple, peerN, growthPct, growthMult, maturityMult, age };
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Put $${capital} of USDC to work as a lender on ${name} on ${chain} and leave the deposit in place.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to the main ${name} pool on ${chain} and leave the position open.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC across to ${chain} with ${name} and put the bridged funds to use in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain staking asset via ${name} and hold on to the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Fund $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Place $${capital} in a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline where no one else can read it.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    {
      text: `Do one qualifying action every week, like a deposit, a borrow, a swap or a vote, so the wallet stays active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity shows up in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, open the protocol's own points or rewards page and claim only through the link it publishes itself.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildBoard(snapshot: Snapshot, settings: ModelSettings = SETTINGS): BoardRow[] {
  const { peers, overall } = peerTable(snapshot, settings);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, peers, overall, settings) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((item, i) => ({
    rank: i + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    mcap_usd: item.p.mcap_usd,
    listed_at: item.p.listed_at,
    gecko_id: item.p.gecko_id,
    symbol: item.p.symbol,
    token_status: 'pre-token' as const,
    age_days: item.s.age,
    implied_value_usd: item.s.implied,
    implied_low_usd: item.s.low,
    implied_high_usd: item.s.high,
    why: item.s.why,
    model: {
      peer_multiple: round4(item.s.multiple),
      peer_n: item.s.peerN,
      growth_pct: item.s.growthPct,
      growth_multiplier: round4(item.s.growthMult),
      maturity_multiplier: round4(item.s.maturityMult),
      age_days: item.s.age,
    },
    farm_steps: farmSteps(item.p, item.s.age).map(stepText),
  }));
}

export function buildRadar(snapshot: Snapshot, settings: ModelSettings = SETTINGS): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, settings);
  const { peers, overall } = peerTable(snapshot, settings);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: settings,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    peers,
    overall_multiple: overall,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      why: r.why,
      peer_multiple: r.model.peer_multiple,
      peer_n: r.model.peer_n,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      watchlist: watch.has(r.slug),
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
