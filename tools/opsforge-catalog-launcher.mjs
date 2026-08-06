// tools/opsforge-catalog-launcher.mjs — A1: 跨平台浏览器启动（零依赖）。
// Windows: cmd /c start "" <url>; mac: open; linux: xdg-open.
// URL 经 new URL 校验 host 必须 127.0.0.1；失败只打印业务指引不报错。
// 全 argv 形式（无 shell:true）；detached+unref 让子进程脱离父进程生命周期。
import { spawn } from 'node:child_process';

/**
 * openInBrowser(url) — 跨平台 spawn 浏览器。
 * @param {string} url  必须 http://127.0.0.1:<port>/... 形式
 * @param {{spawn?: Function, out?: (s: string) => void}} opts  注入测试
 * @returns {boolean} true=spawn 已发起（不代表浏览器真的开）；false=校验失败或 spawn 异常
 */
export function openInBrowser(url, opts = {}) {
  const out = opts.out || console.log;
  const spawnImpl = opts.spawn || spawn;
  let parsed;
  try { parsed = new URL(url); }
  catch { out('打开浏览器失败：链接不合法。请在主菜单选 8 重新打开能力目录。'); return false; }
  if (parsed.hostname !== '127.0.0.1') {
    out('打开浏览器失败：只允许本机链接。请在主菜单选 8 重新打开能力目录。');
    return false;
  }
  // H3 防御：cmd /c start 是 shell 调用，URL 里的 & | > < ^ 会逃逸。
  // 用双引号包住整个 URL，使 cmd/start 把它当单个 token；并禁 URL 含 "。
  if (url.includes('"')) {
    out('打开浏览器失败：链接不合法。请在主菜单选 8 重新打开能力目录。');
    return false;
  }
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', `"${url}"`]; }
  else if (platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawnImpl(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref?.();
    return true;
  } catch {
    out('浏览器没自动弹出来。请在主菜单选 8 重新打开能力目录。');
    return false;
  }
}
