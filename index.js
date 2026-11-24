// 通用剧情记忆 - SillyTavern third-party extension (1.12+)
const MODULE = 'st_memory';
const META = 'st_memory';
const EXPORT_TYPE = 'st_memory';
const EXT_VERSION = '1.1.1';
const FOLDER = new URL('.', import.meta.url).href;
const QUIET_TIMEOUT_MS = 180000;
const QUIET_RESPONSE_LEN = 2048;

const OLD_DEFAULT_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
已有的长期记忆总结：
{{summary}}

最近的对话：
{{history}}

请完成两件事：
1. 用简洁的中文要点总结"最近的对话"中发生的重要剧情、关系变化、状态变化（不要重复已有总结）。
2. 提取新出现的设定、人物、地点、物品或关键事件，作为关键词记忆条目。

严格只输出如下 JSON，不要输出其他内容：
{"summary":"本段总结","entries":[{"keywords":["关键词1","关键词2"],"content":"条目内容"}]}`;

const DEFAULT_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
已有的长期记忆总结：
{{summary}}

已有的关键词记忆（这些设定已被记录，不要重复提取，也不要改写它们）：
{{keywords}}

最近的对话：
{{history}}

请完成两件事：
1. 用简洁的中文要点总结"最近的对话"中发生的重要剧情、关系变化、状态变化（不要重复已有总结）。
2. 只提取"最近的对话"里新出现、且尚未被上方已有关键词覆盖的设定、人物、地点、物品或关键事件，作为新的关键词记忆条目。不要输出已有条目，不要修改已有条目。若没有新设定，entries 返回空数组。

严格只输出如下 JSON，不要输出其他内容，不要用 Markdown 代码块包裹：
{"summary":"本段总结","entries":[{"keywords":["关键词1","关键词2"],"content":"条目内容"}]}`;

const EXTRACT_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
已有的关键词记忆（不要重复提取，不要改写）：
{{keywords}}

最近的对话：
{{history}}

只提取对话中新出现、尚未被已有关键词覆盖的设定、人物、地点、物品或关键事件，作为新的关键词记忆条目。不要输出已有条目，不要修改已有条目。若没有新设定，entries 返回空数组。
严格只输出如下 JSON，不要输出其他内容，不要用 Markdown 代码块包裹：
{"entries":[{"keywords":["关键词1","关键词2"],"content":"条目内容"}]}`;

const DEFAULTS = {
  enabled: true, auto: true, keyword: true, extract: true, debug: false,
  interval: 10, depth: 4, position: 1, scan: 4, kwDepth: 2,
  prompt: DEFAULT_PROMPT,
};

const SUMMARY_KEYS = ['summary', '总结', '摘要', '剧情总结', '本段总结', 'recap', 'synopsis'];
const ENTRIES_KEYS = ['entries', 'entry', 'items', 'memories', 'memory_entries', '记忆', '条目', '关键词条目', '新条目', '新记忆'];
const KW_KEYS = ['keywords', 'keyword', 'keys', 'tags', '关键词', '关键字', '词'];
const CONTENT_KEYS = ['content', 'text', 'value', 'description', 'body', 'memory', '内容', '描述', '说明', '正文'];

let busy = false;
let runSeq = 0;
const ctx = () => SillyTavern.getContext();
function settings() {
  const es = ctx().extensionSettings;
  es[MODULE] = Object.assign({}, DEFAULTS, es[MODULE] || {});
  return es[MODULE];
}
function meta() {
  const m = ctx().chatMetadata;
  if (!m) return null;
  if (!m[META]) m[META] = { summary: '', entries: [], lastIndex: 0 };
  const d = m[META];
  if (!Array.isArray(d.entries)) d.entries = [];
  d.summary ||= '';
  let li = Number(d.lastIndex);
  if (!Number.isFinite(li) || li < 0) li = 0;
  const chat = ctx().chat;
  if (Array.isArray(chat) && li > chat.length) li = chat.length;
  d.lastIndex = li;
  return d;
}
const saveMeta = () => ctx().saveMetadata();
const saveSet = () => ctx().saveSettingsDebounced();
const status = (t) => $('#stmem_status').text(t);
const isDebug = () => { try { return !!settings().debug; } catch (e) { return false; } };

function migratePromptIfNeeded() {
  const s = settings();
  if (s.prompt === OLD_DEFAULT_PROMPT) {
    s.prompt = DEFAULT_PROMPT;
    saveSet();
    const $p = $('#stmem_prompt');
    if ($p.length) $p.val(s.prompt);
  }
}

function characterName() {
  const c = ctx();
  let name = '';
  try { name = c.name2 || ''; } catch (e) { /* ignore */ }
  if (!name && c.chat?.length) {
    const m = c.chat.find(x => !x.is_system && x.name);
    if (m) name = m.name;
  }
  return String(name || '记忆');
}

function safeFilename(s) {
  return String(s || '记忆')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || '记忆';
}

function dateStamp() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}`;
}

function buildExport() {
  const d = meta();
  if (!d) return null;
  return {
    type: EXPORT_TYPE,
    version: EXT_VERSION,
    exportedAt: new Date().toISOString(),
    character: characterName(),
    summary: d.summary || '',
    entries: JSON.parse(JSON.stringify(d.entries || [])),
    lastIndex: d.lastIndex || 0,
  };
}

function parseMemoryData(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) throw new Error('内容为空');
    try { obj = JSON.parse(s); } catch (e) { throw new Error('不是有效的 JSON'); }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('文件格式无效');
  if (obj.type && obj.type !== EXPORT_TYPE) throw new Error('不是本插件导出的记忆文件');
  if (obj.summary == null && !Array.isArray(obj.entries)) {
    throw new Error('文件中没有找到记忆数据（缺少 summary / entries）');
  }
  const summary = obj.summary != null ? String(obj.summary) : '';
  const src = Array.isArray(obj.entries) ? obj.entries : [];
  const entries = [];
  for (const e of src) {
    if (!e || typeof e !== 'object') continue;
    const kws = (Array.isArray(e.keywords) ? e.keywords : String(e.keywords || '').split(/[,，]/))
      .map(k => String(k).trim()).filter(Boolean);
    const content = e.content != null ? String(e.content) : '';
    if (!kws.length && !content) continue;
    entries.push({ keywords: kws, content });
  }
  return { summary, entries };
}

function mergeEntries(target, incoming) {
  for (const e of incoming) {
    const kws = e.keywords.slice();
    const ex = kws.length ? target.find(x => x.keywords.some(k => kws.includes(k))) : null;
    if (ex) {
      ex.keywords = [...new Set([...ex.keywords, ...kws])];
      const content = String(e.content || '').trim();
      if (content && !(ex.content || '').includes(content)) {
        ex.content = ex.content ? ex.content + '\n' + content : content;
      }
    } else {
      target.push({ keywords: kws, content: String(e.content || '') });
    }
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function exportMemory() {
  const data = buildExport();
  if (!data) { toastr.error('当前没有打开的聊天，无法导出'); return; }
  const text = JSON.stringify(data, null, 2);
  const filename = `记忆_${safeFilename(data.character)}_${dateStamp()}.json`;
  downloadText(filename, text);
  const empty = !data.summary && !data.entries.length;
  if (empty) toastr.info('当前记忆为空，仍已导出：' + filename);
  else toastr.success('已导出记忆：' + filename);
}

async function copyMemory() {
  const data = buildExport();
  if (!data) { toastr.error('当前没有打开的聊天，无法复制'); return; }
  const text = JSON.stringify(data, null, 2);
  const ok = await copyText(text);
  if (ok) toastr.success('记忆已复制到剪贴板');
  else toastr.error('复制失败，请改用「导出记忆」下载文件');
}

async function applyImported(data) {
  const d = meta();
  if (!d) { toastr.error('当前没有打开的聊天，无法导入'); return false; }
  if (!confirm('将记忆导入到当前聊天？')) return false;
  const empty = !d.summary && !(d.entries && d.entries.length);
  let overwrite = true;
  if (!empty) {
    overwrite = confirm('如何导入？\n\n确定 = 覆盖当前记忆（清空后写入导入内容）\n取消 = 与当前记忆合并（追加总结，按关键词去重条目）');
  }
  if (overwrite) {
    d.summary = data.summary;
    d.entries = data.entries.map(e => ({ keywords: e.keywords.slice(), content: e.content }));
  } else {
    if (data.summary && data.summary.trim()) {
      d.summary = (d.summary ? d.summary + '\n' : '') + data.summary.trim();
    }
    mergeEntries(d.entries, data.entries);
  }
  // 不恢复导出文件里的 lastIndex：新聊天的消息序号不同，应从当前进度继续总结
  d.lastIndex = (ctx().chat || []).length;
  await saveMeta();
  renderChat();
  inject();
  toastr.success(overwrite ? '记忆已覆盖导入到当前聊天' : '记忆已合并导入到当前聊天');
  return true;
}

async function importFromText(text) {
  try {
    const data = parseMemoryData(text);
    return await applyImported(data);
  } catch (err) {
    console.error('[st-memory]', err);
    toastr.error('导入失败：' + err.message);
    return false;
  }
}

function importFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => toastr.error('读取文件失败');
  reader.onload = () => importFromText(String(reader.result || ''));
  reader.readAsText(file, 'UTF-8');
}

function unwrapGen(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  if (typeof res === 'object') {
    const v = res.response ?? res.text ?? res.content ?? res.message ?? res.result ?? res.output ?? res.data;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      return v.map(x => (typeof x === 'string' ? x : (x && (x.text || x.content)) || '')).join('');
    }
  }
  return String(res);
}

function isObjectStyleQuiet(fn) {
  try {
    const src = Function.prototype.toString.call(fn);
    if (/\(\s*\{/.test(src)) return true;
    if (/\(\s*quietPrompt\s*,/.test(src)) return false;
  } catch (e) { /* ignore */ }
  return fn.length <= 1;
}

async function quiet(prompt) {
  const fn = ctx().generateQuietPrompt;
  if (typeof fn !== 'function') throw new Error('当前酒馆版本不支持静默生成（generateQuietPrompt）');
  let res;
  if (isObjectStyleQuiet(fn)) {
    res = await fn({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true, responseLength: QUIET_RESPONSE_LEN });
  } else {
    // 1.12 positional: (quietPrompt, quietToLoud, skipWIAN, quietImage, quietName, responseLength)
    res = await fn(prompt, false, true, null, null, QUIET_RESPONSE_LEN);
  }
  return unwrapGen(res);
}

function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

function stripFences(s) {
  return String(s || '')
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json|JSON|javascript|js)?\s*/g, '')
    .replace(/```/g, '')
    .trim();
}

function normalizeJsonLookalike(s) {
  // 只替换排版引号与全角 JSON 符号；不要替换「」这类正文常用括号
  return String(s || '')
    .replace(/[\u201C\u201D\uFF02]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/\uFF3B/g, '[')
    .replace(/\uFF3D/g, ']')
    .replace(/\uFF5B/g, '{')
    .replace(/\uFF5D/g, '}');
}

function tryParseJson(s) {
  try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, value: null }; }
}

function closeTruncatedJson(s) {
  let inStr = false, esc = false, quote = '', stack = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if ((ch === '}' || ch === ']') && stack.length && stack[stack.length - 1] === ch) stack.pop();
  }
  let out = s;
  if (inStr) out += quote;
  out = out.replace(/[,:]\s*$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

function repairAndParse(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const noTrail = t.replace(/,\s*([}\]])/g, '$1');
  let r = tryParseJson(noTrail);
  if (r.ok) return r.value;
  r = tryParseJson(t);
  if (r.ok) return r.value;
  const closed = closeTruncatedJson(noTrail);
  r = tryParseJson(closed);
  if (r.ok) return r.value;
  r = tryParseJson(closed.replace(/,\s*([}\]])/g, '$1'));
  return r.ok ? r.value : null;
}

function extractBalanced(s, startCh, endCh, from) {
  const i = s.indexOf(startCh, from);
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === startCh) depth++;
    else if (ch === endCh) {
      depth--;
      if (depth === 0) return { text: s.slice(i, j + 1), partial: false };
    }
  }
  return { text: s.slice(i), partial: true };
}

function looksLikeMemoryObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return true;
  const keys = Object.keys(obj);
  const names = SUMMARY_KEYS.concat(ENTRIES_KEYS);
  return keys.some(k => names.some(n => k === n || k.toLowerCase() === n.toLowerCase()));
}

function firstJsonValue(text) {
  const t = normalizeJsonLookalike(stripFences(text));
  if (!t) return null;
  let obj = repairAndParse(t);
  if (obj && looksLikeMemoryObject(obj)) return obj;
  const starts = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{' || t[i] === '[') starts.push(i);
  }
  let fallback = obj;
  for (const i of starts) {
    const extracted = extractBalanced(t, t[i], t[i] === '{' ? '}' : ']', i);
    if (!extracted) continue;
    const v = repairAndParse(extracted.text);
    if (!v) continue;
    if (looksLikeMemoryObject(v)) return v;
    if (fallback == null) fallback = v;
  }
  return fallback;
}

function keyOf(obj, names) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const keys = Object.keys(obj);
  for (const n of names) {
    const hit = keys.find(k => k === n || k.toLowerCase() === String(n).toLowerCase());
    if (hit !== undefined) return obj[hit];
  }
  return undefined;
}

function splitKeywords(raw) {
  if (Array.isArray(raw)) return raw.map(k => String(k).trim()).filter(Boolean);
  return String(raw || '').split(/[,，、;；]/).map(k => String(k).trim()).filter(Boolean);
}

function normalizeEntry(e) {
  if (e == null) return null;
  if (typeof e === 'string') {
    const t = e.trim();
    if (!t) return null;
    const m = t.match(/^(?:关键词|关键字|keywords?|tags?)\s*[:：]\s*(.+?)\s*(?:内容|描述|说明|content)\s*[:：]\s*(.+)$/i)
      || t.match(/^(.+?)[:：]\s+(.+)$/);
    if (m) {
      const kws = splitKeywords(m[1]);
      const content = String(m[2] || '').trim();
      if (kws.length && content) return { keywords: kws, content };
    }
    return null;
  }
  if (typeof e !== 'object') return null;
  let kwsRaw = keyOf(e, KW_KEYS);
  if (kwsRaw == null && e.name != null) kwsRaw = e.name;
  const contentRaw = keyOf(e, CONTENT_KEYS);
  const kws = splitKeywords(kwsRaw);
  const content = contentRaw != null ? String(contentRaw).trim() : '';
  if (!kws.length || !content) return null;
  return { keywords: kws, content };
}

function parseListFallback(text) {
  const s = String(text || '');
  const entries = [];
  const re = /(?:^|\n)\s*(?:\d+[\.、\)]\s*)?(?:关键词|关键字|keywords?|tags?)\s*[:：]\s*(.+?)\s*(?:内容|描述|说明|content)\s*[:：]\s*(.+?)(?=(?:\n\s*(?:\d+[\.、\)]\s*)?(?:关键词|关键字|keywords?|tags?)\s*[:：])|$)/gi;
  let m;
  while ((m = re.exec(s))) {
    const kws = splitKeywords(m[1]);
    const content = String(m[2] || '').replace(/[\s。]*$/, '').trim();
    if (kws.length && content) entries.push({ keywords: kws, content });
  }
  return entries;
}

function collectEntries(raw) {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    const parsed = firstJsonValue(raw);
    if (Array.isArray(parsed)) return collectEntries(parsed);
    if (parsed && typeof parsed === 'object') {
      const inner = keyOf(parsed, ENTRIES_KEYS);
      if (inner != null) return collectEntries(inner);
    }
    return parseListFallback(raw);
  }
  if (Array.isArray(raw)) return raw.map(normalizeEntry).filter(Boolean);
  if (typeof raw === 'object') {
    const one = normalizeEntry(raw);
    return one ? [one] : [];
  }
  return [];
}

function looksLikeRefusal(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 800) return false;
  return /(^|\n)\s*(\{\s*\}\s*)?$/.test(t)
    || /blocked by|safety|content filter|i\s*(can('t|not)|am unable to)|as an ai|拒绝|无法遵守|安全策略|不便回答|我不能(回答|协助|提供)|被拦截/i.test(t);
}

/**
 * 解析模型对总结/提取提示的回复。尽量容忍代码块、中文键名、全角标点、尾逗号和截断。
 * @returns {{ summary: string, entries: {keywords:string[], content:string}[], parseOk: boolean }}
 */
function parseModelResponse(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { summary: '', entries: [], parseOk: false };
  const obj = firstJsonValue(raw);
  let summary = '';
  let entries = [];
  let parseOk = false;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    parseOk = true;
    const sv = keyOf(obj, SUMMARY_KEYS);
    if (sv != null) summary = String(sv).trim();
    const ev = keyOf(obj, ENTRIES_KEYS);
    entries = collectEntries(ev != null ? ev : []);
  } else if (Array.isArray(obj)) {
    parseOk = true;
    entries = collectEntries(obj);
  }
  if (!entries.length) {
    const fb = parseListFallback(raw);
    if (fb.length) {
      entries = fb;
      parseOk = true;
    }
  }
  if (!summary && !parseOk && !looksLikeRefusal(raw)) {
    summary = stripFences(raw);
  }
  return { summary, entries, parseOk };
}

function normalizeContent(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，。、「」『』“”‘’！？、,.!?;:：；…—\-～~]/g, '');
}

function isNearDuplicate(target, content) {
  const n = normalizeContent(content);
  if (!n) return true;
  for (const e of target) {
    const m = normalizeContent(e.content);
    if (!m) continue;
    if (m === n) return true;
    if (m.includes(n) || n.includes(m)) {
      const ratio = Math.min(m.length, n.length) / Math.max(m.length, n.length);
      if (ratio >= 0.8) return true;
    }
  }
  return false;
}

/** 只追加全新条目，绝不改写已有条目。关键词重叠但内容确实不同时仍新增。 */
function addNewEntries(target, incoming) {
  let added = 0, skipped = 0;
  for (const e of incoming || []) {
    const kws = (e.keywords || []).map(k => String(k).trim()).filter(Boolean);
    const content = String(e.content || '').trim();
    if (!kws.length || !content) { skipped++; continue; }
    if (isNearDuplicate(target, content)) { skipped++; continue; }
    target.push({ keywords: kws, content });
    added++;
  }
  return { added, skipped };
}

function formatExistingKeywords(d) {
  const entries = (d && d.entries) || [];
  if (!entries.length) return '（无）';
  const lines = entries.map(e => {
    const k = (e.keywords || []).filter(Boolean).join('、') || '（无关键词）';
    return `- ${k}`;
  });
  const text = lines.join('\n');
  if (text.length > 4000) return lines.slice(0, 200).join('\n') + `\n…共 ${entries.length} 条，已截断`;
  return text;
}

function fillPrompt(tpl, history, summary, keywords) {
  const rawTpl = String(tpl || DEFAULT_PROMPT);
  let p = rawTpl
    .replace(/\{\{history\}\}/g, history)
    .replace(/\{\{summary\}\}/g, summary || '（无）')
    .replace(/\{\{keywords\}\}/g, keywords || '（无）');
  if (!/\{\{keywords\}\}/.test(rawTpl)) {
    p += `\n\n已有的关键词记忆（不要重复提取这些已覆盖的设定，也不要改写它们）：\n${keywords || '（无）'}\n请只提取尚未被上述关键词覆盖的新设定/人物/地点/物品/事件。若没有新设定，entries 返回空数组。`;
  }
  return p;
}

async function summarize(force = false, extractOnly = false) {
  const s = settings(); const d = meta(); const c = ctx();
  if (!d || !c.chat?.length) {
    if (force || extractOnly) toastr.info('当前没有可分析的聊天');
    return;
  }
  if (busy && !force && !extractOnly) return;
  busy = true;
  const my = ++runSeq;
  status(extractOnly ? '提取关键词中…' : '总结中…');
  try {
    const chat = c.chat;
    const start = Math.min(Math.max(0, Number(d.lastIndex) || 0), chat.length);
    let msgs = chat.slice(start).filter(m => !m.is_system && m.mes);
    let backfill = false;
    if (!msgs.length && (force || extractOnly)) {
      const window = Math.max(Number(s.interval) || 10, 4);
      msgs = chat.filter(m => !m.is_system && m.mes).slice(-window);
      backfill = true;
    }
    if (!msgs.length) {
      if (force || extractOnly) toastr.info('没有可分析的消息');
      return;
    }
    const history = msgs.map(m => `${m.name}: ${m.mes}`).join('\n');
    const kwText = formatExistingKeywords(d);
    const skipSummary = extractOnly || backfill;
    const prompt = skipSummary
      ? EXTRACT_PROMPT.replace(/\{\{history\}\}/g, history).replace(/\{\{keywords\}\}/g, kwText)
      : fillPrompt(s.prompt, history, d.summary, kwText);
    if (s.debug) console.log('[st-memory] prompt:', prompt);

    const raw = await withTimeout(quiet(prompt), QUIET_TIMEOUT_MS, '请求超时（180秒）');
    if (my !== runSeq) return;
    if (s.debug) console.log('[st-memory] raw response:', raw);

    if (!String(raw || '').trim()) {
      status('总结失败');
      toastr.error('模型没有返回内容（可能被拦截或截断）');
      return;
    }
    if (looksLikeRefusal(raw) && !firstJsonValue(raw)) {
      status('总结失败');
      toastr.error('模型拒绝或拦截了总结请求');
      if (s.debug) toastr.info('调试：' + String(raw).slice(0, 200));
      return;
    }

    const res = parseModelResponse(raw);
    let added = 0, skipped = 0;
    if (!skipSummary && res.summary) {
      d.summary = (d.summary ? d.summary + '\n' : '') + String(res.summary).trim();
    }
    if ((s.extract || extractOnly) && res.entries.length) {
      const r = addNewEntries(d.entries, res.entries);
      added = r.added;
      skipped = r.skipped;
    } else if ((s.extract || extractOnly) && !res.entries.length) {
      skipped = 0;
    }
    // 仅在正常总结成功时推进进度；提取重试、回看最近消息不改 lastIndex
    if (!backfill && !extractOnly) d.lastIndex = chat.length;
    await saveMeta();
    renderChat();
    inject();

    const time = new Date().toLocaleTimeString();
    status((extractOnly ? '已提取 ' : '已总结 ') + time + (added ? ` · 新增${added}条` : ''));

    if (s.debug) {
      console.log('[st-memory] parsed:', { parseOk: res.parseOk, got: res.entries.length, added, skipped, lastIndex: d.lastIndex });
      toastr.info(`调试：解析${res.parseOk ? '成功' : '失败'}，模型给出${res.entries.length}条，新增${added}，跳过${skipped}，原文${String(raw).length}字`);
    }
    if (force || extractOnly) {
      if (extractOnly || skipSummary) {
        if (added) toastr.success(`提取完成：新增 ${added} 条关键词，跳过 ${skipped} 条重复`);
        else if (!res.parseOk) toastr.warning('未能解析出关键词条目。请打开「调试模式」后重试，并把控制台里 [st-memory] raw response 发给我');
        else toastr.info(`没有提取到新的关键词条目（跳过 ${skipped} 条重复或空条目）`);
      } else {
        if (!res.parseOk) toastr.warning('总结已写入，但关键词 JSON 解析失败。可打开「调试模式」后点「立即提取关键词」，并查看控制台 [st-memory] 日志');
        else if (added) toastr.success(`总结完成：新增 ${added} 条关键词，跳过 ${skipped} 条重复`);
        else toastr.info(`总结已完成，没有新增关键词条目（跳过 ${skipped} 条）`);
      }
    } else if (s.extract && !res.parseOk) {
      toastr.warning('剧情已总结，但关键词条目解析失败。可开启「调试模式」查看详情');
    } else if (s.debug && s.extract && !added) {
      toastr.info('总结完成，但没有提取到新的关键词条目');
    }
  } catch (err) {
    if (my !== runSeq) return;
    console.error('[st-memory]', err);
    status('总结失败');
    toastr.error((extractOnly ? '关键词提取失败：' : '剧情总结失败：') + (err && err.message ? err.message : String(err)));
  } finally {
    if (my === runSeq) busy = false;
  }
}

function inject() {
  const c = ctx(); const s = settings(); const d = meta();
  const pos = Number(s.position);
  if (!s.enabled || !d) { c.setExtensionPrompt(MODULE + '_sum', '', pos, 0); c.setExtensionPrompt(MODULE + '_kw', '', 1, 0); return; }
  c.setExtensionPrompt(MODULE + '_sum', d.summary ? `[剧情长期记忆]\n${d.summary}` : '', pos, Number(s.depth));
  let kw = '';
  if (s.keyword && d.entries.length && c.chat?.length) {
    const text = c.chat.slice(-Number(s.scan)).map(m => m.mes || '').join('\n').toLowerCase();
    const hits = d.entries.filter(e => e.keywords.some(k => k && text.includes(k.toLowerCase())));
    if (hits.length) kw = '[相关记忆]\n' + hits.map(e => `- ${e.content}`).join('\n');
  }
  c.setExtensionPrompt(MODULE + '_kw', kw, 1, Number(s.kwDepth));
}

async function onMessage() {
  const s = settings(); const d = meta();
  if (!s.enabled || !s.auto || !d) return;
  const len = (ctx().chat || []).length;
  if (d.lastIndex > len) d.lastIndex = len;
  if (len - d.lastIndex >= Number(s.interval)) await summarize();
}

function renderChat() {
  const d = meta();
  $('#stmem_summary').val(d ? d.summary : '');
  const box = $('#stmem_entries').empty();
  if (!d) return;
  d.entries.forEach((e, i) => {
    const el = $(`<div class="stmem-entry">
      <input class="text_pole stmem-k" placeholder="关键词，用逗号分隔">
      <textarea class="text_pole stmem-c" rows="2" placeholder="内容"></textarea>
      <div class="stmem-row"><div class="menu_button stmem-save">保存</div><div class="menu_button stmem-del">删除</div></div></div>`);
    el.find('.stmem-k').val(e.keywords.join(', '));
    el.find('.stmem-c').val(e.content);
    el.find('.stmem-save').on('click', async () => {
      e.keywords = el.find('.stmem-k').val().split(/[,，]/).map(x => x.trim()).filter(Boolean);
      e.content = el.find('.stmem-c').val();
      await saveMeta(); inject(); toastr.success('已保存');
    });
    el.find('.stmem-del').on('click', async () => { d.entries.splice(i, 1); await saveMeta(); renderChat(); inject(); });
    box.append(el);
  });
}

function bindSettings() {
  const s = settings();
  migratePromptIfNeeded();
  const map = { enabled: 'stmem_enabled', auto: 'stmem_auto', keyword: 'stmem_kw', extract: 'stmem_extract', debug: 'stmem_debug' };
  for (const [k, id] of Object.entries(map)) $('#' + id).prop('checked', s[k]).on('change', function () { s[k] = this.checked; saveSet(); inject(); });
  const nums = { interval: 'stmem_interval', depth: 'stmem_depth', scan: 'stmem_scan', kwDepth: 'stmem_kwdepth', position: 'stmem_position' };
  for (const [k, id] of Object.entries(nums)) $('#' + id).val(s[k]).on('input change', function () { s[k] = Number(this.value); saveSet(); inject(); });
  $('#stmem_prompt').val(s.prompt).on('input', function () { s.prompt = this.value; saveSet(); });
  $('#stmem_reset_prompt').on('click', () => { s.prompt = DEFAULT_PROMPT; $('#stmem_prompt').val(s.prompt); saveSet(); });
  $('#stmem_now').on('click', () => summarize(true, false));
  $('#stmem_extract_now').on('click', () => summarize(true, true));
  $('#stmem_save_summary').on('click', async () => { const d = meta(); if (!d) return; d.summary = $('#stmem_summary').val(); await saveMeta(); inject(); toastr.success('总结已保存'); });
  $('#stmem_clear_summary').on('click', async () => { const d = meta(); if (!d || !confirm('清空当前聊天的总结？')) return; d.summary = ''; d.lastIndex = 0; await saveMeta(); renderChat(); inject(); });
  $('#stmem_add_entry').on('click', async () => { const d = meta(); if (!d) return; d.entries.push({ keywords: [], content: '' }); await saveMeta(); renderChat(); });
  $('#stmem_export').on('click', () => exportMemory());
  $('#stmem_copy').on('click', () => copyMemory());
  $('#stmem_import').on('click', () => { $('#stmem_import_file').val(''); $('#stmem_import_file').trigger('click'); });
  $('#stmem_import_file').on('change', function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (file) importFromFile(file);
  });
  $('#stmem_import_paste').on('click', async () => {
    const text = $('#stmem_import_text').val();
    if (!String(text || '').trim()) { toastr.warning('请先粘贴记忆 JSON'); return; }
    if (await importFromText(text)) $('#stmem_import_text').val('');
  });
}

function boot() {
  jQuery(async () => {
    const html = await $.get(FOLDER + 'settings.html');
    $('#extensions_settings2').append(html);
    bindSettings();
    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, () => { renderChat(); inject(); });
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
    eventSource.on(event_types.GENERATION_STARTED, inject);
    eventSource.on(event_types.MESSAGE_DELETED, () => { const d = meta(); if (d && d.lastIndex > (ctx().chat || []).length) d.lastIndex = (ctx().chat || []).length; });
    renderChat(); inject();
  });
}

if (typeof jQuery === 'function') boot();

export { parseModelResponse, addNewEntries, isNearDuplicate, normalizeContent, firstJsonValue, unwrapGen };
