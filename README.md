# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/6910hkb/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/6910hkb/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed DefiLlama snapshot, finds the
protocols that record no token, prices each one from its own category's
live-token peers, and hands in a web dashboard with the ranked board, a
detail view for every protocol and a concrete farm plan.

Model (radar-2): implied value = TVL x peer multiple x growth factor x
maturity factor. The peer multiple is the median market cap / TVL of the
live-token protocols in the same category, computed from the snapshot at
run time and shrunk toward the overall median for small samples. Growth is
damped on purpose, and younger pre-token protocols keep more launch
optionality.

The dashboard renders with no network: open `dashboard/index.html`
beside `data.js` and the whole board, detail view and farm plan work
offline.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

That writes `board.json`, `data.js`, `dashboard/` and `screenshots/` into
`out/`, and `dossier.json` last.

---

Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
