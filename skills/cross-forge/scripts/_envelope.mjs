// _envelope.mjs — shared single-line JSON envelope writer.
// Every cross-forge subcommand emits exactly one JSON object on stdout, with
// a final newline so the parent shell can splice it cleanly into a pipe.

export function emit(obj) {
  const payload = { ...obj, ts: new Date().toISOString() };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

export function fail({ parsedIntent, code = 'unknown_error', message, missing = null, hint = null, exitCode = 1 }) {
  emit({
    ok: false,
    parsedIntent,
    error: code,
    message: message ?? code,
    missing,
    hint,
    signerWarn: null,
  });
  process.exit(exitCode);
}

export function phaseStub({ parsedIntent, missing, hint }) {
  fail({
    parsedIntent,
    code: 'phase_1_not_captured',
    message: `Trade-side subcommand requires DevTools capture from x.crosstoken.io/forge. See references/forge.md.`,
    missing,
    hint,
    exitCode: 3,
  });
}
