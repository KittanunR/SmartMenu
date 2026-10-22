#!/usr/bin/env node
// Validate everything the site reads: catalog, every dated price file, latest.json.
// Usage: node scripts/validate.mjs            (exit 1 on any error; warnings never fail)
//        node scripts/validate.mjs --strict   (warnings fail too)
import { checkRepo, report } from './lib/checks.mjs';

const result = checkRepo();
report(result);
const strict = process.argv.includes('--strict');
process.exit(result.errors.length || (strict && result.warnings.length) ? 1 : 0);
