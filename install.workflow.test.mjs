// install.workflow.test.mjs — S6: workflow 覆盖条件化 (WF1-WF2).
// S6: 不支持 workflow_orchestration 的平台走 adapter.translate() 降级产物，
// 不再无条件用 compile() 覆盖（compile 硬编码 ~/.claude/commands/）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { install } from './install.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opsforge-wf-'));
}
function makeDir(home, sub) {
  fs.mkdirSync(path.join(home, sub), { recursive: true });
}
function mkWorkflowRepo(tmp) {
  const wfDir = path.join(tmp, 'packs', 'foo', 'workflows', 'bar');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.mkdirSync(path.join(wfDir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'workflow.yaml'), yaml.dump({
    id: 'foo.bar', version: '1.0.0', kind: 'workflow', pack: 'foo', owner: 'foo',
    display_name: 'Bar', display_name_zh: 'Bar', display_name_en: 'Bar',
    description: 'desc', platforms: ['workbuddy'],
    params_schema: 'params.schema.json',
    steps: [{ id: 's1', capability: 'nonexistent.dep', inputs: {}, outputs: ['out'] }],
    outputs: {}, tests: 'tests/', changelog: 'CHANGELOG.md',
    source: { origin: 'original', upstream_ref: null },
  }));
  fs.writeFileSync(path.join(wfDir, 'CHANGELOG.md'), '# bar\n');
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(wfDir, 'tests', `case-0${i + 1}.yaml`), yaml.dump({
      name: `case-${i}`, input: `input-${i}`, expect: 'exact', expected: `result-${i}`,
    }));
  }
  return wfDir;
}

// WF1 install workflow→workbuddy 落引导式 skill（~/.workbuddy/skills/opsforge-bar/SKILL.md），不落 ~/.claude/commands/
test('WF1 install workflow → workbuddy lands guided skill', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  makeDir(home, '.workbuddy');
  mkWorkflowRepo(tmp);
  const r = await install({ platform: 'workbuddy', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  // 引导式 skill 应存在
  const skillPath = path.join(home, '.workbuddy', 'skills', 'opsforge-bar', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), `guided skill should exist at ${skillPath}`);
  const content = fs.readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('引导式 skill'), 'content should be guided workflow skill');
  assert.ok(content.includes('步骤 1'), 'content should list workflow steps');
  // 不应落 ~/.claude/commands/workflow-bar.md（compile 路径不应触发）
  const cmdPath = path.join(home, '.claude', 'commands', 'workflow-bar.md');
  assert.ok(!fs.existsSync(cmdPath), `compile command file should NOT exist at ${cmdPath}`);
  // installed 列表应含 skill 路径
  assert.ok(r.installed.some((p) => p.includes('opsforge-bar')), JSON.stringify(r.installed));
});

// WF2 install workflow→cline 回归：走 manual-paste（paste/<project>/<name>.md），不落 ~/.claude/commands/
test('WF2 install workflow → cline regression manual-paste', async () => {
  const tmp = mkTmp();
  const home = mkTmp();
  process.env.OPSFORGE_HOME = home;
  makeDir(home, '.cline');
  mkWorkflowRepo(tmp);
  const r = await install({ platform: 'cline', capId: 'foo.bar', repoRoot: tmp, opsforgeHome: home });
  // manual-paste 应落 paste/<project>/<name>.md
  const pastePath = path.join(home, 'paste', 'default', 'bar.md');
  assert.ok(fs.existsSync(pastePath), `manual-paste file should exist at ${pastePath}`);
  // 不应落 ~/.claude/commands/workflow-bar.md
  const cmdPath = path.join(home, '.claude', 'commands', 'workflow-bar.md');
  assert.ok(!fs.existsSync(cmdPath), `compile command file should NOT exist for cline at ${cmdPath}`);
});
