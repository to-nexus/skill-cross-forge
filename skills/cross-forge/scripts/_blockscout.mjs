// _blockscout.mjs — minimal Blockscout v2 GET helper for CROSS Chain.
//
// Adjacent to skill-cross-explorer but kept self-contained so cross-forge has
// no inter-skill runtime dependency. Output shape and 404 semantics are the
// same (404 → { code:'not_found' }).

import { BLOCKSCOUT_BASE } from './_chain.mjs';

export async function bsGet(path) {
  const url = `${BLOCKSCOUT_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'cross-forge/0.1', 'Accept': 'application/json' },
  });
  if (res.status === 404) {
    const err = new Error(`Blockscout 404: ${url}`);
    err.code = 'not_found';
    err.exitCode = 2;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Blockscout HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.code = 'blockscout_error';
    err.exitCode = 1;
    throw err;
  }
  return res.json();
}
