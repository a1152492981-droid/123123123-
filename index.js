// 通用剧情记忆 - SillyTavern third-party extension (1.12+)
const MODULE = 'st_memory';
const META = 'st_memory';
const EXPORT_TYPE = 'st_memory';
const EXT_VERSION = '1.1.3';
const FOLDER = new URL('.', import.meta.url).href;

const DEFAULT_PROMPT = `[暂停角色扮演。你现在是剧情记录员。]
已有的长期记忆总结：
{{summary}}

最近的对话：
{{history}}

请完成两件事：
1. 用简洁的中文要点总结"最近的对话"中发生的重要剧情、关系变化、状态变化（不要重复已有总结）。
2. 提取新出现的设定、人物、地点、物品或关键事件，作为关键词记忆条目。

严格只输出如下 JSON，不要输出其他内容：
{"summary":"本段总结","entries":[{"keywords":["关键词1","关键词2"],"content":"条目内容"}]}`;

const DEFAULTS = {
  enabled: false, auto: false, keyword: true, extract: false,
  interval: 10, depth: 4, position: 1, scan: 4, kwDepth: 2,
  prompt: DEFAULT_PROMPT,
  extApi: false, extUrl: '', extKey: '', extModel: '',
  extMaxTokens: '', extTemp: '',
};

let busy = false;
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
  d.entries ||= []; d.summary ||= ''; d.lastIndex ||= 0;
  return d;
}
const saveMeta = () => ctx().saveMetadata();
const saveSet = () => ctx().saveSettingsDebounced();
const status = (t) => $('#stmem_status').text(t);

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

const CORS_HINT = '无法连接到总结 API（浏览器跨域 CORS 拦截或网络不通）。已测过：OpenRouter 允许网页直接请求；Google AI Studio 的 OpenAI 兼容接口也会返回 CORS 头。若仍被拦截，可在酒馆根目录 config.yaml 里设置 enableCorsProxy: true 后重启，本插件会优先走酒馆的 /proxy 转发。';

let stProxyState = null; // null=unknown, true=available, false=disabled/missing

function normalizeBaseUrl(input) {
  let u = String(input || '').trim();
  if (!u) throw new Error('请填写 API 地址');
  if (!/^https?:\/\//i.test(u)) throw new Error('API 地址需以 http:// 或 https:// 开头');
  u = u.replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/i, '');
  u = u.replace(/\/+$/, '');
  return u;
}

function chatCompletionsUrl(base) {
  return normalizeBaseUrl(base) + '/chat/completions';
}

function modelsUrl(base) {
  return normalizeBaseUrl(base) + '/models';
}

function stAuthHeaders() {
  try {
    const h = ctx().getRequestHeaders && ctx().getRequestHeaders();
    return h && typeof h === 'object' ? h : {};
  } catch (e) { return {}; }
}

function isProxyDisabledResponse(res, text) {
  return res && res.status === 404 && /CORS proxy is disabled/i.test(String(text || ''));
}

function isNetworkOrCorsError(err) {
  const n = err && (err.name || '');
  const m = err && (err.message || '');
  return n === 'TypeError' || /Failed to fetch|NetworkError|Load failed|Network request failed|CORS/i.test(m);
}

async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 180000);
  try {
    return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('请求超时');
    throw err;
  } finally { clearTimeout(t); }
}

async function extFetch(url, options) {
  if (stProxyState === false) return fetchWithTimeout(url, options);
  try {
    const headers = Object.assign({}, stAuthHeaders(), (options && options.headers) || {});
    const res = await fetchWithTimeout('/proxy/' + url, Object.assign({}, options, { headers }));
    if (stProxyState !== true && res.status === 404) {
      const text = await res.clone().text().catch(() => '');
      if (isProxyDisabledResponse(res, text) || /<!DOCTYPE|<html/i.test(text)) {
        stProxyState = false;
        return fetchWithTimeout(url, options);
      }
    }
    stProxyState = true;
    return res;
  } catch (err) {
    if (stProxyState == null && !/请求超时/.test(err && err.message || '')) {
      stProxyState = false;
      return fetchWithTimeout(url, options);
    }
    throw err;
  }
}

function optionalNumber(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function buildExtMessages(s, history, existingSummary) {
  const tpl = String(s.prompt || DEFAULT_PROMPT);
  const system = '你是剧情记录员，不是角色扮演者。不要续写故事或对白，不要输出状态栏。严格按下列说明只输出一个 JSON 对象。\n\n'
    + tpl.replace(/\{\{history\}\}/g, '（见用户消息中的「最近的对话」）').replace(/\{\{summary\}\}/g, '（见用户消息中的「已有总结」）');
  const user = '已有的长期记忆总结：\n' + (existingSummary || '（无）') + '\n\n最近的对话：\n' + (history || '（无）') + '\n\n请按系统说明完成总结与提取。';
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildExtBody(s, messages, extra) {
  if (!s.extModel) throw new Error('请填写模型名');
  const body = { model: s.extModel, messages, stream: false };
  const maxT = optionalNumber(s.extMaxTokens);
  if (maxT != null && maxT > 0) body.max_tokens = Math.round(maxT);
  const temp = optionalNumber(s.extTemp);
  if (temp != null) body.temperature = temp;
  if (extra && typeof extra === 'object') Object.assign(body, extra);
  return body;
}

function unwrapMessageContent(data) {
  const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => typeof p === 'string' ? p : ((p && (p.text || p.content)) || '')).join('');
  if (c && typeof c === 'object' && typeof c.text === 'string') return c.text;
  throw new Error('独立 API 返回中没有 choices[0].message.content');
}

async function readHttpError(res) {
  let msg = 'HTTP ' + res.status + (res.statusText ? ' ' + res.statusText : '');
  try {
    const t = await res.text();
    if (!t) return msg;
    try {
      const j = JSON.parse(t);
      const detail = (j.error && (j.error.message || j.error)) || j.message || j.detail || t;
      msg += '：' + String(detail).slice(0, 400);
    } catch (e) {
      msg += '：' + t.slice(0, 400);
    }
  } catch (e) { /* ignore */ }
  return msg;
}

async function extChatCompletions(s, messages, extra) {
  const url = chatCompletionsUrl(s.extUrl);
  if (!s.extKey) throw new Error('请填写 API Key');
  const body = buildExtBody(s, messages, extra);
  let res;
  try {
    res = await extFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.extKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (isNetworkOrCorsError(err)) throw new Error(CORS_HINT);
    throw err;
  }
  if (!res.ok) throw new Error(await readHttpError(res));
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('独立 API 返回的不是 JSON'); }
  return unwrapMessageContent(data);
}

async function generateSummaryText(filledPrompt, history, existingSummary) {
  const s = settings();
  if (!s.extApi) return quiet(filledPrompt);
  return extChatCompletions(s, buildExtMessages(s, history, existingSummary));
}

async function testExtConnection() {
  const s = settings();
  try {
    const text = await extChatCompletions(s, [
      { role: 'system', content: 'You are a connection test. Reply with the single word pong.' },
      { role: 'user', content: 'ping' },
    ], { max_tokens: 16 });
    const clip = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    toastr.success('独立 API 连接成功' + (clip ? '：' + clip : ''));
  } catch (err) {
    console.error('[st-memory]', err);
    toastr.error('测试连接失败：' + (err && err.message ? err.message : String(err)));
  }
}

async function fetchExtModels() {
  const s = settings();
  try {
    const url = modelsUrl(s.extUrl);
    let res;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (s.extKey) headers.Authorization = 'Bearer ' + s.extKey;
      res = await extFetch(url, { method: 'GET', headers });
    } catch (err) {
      if (isNetworkOrCorsError(err)) throw new Error(CORS_HINT);
      throw err;
    }
    if (!res.ok) throw new Error(await readHttpError(res));
    const data = await res.json();
    const list = Array.isArray(data && data.data) ? data.data : (Array.isArray(data) ? data : []);
    const ids = list.map(m => (typeof m === 'string' ? m : (m && m.id))).filter(Boolean);
    const box = $('#stmem_ext_models').empty();
    ids.forEach(id => box.append($('<option>').attr('value', id)));
    if (!ids.length) toastr.info('已请求模型列表，但没有解析到模型名。可手动填写。');
    else toastr.success('已获取 ' + ids.length + ' 个模型，可在「模型名」框中下拉或输入筛选');
  } catch (err) {
    console.error('[st-memory]', err);
    toastr.error('获取模型列表失败：' + (err && err.message ? err.message : String(err)));
  }
}

function toggleExtApiFields() {
  const on = !!settings().extApi;
  $('#stmem_ext_api_fields').toggleClass('stmem-hidden', !on);
}

async function quiet(prompt) {
  const fn = ctx().generateQuietPrompt;
  // 1.13+ uses an object param; 1.12 uses positional args
  const objStyle = /^\s*(async\s+)?(function\s*\w*\s*)?\(\s*\{/.test(fn.toString());
  return objStyle ? fn({ quietPrompt: prompt }) : fn(prompt, false, true);
}

function parseJSON(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* fallthrough */ } }
  return { summary: s.trim(), entries: [] };
}

async function summarize(force = false) {
  const s = settings(); const d = meta(); const c = ctx();
  if (!d || busy || !c.chat?.length) return;
  if (!force && (!s.enabled || !s.auto)) return;
  const chat = c.chat;
  const start = Math.min(d.lastIndex, chat.length);
  const msgs = chat.slice(start).filter(m => !m.is_system && m.mes);
  if (!msgs.length) { if (force) toastr.info('没有新的消息需要总结'); return; }
  busy = true; status('总结中…');
  try {
    const history = msgs.map(m => `${m.name}: ${m.mes}`).join('\n');
    const prompt = s.prompt.replace(/\{\{history\}\}/g, history).replace(/\{\{summary\}\}/g, d.summary || '（无）');
    const res = parseJSON(await generateSummaryText(prompt, history, d.summary || '（无）'));
    if (res.summary) d.summary = (d.summary ? d.summary + '\n' : '') + String(res.summary).trim();
    if (s.extract && Array.isArray(res.entries)) {
      for (const e of res.entries) {
        const kws = (Array.isArray(e.keywords) ? e.keywords : String(e.keywords || '').split(/[,，]/)).map(k => String(k).trim()).filter(Boolean);
        if (!kws.length || !e.content) continue;
        const ex = d.entries.find(x => x.keywords.some(k => kws.includes(k)));
        if (ex) { ex.content = String(e.content); ex.keywords = [...new Set([...ex.keywords, ...kws])]; }
        else d.entries.push({ keywords: kws, content: String(e.content) });
      }
    }
    d.lastIndex = chat.length;
    await saveMeta();
    renderChat(); inject();
    status('已总结 ' + new Date().toLocaleTimeString());
  } catch (err) {
    console.error('[st-memory]', err); status('总结失败'); toastr.error('剧情总结失败：' + err.message);
  } finally { busy = false; }
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
  const len = ctx().chat.length;
  if (d.lastIndex > len) d.lastIndex = len; // messages deleted
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
  const map = { enabled: 'stmem_enabled', auto: 'stmem_auto', keyword: 'stmem_kw', extract: 'stmem_extract' };
  for (const [k, id] of Object.entries(map)) $('#' + id).prop('checked', s[k]).on('change', function () { s[k] = this.checked; saveSet(); inject(); });
  const nums = { interval: 'stmem_interval', depth: 'stmem_depth', scan: 'stmem_scan', kwDepth: 'stmem_kwdepth', position: 'stmem_position' };
  for (const [k, id] of Object.entries(nums)) $('#' + id).val(s[k]).on('input change', function () { s[k] = Number(this.value); saveSet(); inject(); });
  $('#stmem_prompt').val(s.prompt).on('input', function () { s.prompt = this.value; saveSet(); });
  $('#stmem_reset_prompt').on('click', () => { s.prompt = DEFAULT_PROMPT; $('#stmem_prompt').val(s.prompt); saveSet(); });
  $('#stmem_ext_api').prop('checked', !!s.extApi).on('change', function () { s.extApi = this.checked; saveSet(); toggleExtApiFields(); });
  $('#stmem_ext_url').val(s.extUrl || '').on('input', function () { s.extUrl = this.value; saveSet(); });
  $('#stmem_ext_key').val(s.extKey || '').on('input', function () { s.extKey = this.value; saveSet(); });
  $('#stmem_ext_model').val(s.extModel || '').on('input', function () { s.extModel = this.value; saveSet(); });
  $('#stmem_ext_max_tokens').val(s.extMaxTokens || '').on('input', function () { s.extMaxTokens = this.value; saveSet(); });
  $('#stmem_ext_temp').val(s.extTemp || '').on('input', function () { s.extTemp = this.value; saveSet(); });
  $('#stmem_ext_test').on('click', () => testExtConnection());
  $('#stmem_ext_models_btn').on('click', () => fetchExtModels());
  toggleExtApiFields();
  $('#stmem_now').on('click', () => summarize(true));
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

jQuery(async () => {
  const html = await $.get(FOLDER + 'settings.html');
  $('#extensions_settings2').append(html);
  bindSettings();
  const { eventSource, event_types } = ctx();
  eventSource.on(event_types.CHAT_CHANGED, () => { renderChat(); inject(); });
  eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
  eventSource.on(event_types.GENERATION_STARTED, inject);
  eventSource.on(event_types.MESSAGE_DELETED, () => { const d = meta(); if (d && d.lastIndex > ctx().chat.length) d.lastIndex = ctx().chat.length; });
  renderChat(); inject();
});
