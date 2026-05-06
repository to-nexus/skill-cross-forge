// _signer.mjs — PRIVATE_KEY resolution + signer construction.
//
// Loads PK from process.env (already populated by 'dotenv/config'). Never logs,
// never echoes. Throws { code:'missing_pk' } if not set so the SKILL.md driver
// can prompt the user with the recommended Option A / Option B framing.

import { ethers } from 'ethers';
import { getProvider } from './_chain.mjs';

const PK_RE = /^0x[0-9a-fA-F]{64}$/;

export function loadSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    const err = new Error('PRIVATE_KEY env var (or .env entry) is required for write-path subcommands.');
    err.code = 'missing_pk';
    err.exitCode = 2;
    throw err;
  }
  if (!PK_RE.test(pk)) {
    const err = new Error('PRIVATE_KEY must match /^0x[0-9a-fA-F]{64}$/.');
    err.code = 'bad_pk';
    err.exitCode = 2;
    throw err;
  }
  const wallet = new ethers.Wallet(pk, getProvider());

  const declared = process.env.WALLET_ADDRESS;
  let signerWarn = null;
  if (declared && declared.toLowerCase() !== wallet.address.toLowerCase()) {
    signerWarn = `WALLET_ADDRESS (${declared}) does not match key-derived address (${wallet.address}). Using key-derived.`;
  }
  return { wallet, address: wallet.address, signerWarn };
}
