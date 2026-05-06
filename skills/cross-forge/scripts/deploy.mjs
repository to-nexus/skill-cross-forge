#!/usr/bin/env node
// deploy.mjs — Forge token deploy + bonding-curve pool creation.
//
// VERBATIM port of the canonical script embedded in
//   https://contents.crosstoken.io/forge/agent-skills/SKILL.md  (v2.0.1)
// Only renamed from `deploy-token.js` to fit the scripts/*.mjs convention used
// by sibling cross-skills. No logic, parameters, endpoints, addresses, or
// JSON shape have been modified.
//
// Options matrix:
//   --auth=client|vendor  (default: vendor)
//   --wallet=user|tmp     (default: tmp)
// Positional args: <name> <symbol> <description> <imageUrl> <walletAddress> <category>

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';

const DEPLOY_API = {
  client: 'https://cross-console-api.crosstoken.io/api/client/mcp/builder',
  vendor: 'https://cross-console-api.crosstoken.io/api/builder/mcp',
};

const RPC_URL = process.env.CROSS_RPC_URL || 'https://mainnet.crosstoken.io:22001';
const ROUTER = '0x7aF414e4d373bb332f47769c8d28A446A0C1a1E8';
const TOKEN_B = '0xDdF8AaA3927b8Fd5684dc2edcc7287EcB0A2122d';
const TRADE_URL = 'https://x.crosstoken.io/forge/token';
const VENDOR_ADDRESS = '0x254465624da909e0072fbf8c32bcfc26b9fe9da9';

const ROUTER_ABI = [{
  name: 'createPairWithVirtualReserve',
  type: 'function',
  stateMutability: 'payable',
  inputs: [
    { name: 'tokenA', type: 'address' },
    { name: 'tokenB', type: 'address' },
    { name: 'creatorFeeRecipient', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  outputs: [
    { name: 'pair', type: 'address' },
    { name: 'liquidity', type: 'uint256' },
  ],
}];

const VALID_CATEGORIES = ['game', 'ai_agent'];

function getOption(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

async function callDeployAPI(auth, tokenName, tokenSymbol, tokenDescription, imageUrl, owner, category) {
  const payload = {
    owner,
    project_name: tokenName,
    token: { name: tokenName, symbol: tokenSymbol, image_url: imageUrl },
    token_description: tokenDescription,
    category,
  };

  const headers = { 'Content-Type': 'application/json' };

  if (auth === 'client') {
    const clientKey = process.env.CLIENT_KEY;
    const clientSecret = process.env.CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      throw new Error('CLIENT_KEY and CLIENT_SECRET environment variables are not set. Please check your .env file.');
    }
    headers['Authorization'] = `API-Key ${clientKey}:${clientSecret}`;
  } else {
    payload.vendor = VENDOR_ADDRESS;
  }

  const response = await fetch(DEPLOY_API[auth], {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  const result = await response.json();
  if (result.code !== 200) {
    throw new Error(`API Error: ${result.message}`);
  }

  return result.data.token_address;
}

async function buildPoolTx(tokenAddress, feeRecipient, signer = null) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signerOrProvider = signer ? signer.connect(provider) : provider;
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, signerOrProvider);
  const deadline = Math.floor(Date.now() / 1000) + 300;

  const txOptions = {
    type: 2,
    maxFeePerGas: ethers.parseUnits('100', 'gwei'),
    maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
  };

  const from = signer ? signer.address : feeRecipient;

  const gasEstimate = await router.createPairWithVirtualReserve.estimateGas(
    tokenAddress, TOKEN_B, feeRecipient, deadline, { from },
  );

  if (!signer) {
    const unsignedTx = await router.createPairWithVirtualReserve.populateTransaction(
      tokenAddress, TOKEN_B, feeRecipient, deadline,
    );
    Object.assign(unsignedTx, txOptions);
    unsignedTx.from = from;
    unsignedTx.gasLimit = gasEstimate * 120n / 100n;
    return { unsignedTx };
  }

  const tx = await router.createPairWithVirtualReserve(
    tokenAddress, TOKEN_B, feeRecipient, deadline,
    { ...txOptions, gasLimit: gasEstimate * 120n / 100n },
  );
  const receipt = await tx.wait();
  return { tx, receipt };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const auth = getOption('auth') || 'vendor';
  const wallet = getOption('wallet') || 'tmp';

  if (!['client', 'vendor'].includes(auth)) {
    console.error(`Error: --auth must be client or vendor. (received: ${auth})`);
    process.exit(1);
  }
  if (!['user', 'tmp'].includes(wallet)) {
    console.error(`Error: --wallet must be user or tmp. (received: ${wallet})`);
    process.exit(1);
  }

  const positionalArgs = args.filter((a) => !a.startsWith('--') && a.trim() !== '');

  if (positionalArgs.length < 6) {
    printUsage();
    process.exit(1);
  }

  let [tokenName, tokenSymbol, tokenDescription, imageUrl, walletAddress, category] = positionalArgs;

  if (existsSync(imageUrl)) {
    const ext = extname(imageUrl).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const buf = readFileSync(imageUrl);
    if (buf.length > 1024 * 1024) {
      console.error(`Error: Image file exceeds 1MB. (${(buf.length / 1024 / 1024).toFixed(2)}MB)`);
      process.exit(1);
    }
    imageUrl = `data:${mime};base64,${buf.toString('base64')}`;
    console.log(`Local image file converted to base64: ${positionalArgs[3]} (${(buf.length / 1024).toFixed(0)}KB)\n`);
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    console.error(`Error: Invalid ${wallet === 'user' ? 'user wallet' : 'fee recipient'} address.`);
    process.exit(1);
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    console.error(`Error: Category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  try {
    const authLabel = auth === 'client' ? 'ClientKey' : 'Vendor';
    const walletLabel = wallet === 'user' ? 'User Wallet' : 'Temp Wallet';
    console.log(`\n[${authLabel} + ${walletLabel}] Starting token deployment\n`);

    let owner;
    let tmpWallet;

    if (wallet === 'tmp') {
      tmpWallet = ethers.Wallet.createRandom();
      owner = tmpWallet.address;
      console.log(`Temp wallet created: ${owner}\n`);
    } else {
      owner = walletAddress;
    }

    console.log('Deploying token...\n');
    const tokenAddress = await callDeployAPI(auth, tokenName, tokenSymbol, tokenDescription, imageUrl, owner, category);

    console.log('Token deployed!');
    console.log(`  Token Name: ${tokenName} (${tokenSymbol})`);
    console.log(`  Token Address: ${tokenAddress}\n`);

    const tradeLink = `${TRADE_URL}/${tokenAddress}`;
    const jsonReplacer = (_key, value) => (typeof value === 'bigint' ? value.toString() : value);

    if (wallet === 'user') {
      console.log('Generating unsigned TX for Forge pool creation...\n');
      const { unsignedTx } = await buildPoolTx(tokenAddress, owner);
      const output = { tokenAddress, tradeLink, unsignedTx };

      console.log('Unsigned Transaction for Forge pool creation:');
      console.log(JSON.stringify(output, jsonReplacer, 2));
      console.log(`\nSign the above unsignedTx with the user's wallet on the frontend.`);
      console.log(`The trade link will only be accessible after the pool TX succeeds.\n`);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      console.log('Creating Forge pool...\n');
      const { tx, receipt } = await buildPoolTx(tokenAddress, walletAddress, tmpWallet);
      const success = receipt.status === 1;

      const output = {
        poolCreated: success,
        tokenAddress,
        tradeLink: success ? tradeLink : null,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
      };

      if (success) {
        console.log('Forge pool created!\n');
        console.log(`  Token Name: ${tokenName} (${tokenSymbol})`);
        console.log(`  Token Address: ${tokenAddress}`);
        console.log(`  Trade Link: ${tradeLink}\n`);
      } else {
        console.log('Forge pool creation failed!\n');
        console.log(`  Token Address: ${tokenAddress}`);
        console.log(`  TX Hash: ${tx.hash}\n`);
      }

      console.log(JSON.stringify(output, jsonReplacer, 2));
    }
  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
Forge Token Deploy CLI

Options:
  --auth=client|vendor    Auth method (default: vendor)
    client  Authenticate with ClientKey/Secret from RampConsole
    vendor  Deploy without sign-up or credentials

  --wallet=user|tmp       Wallet type (default: tmp)
    user    User wallet becomes token owner, returns unsigned tx for pool creation
    tmp     Creates temp wallet, completes token deploy + pool creation (owner permissions not reusable)

Environment variables (when using --auth=client):
  CLIENT_KEY      Client key from RampConsole
  CLIENT_SECRET   Client secret from RampConsole

Usage:
  node scripts/deploy.mjs [options] <name> <symbol> <description> <imageUrl> <walletAddress> <category>

Examples:
  node scripts/deploy.mjs "MyToken" "MTK" "A fun token" "https://example.com/token.png" "0x1234..." "game"
  node scripts/deploy.mjs "MyToken" "MTK" "A fun token" "./token.png" "0x1234..." "game"
  node scripts/deploy.mjs --auth=client --wallet=user "MyToken" "MTK" "A fun token" "./token.png" "0x1234..." "game"

Arguments:
  name                Token name (e.g. "MyToken")
  symbol              Token symbol (e.g. "MTK")
  description         Token description (e.g. "A fun community token")
  imageUrl            Token image URL or local file path (PNG, JPG). Max 1MB.
  walletAddress       User wallet address (EVM)
                      --wallet=user: token owner + fee recipient
                      --wallet=tmp: fee recipient only (token owner is temp wallet)
  category            "game" or "ai_agent"

Notes:
  - Symbols are globally unique and case-insensitive
  - --wallet=tmp: temp wallet becomes token owner, owner permissions not reusable
`);
}

main();
