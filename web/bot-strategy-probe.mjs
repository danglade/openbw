// Headless probe: run a vs-ZZZKBot (or McRave) game under Node's WASI for N frames
// and dump the bot's unit composition — used to verify the strategy-variety patches
// (each run should open differently). Mirrors openbw.js's boot + net.js's bot pump.
//
//   node web/bot-strategy-probe.mjs [openbw-bot.wasm] [frames] [botRace]
import { WASI } from 'node:wasi';
import { readFileSync } from 'node:fs';

const wasmFile = process.argv[2] || 'web/openbw-bot.wasm';
const FRAMES = +(process.argv[3] || 3000);
const botRace = +(process.argv[4] ?? 0); // race_t: 0 zerg, 1 terran, 2 protoss

// Archive index mapping must match wasm_main.cpp's js_file_reader.
const files = [
  readFileSync('web/data/STARDAT.MPQ'),
  readFileSync('web/data/BROODAT.MPQ'),
  readFileSync('web/data/patch_rt.mpq'),
  readFileSync('web/maps/Weave_v1.scx'),
];

const wasi = new WASI({ version: 'preview1', args: ['openbw'], preopens: {} });

let memory;
const baseEnv = {
  js_file_size: (index) => files[index].length,
  js_read_data: (index, dst, offset, n) => {
    new Uint8Array(memory.buffer).set(files[index].subarray(offset, offset + n), dst);
  },
};

const module = await WebAssembly.compile(readFileSync(wasmFile));
// Auto-stub every env import the module wants that we don't provide (sound, bot log…).
const env = { ...baseEnv };
for (const imp of WebAssembly.Module.imports(module)) {
  if (imp.module === 'env' && !(imp.name in env))
    env[imp.name] = imp.name === "js_sound_load" ? () => -1 : imp.name === "js_bot_log" ? (ptr, len) => process.env.BOTLOG && console.error("[bot]", new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len))) : () => 0;
}
const instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), env });
memory = instance.exports.memory;
wasi.initialize(instance);

const x = instance.exports;

// Two-player init: slot 0 = human (zerg), slot 1 = the bot. Same int32-pair
// handshake openbw.js uses.
const slots = [[0, 0], [1, botRace]];
const pairs = new Int32Array(slots.flat());
const p = x.openbw_in_ptr(pairs.byteLength);
new Uint8Array(memory.buffer, p, pairs.byteLength).set(new Uint8Array(pairs.buffer));
x.openbw_init_mp(640, 480, 0, slots.length);
x.openbw_bot_attach(1);

const cstr = (ptr) => {
  const mem = new Uint8Array(memory.buffer);
  let end = ptr;
  while (mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.subarray(ptr, end));
};

for (let i = 0; i < FRAMES; i++) {
  // Pump the bot exactly like net.js's #drainBot/#apply, minus the latency window.
  x.openbw_bot_tick();
  const len = x.openbw_bot_out_len();
  if (len) {
    const out = new Uint8Array(memory.buffer, x.openbw_bot_out_ptr(), len).slice();
    x.openbw_bot_out_clear();
    const dst = x.openbw_in_ptr(out.length);
    new Uint8Array(memory.buffer, dst, out.length).set(out);
    x.openbw_apply(1, out.length);
  }
  x.openbw_step();
}

// Bot unit composition (owner field from openbw_debug_units).
const rows = cstr(x.openbw_debug_units()).trim().split('\n').map((l) => l.split('\t'));
const byOwner = {};
for (const [, name, owner] of rows) {
  (byOwner[owner] ??= {})[name] = (byOwner[owner][name] || 0) + 1;
}
console.log(JSON.stringify({ frame: x.openbw_frame(), byOwner }));
