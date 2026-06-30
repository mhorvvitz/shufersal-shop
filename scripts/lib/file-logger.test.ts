import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createFileLogger } from './file-logger';

test('createFileLogger: appends a timestamped line to the log file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-logger-test-'));
  const logFile = path.join(dir, 'nested', 'add-to-cart.log');
  try {
    const log = createFileLogger(logFile);
    log('hello');
    log('with data', { a: 1 });

    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^\[.+\] hello$/);
    assert.match(lines[1]!, /^\[.+\] with data \{"a":1\}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createFileLogger: never writes to stdout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-logger-test-'));
  const logFile = path.join(dir, 'add-to-cart.log');
  try {
    const log = createFileLogger(logFile);
    let stdoutWrote = false;
    const original = process.stdout.write;
    process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
      stdoutWrote = true;
      return original.apply(process.stdout, args);
    }) as typeof process.stdout.write;
    try {
      log('should not touch stdout');
    } finally {
      process.stdout.write = original;
    }
    assert.equal(stdoutWrote, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
