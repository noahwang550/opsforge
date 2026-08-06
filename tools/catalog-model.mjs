// Public, read-only capability catalog derived from the inventory SSOT. steering owned.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { buildInventory } from './inventory.mjs';

const KIND_LABELS = { agent: '智能体', skill: '技能', mcp: '工具连接', workflow: '工作流', bundle: '能力套装' };
const QUALITY_MAP = { '绿': 'green', '黄': 'yellow', '红': 'red' };

function linesFromMarkdown(markdown) {
  return String(markdown || '').split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/[`*_#]/g, '').trim())
    .filter(Boolean);
}

function sourceFor(entry) {
  if (entry.example) return { key: 'example', label: '示例能力' };
  if (entry.sourceOrigin !== 'original' || entry.pack === 'third-party') return { key: 'third-party', label: '第三方' };
  return { key: 'official', label: 'OpsForge 官方' };
}

function scopeFor(entry) {
  if (entry.scope === 'brand') {
    const project = entry.customer || entry.brand || entry.pack;
    return { key: 'project', label: '项目专属', project, projectLabel: project };
  }
  return { key: 'general', label: '通用能力', project: null, projectLabel: null };
}
function loadPlatforms(repoRoot) {
  const root = path.join(repoRoot, 'adapters');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const manifestPath = path.join(root, entry.name, 'platform.yaml');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) || {};
    return { id: manifest.platform || entry.name, name: manifest.display_name_zh || manifest.display_name || entry.name };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function platformState(support) {
  if (!support) return { status: 'unsupported', label: '未声明支持' };
  if (support.hardUnmet.length) return { status: 'blocked', label: '存在必要能力缺口' };
  if (support.tier === 1) return { status: 'native', label: '原生适配' };
  return { status: 'degraded', label: support.tier ? `Tier ${support.tier} 适配` : '兼容性待确认' };
}

function usageFor(entry, platformId, platformName) {
  if (entry.example) {
    return {
      status: 'reference-only', label: '仅供参考，不可直接使用',
      title: '示例能力不提供业务使用入口',
      steps: [], requirements: [],
    };
  }
  const support = entry.platformSupport.find((item) => item.platform === platformId);
  const state = platformState(support);
  if (!support) return { ...state, title: `${platformName} 暂未列入支持范围`, steps: ['选择其他已支持平台查看使用方式。'], requirements: [] };
  if (support.hardUnmet.length) return { ...state, title: `${platformName} 暂不满足必要条件`, steps: ['联系能力维护方确认替代方案或等待平台适配更新。'], requirements: support.hardUnmet };
  const action = {
    agent: '在平台的智能体入口中启用该能力。', skill: '在平台的技能入口中加载该能力。',
    mcp: '在平台的工具连接设置中配置该能力。', workflow: '在平台的工作流入口中选择并运行该能力。',
    bundle: '先确认套装内依赖能力均可用，再从能力入口启用。',
  }[entry.kind] || '从平台能力入口启用该能力。';
  const steps = [action];
  if (state.status === 'degraded') steps.push('该平台可能需要手动粘贴说明或使用降级载体。');
  return { ...state, title: `${platformName} · ${state.label}`, steps, requirements: [] };
}

function publicEntry(entry, platforms) {
  const source = sourceFor(entry);
  const scope = scopeFor(entry);
  const scenarios = linesFromMarkdown(entry.scenarios);
  const platformSupport = platforms.map((platform) => {
    const support = entry.platformSupport.find((item) => item.platform === platform.id);
    return { platform: platform.id, name: platform.name, tier: support?.tier || null, ...platformState(support) };
  });
  return {
    id: entry.id, version: entry.version, name: entry.display_name_zh || entry.display_name_en || entry.id,
    nameEn: entry.display_name_en || '', description: entry.description,
    detail: linesFromMarkdown(entry.detail).join('\n'), scenarios,
    scenarioTag: entry.scenarioTag || scenarios[0] || entry.description,
    kind: entry.kind, kindLabel: KIND_LABELS[entry.kind] || entry.kind, pack: entry.pack,
    scope: scope.key, scopeLabel: scope.label, project: scope.project, projectLabel: scope.projectLabel,
    source, quality: QUALITY_MAP[entry.light] || 'yellow', qualityChecks: entry.qualityReports,
    releasedAt: entry.releasedAt, dependencies: entry.dependsOn, platformSupport,
    availability: entry.example ? 'reference-only' : 'usable',
    usage: Object.fromEntries(platforms.map((platform) => [platform.id, usageFor(entry, platform.id, platform.name)])),
  };
}

export async function buildCatalogSnapshot(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const inventory = await buildInventory({ repoRoot });
  const platforms = loadPlatforms(repoRoot);
  const capabilities = inventory.all.filter((entry) => entry.state === 'released')
    .map((entry) => publicEntry(entry, platforms)).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const generatedAt = (opts.now || new Date()).toISOString();
  return {
    version: `catalog-${generatedAt}`, generatedAt, count: capabilities.length, platforms,
    filters: {
      kinds: [...new Map(capabilities.map((item) => [item.kind, { id: item.kind, label: item.kindLabel }])).values()],
      sources: [...new Map(capabilities.map((item) => [item.source.key, { id: item.source.key, label: item.source.label }])).values()],
      scopes: [...new Map(capabilities.map((item) => [item.scope, { id: item.scope, label: item.scopeLabel }])).values()],
      projects: [...new Map(capabilities.filter((item) => item.project).map((item) => [item.project, { id: item.project, label: item.projectLabel }])).values()],
      availability: [{ id: 'usable', label: '可使用' }, { id: 'reference-only', label: '仅供参考，不可直接使用' }],
      qualities: [{ id: 'green', label: '可信' }, { id: 'yellow', label: '待完善' }, { id: 'red', label: '不可用' }],
    }, capabilities,
  };
}

export function catalogSummary(snapshot) {
  return {
    version: snapshot.version, generatedAt: snapshot.generatedAt, count: snapshot.count,
    platforms: snapshot.platforms, filters: snapshot.filters,
    capabilities: snapshot.capabilities.map(({ detail, qualityChecks, dependencies, usage, ...summary }) => summary),
  };
}
