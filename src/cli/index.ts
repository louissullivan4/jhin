#!/usr/bin/env node

// src/cli/index.ts
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generateCode } from '../index';

const argv = yargs(hideBin(process.argv))
  .usage('$0 --in <openapi-file> --lang <language> --out <output-dir>')
  .option('in', {
    alias: 'i',
    describe: 'Path to input OpenAPI specification (JSON or YAML)',
    type: 'string',
    demandOption: true,
  })
  .option('lang', {
    alias: 'l',
    describe: 'Target language/framework for generation (e.g., "python-fastapi")',
    type: 'string',
    default: 'python-fastapi',
  })
  .option('out', {
    alias: 'o',
    describe: 'Output directory for generated code',
    type: 'string',
    default: './code',
  })
  .help()
  .parseSync();

(async () => {
  try {
    await generateCode(argv.in, argv.lang, argv.out);
    console.log(`Successfully generated ${argv.lang} project at ${argv.out}`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
})();
