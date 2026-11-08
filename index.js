// 通用剧情记忆 - SillyTavern third-party extension (1.12+)
const MODULE = 'st_memory';
const META = 'st_memory';
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
  enabled: true, auto: true, keyword: true, extract: true,
  interval: 10, depth: 4, position: 1, scan: 4, kwDepth: 2,
  prompt: DEFAULT_PROMPT,
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
  const chat = c.chat;
  const start = Math.min(d.lastIndex, chat.length);
  const msgs = chat.slice(start).filter(m => !m.is_system && m.mes);
  if (!msgs.length) { if (force) toastr.info('没有新的消息需要总结'); return; }
  busy = true; status('总结中…');
  try {
    const history = msgs.map(m => `${m.name}: ${m.mes}`).join('\n');
    const prompt = s.prompt.replace(/\{\{history\}\}/g, history).replace(/\{\{summary\}\}/g, d.summary || '（无）');
    const res = parseJSON(await quiet(prompt));
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
  $('#stmem_now').on('click', () => summarize(true));
  $('#stmem_save_summary').on('click', async () => { const d = meta(); if (!d) return; d.summary = $('#stmem_summary').val(); await saveMeta(); inject(); toastr.success('总结已保存'); });
  $('#stmem_clear_summary').on('click', async () => { const d = meta(); if (!d || !confirm('清空当前聊天的总结？')) return; d.summary = ''; d.lastIndex = 0; await saveMeta(); renderChat(); inject(); });
  $('#stmem_add_entry').on('click', async () => { const d = meta(); if (!d) return; d.entries.push({ keywords: [], content: '' }); await saveMeta(); renderChat(); });
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
