// tools/opsforge-catalog-launcher.test.mjs — A1: 跨平台浏览器启动测试 (CL1-CL4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openInBrowser } from './opsforge-catalog-launcher.mjs';

function setPlatform(p) {
  const orig = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  return () => {
    if (orig) Object.defineProperty(process, 'platform', orig);
    else Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
  };
}

// CL1 平台分派：mock opts.spawn，断言 win32/darwin/linux argv 各异。
test('CL1 openInBrowser win32 spawns cmd /c start "" <url>', () => {
  const restore = setPlatform('win32');
  let captured = null;
  const fakeChild = { unref: () => {} };
  const spawnImpl = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return fakeChild;
  };
  try {
    const ok = openInBrowser('http://127.0.0.1:4173/', { spawn: spawnImpl, out: () => {} });
    assert.equal(ok, true);
    assert.equal(captured.cmd, 'cmd');
    assert.deepEqual(captured.args, ['/c', 'start', '', '"http://127.0.0.1:4173/"']);
    assert.equal(captured.opts.detached, true);
    assert.equal(captured.opts.stdio, 'ignore');
  } finally { restore(); }
});

test('CL1b openInBrowser darwin spawns open <url>', () => {
  const restore = setPlatform('darwin');
  let captured = null;
  const spawnImpl = (cmd, args, opts) => { captured = { cmd, args, opts }; return { unref: () => {} }; };
  try {
    openInBrowser('http://127.0.0.1:4173/', { spawn: spawnImpl, out: () => {} });
    assert.equal(captured.cmd, 'open');
    assert.deepEqual(captured.args, ['http://127.0.0.1:4173/']);
  } finally { restore(); }
});

test('CL1c openInBrowser linux spawns xdg-open <url>', () => {
  const restore = setPlatform('linux');
  let captured = null;
  const spawnImpl = (cmd, args, opts) => { captured = { cmd, args, opts }; return { unref: () => {} }; };
  try {
    openInBrowser('http://127.0.0.1:4173/', { spawn: spawnImpl, out: () => {} });
    assert.equal(captured.cmd, 'xdg-open');
    assert.deepEqual(captured.args, ['http://127.0.0.1:4173/']);
  } finally { restore(); }
});

// CL2 URL 校验：非 127.0.0.1 / 非 URL 返回 false 不调 spawn。
test('CL2 openInBrowser rejects non-127.0.0.1 host', () => {
  let spawned = false;
  const out = [];
  const ok = openInBrowser('http://evil.com/', { spawn: () => { spawned = true; }, out: (s) => out.push(s) });
  assert.equal(ok, false);
  assert.equal(spawned, false);
  assert.ok(out.some((s) => s.includes('主菜单选 8')));
});

test('CL2b openInBrowser rejects non-URL', () => {
  const out = [];
  const ok = openInBrowser('not-a-url', { spawn: () => {}, out: (s) => out.push(s) });
  assert.equal(ok, false);
  assert.ok(out.some((s) => s.includes('主菜单选 8')));
});

test('CL2c openInBrowser accepts 127.0.0.1 with path', () => {
  const restore = setPlatform('linux');
  let captured = null;
  try {
    openInBrowser('http://127.0.0.1:4173/capabilities/foo.bar', {
      spawn: (cmd, args) => { captured = { cmd, args }; return { unref: () => {} }; },
      out: () => {},
    });
    assert.equal(captured.args[0], 'http://127.0.0.1:4173/capabilities/foo.bar');
  } finally { restore(); }
});

// CL3 spawn 抛错：返回 false + 打印业务话。
test('CL3 openInBrowser spawn throw prints business hint', () => {
  const restore = setPlatform('linux');
  const out = [];
  try {
    const ok = openInBrowser('http://127.0.0.1:4173/', {
      spawn: () => { throw new Error('ENOENT'); },
      out: (s) => out.push(s),
    });
    assert.equal(ok, false);
    assert.ok(out.some((s) => s.includes('主菜单选 8')));
  } finally { restore(); }
});

// CL4 detached+unref：options 含 detached:true, stdio:'ignore'；child.unref 被调。
test('CL4 openInBrowser detached+unref', () => {
  const restore = setPlatform('win32');
  let unrefCalled = false;
  const fakeChild = { unref: () => { unrefCalled = true; } };
  let optsCaptured = null;
  try {
    openInBrowser('http://127.0.0.1:4173/', {
      spawn: (cmd, args, opts) => { optsCaptured = opts; return fakeChild; },
      out: () => {},
    });
    assert.equal(optsCaptured.detached, true);
    assert.equal(optsCaptured.stdio, 'ignore');
    assert.equal(unrefCalled, true);
  } finally { restore(); }
});

// CL5 H3 防御：URL 含 & | 等 cmd 元字符时，必须被双引号包住成单个 argv token，不逃逸。
test('CL5 openInBrowser win32 quotes url with cmd metachars', () => {
  const restore = setPlatform('win32');
  let captured = null;
  try {
    openInBrowser('http://127.0.0.1:1/?x=1&evil', {
      spawn: (cmd, args) => { captured = { cmd, args }; return { unref: () => {} }; },
      out: () => {},
    });
    // 整个 URL 被双引号包住，& 在引号内不逃逸成新命令
    assert.equal(captured.args[3], '"http://127.0.0.1:1/?x=1&evil"');
  } finally { restore(); }
});

// CL6 H3 防御：URL 含双引号直接拒绝（不引号逃逸）。
test('CL6 openInBrowser rejects url containing double-quote', () => {
  const restore = setPlatform('win32');
  let spawned = false;
  const lines = [];
  try {
    const ok = openInBrowser('http://127.0.0.1:1/?x="evil', {
      spawn: () => { spawned = true; return { unref: () => {} }; },
      out: (s) => lines.push(s),
    });
    assert.equal(ok, false);
    assert.equal(spawned, false);
    assert.ok(lines.some((s) => s.includes('主菜单选 8')));
  } finally { restore(); }
});

// Slice C2: 远程能力广场 host 白名单——<owner>.github.io 后缀匹配通过，其他 host 拒绝.
test('C2-CL1 openInBrowser accepts <owner>.github.io host (suffix match)', () => {
  const restore = setPlatform('linux');
  let captured = null;
  try {
    const ok = openInBrowser('https://acme.github.io/opsforge/', {
      spawn: (cmd, args) => { captured = { cmd, args }; return { unref: () => {} }; },
      out: () => {},
    });
    assert.equal(ok, true);
    assert.equal(captured.args[0], 'https://acme.github.io/opsforge/');
  } finally { restore(); }
});

test('C2-CL2 openInBrowser rejects non-github.io external host', () => {
  let spawned = false;
  const lines = [];
  const ok = openInBrowser('https://evil.com/opsforge/', {
    spawn: () => { spawned = true; return { unref: () => {} }; },
    out: (s) => lines.push(s),
  });
  assert.equal(ok, false);
  assert.equal(spawned, false);
  assert.ok(lines.some((s) => s.includes('主菜单选 8') || s.includes('能力目录')));
});

test('C2-CL3 openInBrowser rejects github.io spoof host (not suffix)', () => {
  let spawned = false;
  const ok = openInBrowser('https://github.io.evil.com/', {
    spawn: () => { spawned = true; return { unref: () => {} }; },
    out: () => {},
  });
  assert.equal(ok, false);
  assert.equal(spawned, false);
});

test('C2-CL4 openInBrowser win32 still double-quotes github.io url (H3 retained)', () => {
  const restore = setPlatform('win32');
  let captured = null;
  try {
    openInBrowser('https://acme.github.io/opsforge/?x=1&y', {
      spawn: (cmd, args) => { captured = { cmd, args }; return { unref: () => {} }; },
      out: () => {},
    });
    assert.ok(captured.args[3].startsWith('"'), 'remote url must be double-quoted on win32');
    assert.ok(captured.args[3].includes('&'));
  } finally { restore(); }
});
