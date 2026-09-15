// Headless difficulty probe: run a vs-bot game through the REAL net.js Lockstep
// (the same pump the browser uses, including the difficulty delay + APM cap) and
// report the bot's development. Compare runs across difficulty settings.
//
//   node web/bot-difficulty-probe.mjs [wasm] [frames] [botRace] [delay] [apm]
import { WASI } from 'node:wasi';
import { readFileSync } from 'node:fs';
import { Lockstep } from './net.js';

const wasmFile = process.argv[2] || 'web/openbw-bot.wasm';
const FRAMES = +(process.argv[3] || 3000);
const botRace = +(process.argv[4] ?? 0);
const delay = +(process.argv[5] ?? 3);
const apm = +(process.argv[6] ?? 0);

const files = [
  readFileSync('web/data/STARDAT.MPQ'),
  readFileSync('web/data/BROODAT.MPQ'),
  readFileSync('web/data/patch_rt.mpq'),
  readFileSync('web/maps/Weave_v1.scx'),
];

const wasi = new WASI({ version: 'preview1', args: ['openbw'], preopens: {} });
let memory;
const env = {
  js_file_size: (i) => files[i].length,
  js_read_data: (i, dst, off, n) => new Uint8Array(memory.buffer).set(files[i].subarray(off, off + n), dst),
};
const module = await WebAssembly.compile(readFileSync(wasmFile));
for (const imp of WebAssembly.Module.imports(module)) {
  if (imp.module === 'env' && !(imp.name in env))
    env[imp.name] = imp.name === 'js_sound_load' ? () => -1 : () => 0;
}
const instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), env });
memory = instance.exports.memory;
wasi.initialize(instance);
const x = instance.exports;

const slotdefs = [[0, 0], [1, botRace]];
const pairs = new Int32Array(slotdefs.flat());
const p = x.openbw_in_ptr(pairs.byteLength);
new Uint8Array(memory.buffer, p, pairs.byteLength).set(new Uint8Array(pairs.buffer));
x.openbw_init_mp(640, 480, 0, slotdefs.length);
x.openbw_bot_attach(1);

const lockstep = new Lockstep({
  x, memory,
  slots: [0, 1],
  localSlot: 0,
  delay: 0,
  bot: { slot: 1, delay, apm },
});

while (lockstep.frame < FRAMES) if (!lockstep.tick()) throw new Error('lockstep stalled');

const cstr = (ptr) => {
  const mem = new Uint8Array(memory.buffer);
  let end = ptr;
  while (mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.subarray(ptr, end));
};
const rows = cstr(x.openbw_debug_units()).trim().split('\n').map((l) => l.split('\t'));
const bot = {};
for (const [, name, owner] of rows) if (owner === '1') bot[name] = (bot[name] || 0) + 1;
console.log(JSON.stringify({ frame: x.openbw_frame(), delay, apm, botSupply: x.openbw_bot_supply(), bot }));
