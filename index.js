// 通用剧情记忆 - SillyTavern third-party extension (1.12+)
const MODULE = 'st_memory';
const META = 'st_memory';
const EXPORT_TYPE = 'st_memory';
const EXT_VERSION = '1.2.0';
const FOLDER = new URL('.', import.meta.url).href;
const QUIET_TIMEOUT_MS = 180000;
const QUIET_RESPONSE_LEN = 3072;
const QUIET_RESPONSE_LEN_ONE = 2048;
const HISTORY_CHAR_BUDGET = 10000;
const ENTRIES_CHAR_BUDGET = 6000;
const ENTRY_CONTENT_CAP = 240;
const EXCERPT_CHAR_BUDGET = 8000;
const EXCERPT_MSG_CAP = 600;
const EXCERPT_RECENT_N = 6;

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

const PROMPT_V111 = `[暂停角色扮演。你现在是剧情记录员。]
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

const DEFAULT_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
已有的长期记忆总结：
{{summary}}

已有词条（只输出有变化的更新；无变化的不要写进 updates）：
{{entries}}

最近的对话：
{{history}}

请完成：
1. 用简洁的中文要点总结"最近的对话"中发生的重要剧情、关系变化、状态变化（不要重复已有总结）。
2. 若某条已有词条有了新进展、状态变化或新细节，写入 updates：保留仍然有效的旧信息，融入新内容，行文简洁，用 id 指定词条。无变化的不要列入。
3. 提取尚未被已有词条覆盖的新设定/人物/地点/物品/事件，写入 new。若没有则 new 为空数组。

可在 updates 里补充新的别名到 keywords，不要删除原有关键词。
严格只输出如下 JSON，不要输出其他内容，不要用 Markdown 代码块包裹：
{"summary":"本段总结","updates":[{"id":1,"content":"更新后的内容","keywords":["关键词"]}],"new":[{"keywords":["关键词1","关键词2"],"content":"条目内容"}]}`;

const DEFAULT_EXTRACT_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
已有词条（只输出有变化的更新，不要原样照抄无变化的词条）：
{{entries}}

最近的对话：
{{history}}

请完成两件事：
1. 若某条已有词条在对话中有了新进展、状态变化或新细节，将其更新写入 updates：保留仍然有效的旧信息，融入新内容，行文简洁，用 id 指定词条。无变化的词条不要放入 updates。
2. 提取对话中新出现、尚未被已有词条覆盖的设定/人物/地点/物品/事件，写入 new。不要重复已有内容。若没有新设定，new 为空数组。

可在 updates 里补充新的别名到 keywords，不要删除原有关键词。
严格只输出如下 JSON，不要输出其他内容，不要用 Markdown 代码块包裹：
{"updates":[{"id":1,"content":"更新后的内容","keywords":["关键词"]}],"new":[{"keywords":["关键词1","关键词2"],"content":"条目内容"}]}`;

const UPDATE_ONE_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
当前词条：
关键词：{{keywords}}
内容：{{content}}

相关对话摘录：
{{excerpts}}

请根据摘录更新该词条内容：保留仍然有效的旧信息，并融入新的进展、状态变化或新细节。行文简洁，不要重复废话。若摘录没有需要写入的新信息，让 content 与原文保持一致。
若出现该设定的新别称/别名，可在 keywords 中补充（不要删除原有关键词）。
严格只输出如下 JSON，不要输出其他内容，不要用 Markdown 代码块包裹：
{"content":"更新后的内容","keywords":["关键词1","关键词2"]}`;

const DEFAULTS = {
  enabled: true, auto: true, keyword: true, extract: true, debug: false, updateOld: true,
  interval: 10, depth: 4, position: 1, scan: 4, kwDepth: 2, extractWindow: 20,
  prompt: DEFAULT_PROMPT,
  extractPrompt: DEFAULT_EXTRACT_PROMPT,
};

const SUMMARY_KEYS = ['summary', '总结', '摘要', '剧情总结', '本段总结', 'recap', 'synopsis'];
const ENTRIES_KEYS = ['entries', 'entry', 'items', 'memories', 'memory_entries', '记忆', '条目', '关键词条目'];
const NEW_KEYS = ['new', 'new_entries', 'added', 'add', 'news', '新', '新条目', '新增', '新增条目', '新记忆'];
const UPDATE_KEYS = ['updates', 'update', 'updated', 'changes', 'changed', '修改', '更新', '更新条目', '改写'];
const KW_KEYS = ['keywords', 'keyword', 'keys', 'tags', '关键词', '关键字', '词'];
const CONTENT_KEYS = ['content', 'text', 'value', 'description', 'body', 'memory', '内容', '描述', '说明', '正文'];
const ID_KEYS = ['id', 'ID', 'Id', '词条id', 'entry_id', 'entryId', '编号'];
const INDEX_KEYS = ['index', 'idx', '序号'];

let busy = false;
let runSeq = 0;
let undoState = null;
const ctx = () => SillyTavern.getContext();
function settings() {
  const es = ctx().extensionSettings;
  es[MODULE] = Object.assign({}, DEFAULTS, es[MODULE] || {});
  return es[MODULE];
}
function ensureEntryIds(d) {
  if (!d || !Array.isArray(d.entries)) return;
  let max = 0;
  for (const e of d.entries) {
    const id = Number(e.id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  let next = max + 1;
  for (const e of d.entries) {
    const id = Number(e.id);
    if (!Number.isFinite(id) || id <= 0) e.id = next++;
  }
}
function meta() {
  const m = ctx().chatMetadata;
  if (!m) return null;
  if (!m[META]) m[META] = { summary: '', entries: [], lastIndex: 0, lastExtractIndex: 0 };
  const d = m[META];
  if (!Array.isArray(d.entries)) d.entries = [];
  d.summary ||= '';
  ensureEntryIds(d);
  const chat = ctx().chat;
  const clamp = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (Array.isArray(chat) && n > chat.length) n = chat.length;
    return n;
  };
  d.lastIndex = clamp(d.lastIndex);
  d.lastExtractIndex = clamp(d.lastExtractIndex);
  return d;
}
const saveMeta = () => ctx().saveMetadata();
const saveSet = () => ctx().saveSettingsDebounced();
const status = (t) => $('#stmem_status').text(t);

function migratePromptIfNeeded() {
  const s = settings();
  if (s.prompt === OLD_DEFAULT_PROMPT || s.prompt === PROMPT_V111) {
    s.prompt = DEFAULT_PROMPT;
    saveSet();
  }
  if (!s.extractPrompt) {
    s.extractPrompt = DEFAULT_EXTRACT_PROMPT;
    saveSet();
  }
  const $p = $('#stmem_prompt');
  if ($p.length) $p.val(s.prompt);
  const $e = $('#stmem_extract_prompt');
  if ($e.length) $e.val(s.extractPrompt);
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
    lastExtractIndex: d.lastExtractIndex || 0,
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
    const item = { keywords: kws, content };
    const id = Number(e.id);
    if (Number.isFinite(id) && id > 0) item.id = id;
    const ui = Number(e.updatedIndex);
    if (Number.isFinite(ui) && ui >= 0) item.updatedIndex = ui;
    entries.push(item);
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
      target.push({ id: nextEntryId(target), keywords: kws, content: String(e.content || '') });
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
  pushUndo(d, '导入记忆');
  if (overwrite) {
    d.summary = data.summary;
    d.entries = data.entries.map(e => Object.assign({}, e, { keywords: (e.keywords || []).slice() }));
  } else {
    if (data.summary && data.summary.trim()) {
      d.summary = (d.summary ? d.summary + '\n' : '') + data.summary.trim();
    }
    mergeEntries(d.entries, data.entries);
  }
  ensureEntryIds(d);
  // 不恢复导出文件里的进度：新聊天的消息序号不同
  d.lastIndex = (ctx().chat || []).length;
  d.lastExtractIndex = d.lastIndex;
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

async function quiet(prompt, responseLength) {
  const fn = ctx().generateQuietPrompt;
  if (typeof fn !== 'function') throw new Error('当前酒馆版本不支持静默生成（generateQuietPrompt）');
  const len = responseLength || QUIET_RESPONSE_LEN;
  let res;
  if (isObjectStyleQuiet(fn)) {
    res = await fn({ quietPrompt: prompt, quietToLoud: false, skipWIAN: true, responseLength: len });
  } else {
    res = await fn(prompt, false, true, null, null, len);
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
  const names = SUMMARY_KEYS.concat(ENTRIES_KEYS, NEW_KEYS, UPDATE_KEYS, CONTENT_KEYS);
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
      const inner = keyOf(parsed, NEW_KEYS) ?? keyOf(parsed, ENTRIES_KEYS);
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

function parseUpdateItem(u) {
  if (u == null) return null;
  if (typeof u === 'string') {
    const content = u.trim();
    return content ? { content } : null;
  }
  if (typeof u !== 'object') return null;
  const contentRaw = keyOf(u, CONTENT_KEYS);
  const content = contentRaw != null ? String(contentRaw).trim() : '';
  if (!content) return null;
  const item = { content };
  const idRaw = keyOf(u, ID_KEYS);
  if (idRaw != null && String(idRaw).trim() !== '') {
    const n = Number(idRaw);
    item.id = Number.isFinite(n) ? n : idRaw;
  }
  const idxRaw = keyOf(u, INDEX_KEYS);
  if (idxRaw != null && Number.isFinite(Number(idxRaw))) item.index = Number(idxRaw);
  const kwsRaw = keyOf(u, KW_KEYS);
  if (kwsRaw != null) {
    const kws = splitKeywords(kwsRaw);
    if (kws.length) item.keywords = kws;
  }
  return item;
}

function collectUpdates(raw) {
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    const parsed = firstJsonValue(raw);
    if (parsed != null) return collectUpdates(parsed);
    return [];
  }
  if (Array.isArray(raw)) return raw.map(parseUpdateItem).filter(Boolean);
  if (typeof raw === 'object') {
    const one = parseUpdateItem(raw);
    if (one && (one.id != null || one.index != null || one.keywords)) return [one];
    const out = [];
    for (const [k, v] of Object.entries(raw)) {
      if (["summary", "new", "entries", "updates"].includes(k)) continue;
      const item = parseUpdateItem(v);
      if (!item) continue;
      if (item.id == null && /^\d+$/.test(k)) item.id = Number(k);
      out.push(item);
    }
    return out;
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
 * 解析模型回复。兼容旧的 entries 格式，以及 updates + new。
 * @returns {{ summary: string, entries: object[], updates: object[], parseOk: boolean }}
 */
function parseModelResponse(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { summary: '', entries: [], updates: [], parseOk: false };
  const obj = firstJsonValue(raw);
  let summary = '';
  let entries = [];
  let updates = [];
  let parseOk = false;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    parseOk = true;
    const sv = keyOf(obj, SUMMARY_KEYS);
    if (sv != null) summary = String(sv).trim();
    const uv = keyOf(obj, UPDATE_KEYS);
    if (uv != null) updates = collectUpdates(uv);
    const nv = keyOf(obj, NEW_KEYS);
    const ev = keyOf(obj, ENTRIES_KEYS);
    if (nv != null) entries = collectEntries(nv);
    else if (ev != null && uv == null) entries = collectEntries(ev);
    else if (ev != null && uv != null) entries = collectEntries(ev);
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
  return { summary, entries, updates, parseOk };
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

function nextEntryId(entries) {
  let max = 0;
  for (const e of entries || []) {
    const id = Number(e.id);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max + 1;
}

function addNewEntries(target, incoming, chatLen) {
  let added = 0, skipped = 0;
  let nextId = nextEntryId(target);
  const len = Number.isFinite(chatLen) ? chatLen : 0;
  for (const e of incoming || []) {
    const kws = (e.keywords || []).map(k => String(k).trim()).filter(Boolean);
    const content = String(e.content || '').trim();
    if (!kws.length || !content) { skipped++; continue; }
    if (isNearDuplicate(target, content)) { skipped++; continue; }
    target.push({ id: nextId++, keywords: kws, content, updatedIndex: len });
    added++;
  }
  return { added, skipped };
}

function findEntry(entries, u) {
  if (!u || !Array.isArray(entries)) return null;
  if (u.id != null && String(u.id).trim() !== '') {
    const idNum = Number(u.id);
    let hit = Number.isFinite(idNum) ? entries.find(e => Number(e.id) === idNum) : null;
    if (hit) return hit;
    hit = entries.find(e => String(e.id) === String(u.id));
    if (hit) return hit;
  }
  if (u.index != null && Number.isFinite(Number(u.index))) {
    const i = Number(u.index);
    if (i >= 1 && i <= entries.length) return entries[i - 1];
    if (i >= 0 && i < entries.length) return entries[i];
  }
  if (u.keywords && u.keywords.length) {
    const hits = entries.filter(e => (e.keywords || []).some(k => u.keywords.includes(k)));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** 按 id/index 更新已有词条；只扩展关键词，不删除旧关键词。内容完全相同则跳过。 */
function applyUpdates(entries, updates, chatLen) {
  let updated = 0, skipped = 0;
  const len = Number.isFinite(chatLen) ? chatLen : 0;
  for (const u of updates || []) {
    const entry = findEntry(entries, u);
    if (!entry) { skipped++; continue; }
    const content = String(u.content || '').trim();
    if (!content) { skipped++; continue; }
    let changed = false;
    if (normalizeContent(content) !== normalizeContent(entry.content)) {
      entry.content = content;
      changed = true;
    }
    if (u.keywords && u.keywords.length) {
      const merged = [...new Set([...(entry.keywords || []), ...u.keywords.map(k => String(k).trim()).filter(Boolean)])];
      if (merged.length !== (entry.keywords || []).length) {
        entry.keywords = merged;
        changed = true;
      }
    }
    if (changed) {
      entry.updatedIndex = len;
      updated++;
    } else skipped++;
  }
  return { updated, skipped };
}

function truncateText(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
}

function formatHistory(msgs, budget = HISTORY_CHAR_BUDGET) {
  const chosen = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const line = `${msgs[i].name}: ${truncateText(msgs[i].mes, 800)}`;
    if (used + line.length + 1 > budget && chosen.length) break;
    chosen.push(line);
    used += line.length + 1;
  }
  return chosen.reverse().join('\n');
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

/** 紧凑列出已有词条。优先列入关键词出现在 recentText 中的条目。 */
function formatEntriesCompact(entries, recentText, budget = ENTRIES_CHAR_BUDGET, contentCap = ENTRY_CONTENT_CAP) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '（无）';
  const recent = String(recentText || '').toLowerCase();
  const scored = list.map((e, i) => {
    const kws = e.keywords || [];
    const hit = recent && kws.some(k => k && recent.includes(String(k).toLowerCase()));
    return { e, i, hit: hit ? 0 : 1 };
  }).sort((a, b) => a.hit - b.hit || a.i - b.i);
  const lines = [];
  let used = 0;
  for (const item of scored) {
    const e = item.e;
    const cap = item.hit === 0 ? contentCap : Math.max(80, Math.floor((contentCap || 160) / 2));
    const line = contentCap <= 0
      ? `#${e.id} [${(e.keywords || []).join('、')}]`
      : `#${e.id} [${(e.keywords || []).join('、')}] ${truncateText(e.content, cap)}`;
    if (used + line.length + 1 > budget && lines.length) {
      lines.push(`…其余 ${list.length - lines.length} 条已省略`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

function fillPlaceholders(tpl, map) {
  let p = String(tpl || '');
  for (const [k, v] of Object.entries(map)) {
    p = p.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), v == null ? '' : String(v));
  }
  return p;
}

function fillSummaryPrompt(tpl, history, summary, entriesText, keywordsText, updateOld) {
  const rawTpl = String(tpl || DEFAULT_PROMPT);
  let p = fillPlaceholders(rawTpl, {
    history,
    summary: summary || '（无）',
    entries: entriesText || '（无）',
    keywords: keywordsText || '（无）',
  });
  if (updateOld && !/\{\{entries\}\}/.test(rawTpl)) {
    p += `\n\n已有词条：\n${entriesText || '（无）'}\n若有新进展，请在 JSON 中返回 updates 与 new，格式为 {"summary":"...","updates":[{"id":1,"content":"..."}],"new":[...]}。无变化的词条不要列入 updates。`;
  }
  return p;
}

function fillExtractPrompt(tpl, history, entriesText) {
  const rawTpl = String(tpl || DEFAULT_EXTRACT_PROMPT);
  let p = fillPlaceholders(rawTpl, {
    history,
    entries: entriesText || '（无）',
    keywords: entriesText || '（无）',
    summary: '',
  });
  if (!/\{\{entries\}\}/.test(rawTpl)) {
    p += `\n\n已有词条：\n${entriesText || '（无）'}`;
  }
  return p;
}

function messageHasKeyword(mes, keywords) {
  const t = String(mes || '').toLowerCase();
  return (keywords || []).some(k => k && t.includes(String(k).toLowerCase()));
}

function collectRelevantExcerpts(chat, entry, budget = EXCERPT_CHAR_BUDGET) {
  const list = Array.isArray(chat) ? chat : [];
  const kws = entry.keywords || [];
  const after = Number.isFinite(Number(entry.updatedIndex)) ? Number(entry.updatedIndex) : 0;
  const used = new Set();
  const picked = [];
  const add = (i, prio) => {
    if (used.has(i)) return;
    const m = list[i];
    if (!m || m.is_system || !m.mes) return;
    used.add(i);
    picked.push({ index: i, name: m.name, mes: m.mes, prio });
  };
  for (let i = Math.max(0, list.length - EXCERPT_RECENT_N); i < list.length; i++) add(i, 1);
  for (let i = Math.max(after, 0); i < list.length; i++) {
    if (messageHasKeyword(list[i] && list[i].mes, kws)) add(i, 0);
  }
  for (let i = 0; i < Math.min(after, list.length); i++) {
    if (messageHasKeyword(list[i] && list[i].mes, kws)) add(i, 2);
  }
  picked.sort((a, b) => a.prio - b.prio || b.index - a.index);
  const chosen = [];
  let usedChars = 0;
  for (const p of picked) {
    const line = `${p.name}: ${truncateText(p.mes, EXCERPT_MSG_CAP)}`;
    if (usedChars + line.length + 1 > budget && chosen.length) continue;
    chosen.push({ index: p.index, line });
    usedChars += line.length + 1;
  }
  chosen.sort((a, b) => a.index - b.index);
  return chosen.map(x => x.line).join('\n');
}

function pickMessagesSince(chat, start, windowSize) {
  const list = Array.isArray(chat) ? chat : [];
  const from = Math.min(Math.max(0, Number(start) || 0), list.length);
  let msgs = list.slice(from).filter(m => !m.is_system && m.mes);
  let backfill = false;
  if (!msgs.length) {
    const window = Math.max(Number(windowSize) || 20, 4);
    msgs = list.filter(m => !m.is_system && m.mes).slice(-window);
    backfill = true;
  }
  return { msgs, backfill };
}

function pushUndo(d, label) {
  if (!d) return;
  undoState = {
    label: label || '词条更改',
    entries: JSON.parse(JSON.stringify(d.entries || [])),
  };
  updateUndoButton();
}

function clearUndo() {
  undoState = null;
  updateUndoButton();
}

function updateUndoButton() {
  const show = !!undoState;
  $('#stmem_undo, #stmem_undo2').each(function () {
    const el = $(this);
    if (show) el.removeClass('stmem-hidden').attr('title', '撤销：' + (undoState.label || ''));
    else el.addClass('stmem-hidden').removeAttr('title');
  });
}

async function undoLast() {
  const d = meta();
  if (!d || !undoState) { toastr.info('没有可撤销的更改'); return; }
  d.entries = undoState.entries;
  undoState = null;
  await saveMeta();
  renderChat();
  inject();
  updateUndoButton();
  toastr.success('已撤销上次词条更改');
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
  const wantExtract = extractOnly || !!s.extract;
  const wantUpdate = extractOnly || (wantExtract && s.updateOld !== false);
  status(extractOnly ? '提取/更新中…' : '总结中…');
  try {
    const chat = c.chat;
    let msgs, backfill;
    if (extractOnly) {
      const picked = pickMessagesSince(chat, d.lastExtractIndex, s.extractWindow);
      msgs = picked.msgs;
      backfill = picked.backfill;
    } else {
      const picked = pickMessagesSince(chat, d.lastIndex, s.interval);
      msgs = picked.msgs;
      backfill = picked.backfill;
    }
    if (!msgs.length) {
      if (force || extractOnly) toastr.info('没有可分析的消息');
      return;
    }
    const history = formatHistory(msgs);
    const entriesText = wantExtract
      ? formatEntriesCompact(d.entries, history, wantUpdate ? ENTRIES_CHAR_BUDGET : 2000, wantUpdate ? ENTRY_CONTENT_CAP : 0)
      : '（无）';
    const kwText = formatExistingKeywords(d);
    const skipSummary = extractOnly || (backfill && force);
    let prompt;
    if (skipSummary) {
      prompt = fillExtractPrompt(s.extractPrompt, history, wantUpdate ? entriesText : kwText);
    } else {
      prompt = fillSummaryPrompt(s.prompt, history, d.summary, wantUpdate ? entriesText : kwText, kwText, wantUpdate && wantExtract);
    }
    if (s.debug) console.log('[st-memory] prompt:', prompt);

    const raw = await withTimeout(quiet(prompt, QUIET_RESPONSE_LEN), QUIET_TIMEOUT_MS, '请求超时（180秒）');
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
    let added = 0, skipped = 0, updated = 0, updSkipped = 0;
    if (!skipSummary && res.summary) {
      d.summary = (d.summary ? d.summary + '\n' : '') + String(res.summary).trim();
    }
    if (wantExtract) {
      const prevUndo = undoState;
      const willChange = (wantUpdate && res.updates.length) || res.entries.length;
      if (willChange) pushUndo(d, extractOnly ? '提取/更新词条' : '总结时更新词条');
      if (wantUpdate && res.updates.length) {
        const ur = applyUpdates(d.entries, res.updates, chat.length);
        updated = ur.updated;
        updSkipped = ur.skipped;
      }
      if (res.entries.length) {
        const ar = addNewEntries(d.entries, res.entries, chat.length);
        added = ar.added;
        skipped = ar.skipped;
      }
      if (willChange && updated + added === 0) undoState = prevUndo;
    }
    if (!backfill && !extractOnly) d.lastIndex = chat.length;
    if (wantExtract) d.lastExtractIndex = chat.length;
    await saveMeta();
    renderChat();
    inject();
    updateUndoButton();

    const time = new Date().toLocaleTimeString();
    const counts = [];
    if (updated) counts.push(`更新${updated}条`);
    if (added) counts.push(`新增${added}条`);
    status((extractOnly ? '已提取 ' : '已总结 ') + time + (counts.length ? ' · ' + counts.join(' · ') : ''));

    if (s.debug) {
      console.log('[st-memory] parsed:', { parseOk: res.parseOk, updates: res.updates.length, gotNew: res.entries.length, updated, added, skipped, updSkipped, lastIndex: d.lastIndex, lastExtractIndex: d.lastExtractIndex });
      toastr.info(`调试：解析${res.parseOk ? '成功' : '失败'}，更新${updated}，新增${added}，跳过${skipped + updSkipped}，原文${String(raw).length}字`);
    }
    const toastCounts = `更新 ${updated} 条、新增 ${added} 条`;
    if (force || extractOnly) {
      if (!res.parseOk) {
        toastr.warning((skipSummary ? '提取' : '总结') + '已结束，但 JSON 解析失败。请打开「调试模式」后重试，并把控制台里 [st-memory] raw response 发给我');
      } else if (updated || added) {
        toastr.success((skipSummary ? '提取完成：' : '总结完成：') + toastCounts);
      } else {
        toastr.info((skipSummary ? '没有需要更新或新增的词条' : '总结已完成，没有需要更新或新增的词条') + (skipped + updSkipped ? `（跳过 ${skipped + updSkipped}）` : ''));
      }
    } else if (wantExtract && !res.parseOk) {
      toastr.warning('剧情已总结，但词条 JSON 解析失败。可开启「调试模式」查看详情');
    } else if (s.debug && wantExtract && !updated && !added) {
      toastr.info('总结完成，但没有更新或新增词条');
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

async function updateOneEntry(index) {
  const s = settings(); const d = meta(); const c = ctx();
  if (!d || !c.chat?.length) { toastr.info('当前没有可分析的聊天'); return; }
  const entry = d.entries[index];
  if (!entry) return;
  if (!(entry.keywords || []).length) { toastr.warning('请先为该词条填写关键词，再点「更新此词条」'); return; }
  if (busy) { toastr.info('已有总结或更新正在进行，请稍候再试'); return; }
  busy = true;
  const my = ++runSeq;
  status('更新词条中…');
  try {
    const excerpts = collectRelevantExcerpts(c.chat, entry);
    if (!excerpts.trim()) { toastr.info('找不到与该词条相关的对话'); return; }
    const prompt = fillPlaceholders(UPDATE_ONE_PROMPT, {
      keywords: (entry.keywords || []).join('、'),
      content: entry.content || '',
      excerpts,
    });
    if (s.debug) console.log('[st-memory] update-one prompt:', prompt);
    const raw = await withTimeout(quiet(prompt, QUIET_RESPONSE_LEN_ONE), QUIET_TIMEOUT_MS, '请求超时（180秒）');
    if (my !== runSeq) return;
    if (s.debug) console.log('[st-memory] update-one raw:', raw);
    if (!String(raw || '').trim()) { toastr.error('模型没有返回内容（可能被拦截或截断）'); return; }
    if (looksLikeRefusal(raw) && !firstJsonValue(raw)) {
      toastr.error('模型拒绝或拦截了更新请求');
      return;
    }
    const res = parseModelResponse(raw);
    let item = null;
    if (res.updates && res.updates.length) item = res.updates[0];
    else {
      const obj = firstJsonValue(raw);
      item = parseUpdateItem(obj);
    }
    if (!item || !item.content) {
      toastr.warning('未能解析出更新内容。请打开「调试模式」后重试，并查看控制台 [st-memory] 日志');
      return;
    }
    item.id = entry.id;
    const prevUndo = undoState;
    pushUndo(d, '更新词条 #' + entry.id);
    const ur = applyUpdates(d.entries, [item], c.chat.length);
    if (!ur.updated) {
      undoState = prevUndo;
      updateUndoButton();
      toastr.info('此词条暂无新进展');
      status('已检查 ' + new Date().toLocaleTimeString());
      return;
    }
    await saveMeta();
    renderChat();
    inject();
    updateUndoButton();
    status('已更新词条 · ' + new Date().toLocaleTimeString());
    toastr.success('已更新词条（可点「撤销上次更改」还原）');
    if (s.debug) toastr.info('调试：原文' + String(raw).length + '字');
  } catch (err) {
    if (my !== runSeq) return;
    console.error('[st-memory]', err);
    status('更新失败');
    toastr.error('更新词条失败：' + (err && err.message ? err.message : String(err)));
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
  if (d.lastExtractIndex > len) d.lastExtractIndex = len;
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
      <div class="stmem-row stmem-entry-actions">
        <div class="menu_button stmem-save">保存</div>
        <div class="menu_button stmem-del">删除</div>
        <div class="menu_button stmem-update">更新此词条</div>
      </div></div>`);
    el.find('.stmem-k').val((e.keywords || []).join(', '));
    el.find('.stmem-c').val(e.content);
    el.find('.stmem-save').on('click', async () => {
      e.keywords = el.find('.stmem-k').val().split(/[,，]/).map(x => x.trim()).filter(Boolean);
      e.content = el.find('.stmem-c').val();
      await saveMeta(); inject(); toastr.success('已保存');
    });
    el.find('.stmem-del').on('click', async () => {
      pushUndo(d, '删除词条');
      d.entries.splice(i, 1);
      await saveMeta(); renderChat(); inject(); updateUndoButton();
    });
    el.find('.stmem-update').on('click', () => updateOneEntry(i));
    box.append(el);
  });
}

function bindSettings() {
  const s = settings();
  migratePromptIfNeeded();
  const map = { enabled: 'stmem_enabled', auto: 'stmem_auto', keyword: 'stmem_kw', extract: 'stmem_extract', debug: 'stmem_debug', updateOld: 'stmem_update_old' };
  for (const [k, id] of Object.entries(map)) $('#' + id).prop('checked', s[k]).on('change', function () { s[k] = this.checked; saveSet(); inject(); });
  const nums = { interval: 'stmem_interval', depth: 'stmem_depth', scan: 'stmem_scan', kwDepth: 'stmem_kwdepth', position: 'stmem_position', extractWindow: 'stmem_extract_window' };
  for (const [k, id] of Object.entries(nums)) $('#' + id).val(s[k]).on('input change', function () { s[k] = Number(this.value); saveSet(); inject(); });
  $('#stmem_prompt').val(s.prompt).on('input', function () { s.prompt = this.value; saveSet(); });
  $('#stmem_extract_prompt').val(s.extractPrompt).on('input', function () { s.extractPrompt = this.value; saveSet(); });
  $('#stmem_reset_prompt').on('click', () => { s.prompt = DEFAULT_PROMPT; $('#stmem_prompt').val(s.prompt); saveSet(); });
  $('#stmem_reset_extract_prompt').on('click', () => { s.extractPrompt = DEFAULT_EXTRACT_PROMPT; $('#stmem_extract_prompt').val(s.extractPrompt); saveSet(); });
  $('#stmem_now').on('click', () => summarize(true, false));
  $('#stmem_extract_now').on('click', () => summarize(true, true));
  $('#stmem_undo, #stmem_undo2').on('click', () => undoLast());
  $('#stmem_save_summary').on('click', async () => { const d = meta(); if (!d) return; d.summary = $('#stmem_summary').val(); await saveMeta(); inject(); toastr.success('总结已保存'); });
  $('#stmem_clear_summary').on('click', async () => { const d = meta(); if (!d || !confirm('清空当前聊天的总结？')) return; d.summary = ''; d.lastIndex = 0; await saveMeta(); renderChat(); inject(); });
  $('#stmem_add_entry').on('click', async () => { const d = meta(); if (!d) return; d.entries.push({ id: nextEntryId(d.entries), keywords: [], content: '' }); await saveMeta(); renderChat(); });
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
  updateUndoButton();
}

function boot() {
  jQuery(async () => {
    const html = await $.get(FOLDER + 'settings.html');
    $('#extensions_settings2').append(html);
    bindSettings();
    const { eventSource, event_types } = ctx();
    eventSource.on(event_types.CHAT_CHANGED, () => { clearUndo(); renderChat(); inject(); });
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
    eventSource.on(event_types.GENERATION_STARTED, inject);
    eventSource.on(event_types.MESSAGE_DELETED, () => {
      const d = meta();
      const len = (ctx().chat || []).length;
      if (d && d.lastIndex > len) d.lastIndex = len;
      if (d && d.lastExtractIndex > len) d.lastExtractIndex = len;
    });
    renderChat(); inject();
  });
}

if (typeof jQuery === 'function') boot();

export {
  parseModelResponse, addNewEntries, applyUpdates, findEntry, isNearDuplicate, normalizeContent,
  firstJsonValue, unwrapGen, formatEntriesCompact, collectUpdates, parseUpdateItem, nextEntryId,
};
