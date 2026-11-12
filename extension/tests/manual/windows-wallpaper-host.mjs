import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';

const executable = process.argv[2];
assert.ok(executable, 'Pass the path to ataraxia-wallpaper-host.exe.');

function header(length) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(length);
  return bytes;
}

function frame(message) {
  const payload = Buffer.from(message);
  return Buffer.concat([header(payload.length), payload]);
}

test('the Windows helper replies once and exits while stdin stays open', { timeout: 5000 }, async (t) => {
  const child = spawn(executable, { windowsHide: true });
  t.after(() => child.kill());

  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (bytes) => stdout.push(bytes));
  child.stderr.on('data', (bytes) => stderr.push(bytes));

  const request = frame(' { "protocolVersion": 1, "type": "verify" }\r\n');
  const close = once(child, 'close');
  child.stdin.write(Buffer.concat([request, request]));
  assert.deepEqual(await close, [0, null]);
  assert.equal(Buffer.concat(stderr).length, 0);
  assert.deepEqual(Buffer.concat(stdout), frame('{"type":"compatibility","protocolVersion":1,"compatible":true}'));
});

const deniedRequests = {
  'closed stdin': Buffer.alloc(0),
  'truncated frame header': Buffer.from([12, 0]),
  'truncated payload': Buffer.concat([header(12), Buffer.from('{}')]),
  'zero-length frame': header(0),
  'oversize frame': header(1025),
  'invalid UTF-8': frame([0xc3, 0x28]),
  'invalid JSON': frame("{'type':'verify','protocolVersion':1}"),
  'trailing data': frame('{"type":"verify","protocolVersion":1}{}'),
  'duplicate key': frame('{"type":"apply","type":"verify","protocolVersion":1}'),
  'missing version': frame('{"type":"verify"}'),
  'unsupported version': frame('{"type":"verify","protocolVersion":2}'),
  'string version': frame('{"type":"verify","protocolVersion":"1"}'),
  'unsupported operation': frame('{"type":"apply","protocolVersion":1,"path":"C:/photo.jpg"}'),
};

for (const [name, input] of Object.entries(deniedRequests)) {
  test(`the Windows helper exits without a reply on ${name}`, () => {
    const result = spawnSync(executable, { input, timeout: 5000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.length, 0);
  });
}
