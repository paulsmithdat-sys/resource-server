#!/run/current-system/sw/bin/bun


import { stdin, stdout, stderr } from 'node:process';
import { encode } from '@toon-format/toon';

let input = '';

stdin.setEncoding('utf8');

stdin.on('data', chunk => {
  input += chunk;
});

stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    stdout.write(encode(data) + '\n');
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
});


