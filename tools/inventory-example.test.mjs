// tools/inventory-example.test.mjs — 验证示例包（example:true）分流渲染。
//   marketing-team 包标 example:true → 其能力落 "示例能力" 分组 + 行内 "· 示例" 标记；
//   opsforge-meta 包未标 → 落 "OpsForge 工具能力" 分组，无标记。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory, renderReadmeBlock, renderDiscoverAll } from './inventory.mjs';

const REPO = process.cwd();

test('buildInventory 给 marketing-team 能力打 example:true 标', async () => {
  const inv = await buildInventory({ repoRoot: REPO });
  const mk = inv.all.find((e) => e.pack === 'marketing-team');
  const om = inv.all.find((e) => e.pack === 'opsforge-meta');
  assert.ok(mk, 'marketing-team cap present');
  assert.ok(om, 'opsforge-meta cap present');
  assert.equal(mk.example, true, 'marketing-team 应标 example:true');
  assert.equal(om.example, false, 'opsforge-meta 不应标 example');
});

test('renderReadmeBlock 把示例能力分到独立小节 + 行内 "· 示例" 标记', async () => {
  const inv = await buildInventory({ repoRoot: REPO });
  const md = renderReadmeBlock(inv);
  assert.match(md, /### OpsForge 工具能力/);
  assert.match(md, /### 示例能力（dogfood · 非核心交付）/);
  assert.match(md, /不应直接当作生产工具/);
  const exIdx = md.indexOf('### 示例能力');
  const mkIdx = md.indexOf('marketing-team.copywriter');
  assert.ok(exIdx > -1 && mkIdx > exIdx, 'marketing-team 行必须在示例小节之后');
  assert.match(md, /\| `marketing-team\.copywriter` \| 营销文案写手 · 示例 \|/);
  assert.doesNotMatch(md, /\| `opsforge-meta\.opsforge` \| OpsForge 主菜单 · 示例 \|/);
});

test('renderDiscoverAll 给示例能力打 [示例] 标 + 分组', async () => {
  const inv = await buildInventory({ repoRoot: REPO });
  const out = renderDiscoverAll(inv, {});
  assert.match(out, /=== OpsForge 工具能力 ===/);
  assert.match(out, /=== 示例能力（dogfood） ===/);
  const exGroupIdx = out.indexOf('=== 示例能力');
  const mkIdx = out.indexOf('marketing-team.copywriter');
  assert.ok(mkIdx > exGroupIdx, 'marketing-team 必须在示例分组下');
  assert.match(out, /▌ marketing-team\.copywriter.*\[示例\]/);
});
