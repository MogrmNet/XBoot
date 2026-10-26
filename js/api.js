// Frontend client for the GARHI Worker API. Never contains secrets; the optional access code is user-entered.
export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const base = u => String(u || '').trim().replace(/\/+$/, '');

export async function checkHealth(apiUrl) {
  if (!base(apiUrl)) return { state: 'unconfigured' };
  try {
    const r = await fetch(base(apiUrl) + '/api/health', { cache: 'no-store' });
    if (!r.ok) return { state: 'down' };
    const j = await r.json();
    return { state: j.aiConfigured ? 'ready' : 'nokey', tokenRequired: !!j.tokenRequired, model: j.model };
  } catch { return { state: 'down' }; }
}

export async function streamChat({ apiUrl, token, messages, mode, clientPassages, signal, onMeta, onDelta }) {
  if (!base(apiUrl)) throw new ApiError('NOT_CONFIGURED', 'الذكاء الاصطناعي غير مُعد: لم يتم ضبط رابط الخادم. افتح الإعدادات وأضف رابط الـAPI (راجع README).');
  let res;
  try {
    res = await fetch(base(apiUrl) + '/api/chat', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-garhi-token': token } : {}) },
      body: JSON.stringify({ messages, mode, clientPassages }),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', 'تعذر الاتصال بخادم الذكاء الاصطناعي. تأكد من الإنترنت ومن رابط الخادم في الإعدادات، ثم أعد المحاولة.');
  }
  if (!res.ok) {
    let j = null; try { j = await res.json(); } catch { /* not json */ }
    throw new ApiError(j?.code || 'HTTP_' + res.status, j?.message || `الخادم رجّع خطأ (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', got = false;
  for (;;) {
    let chunk;
    try { chunk = await reader.read(); } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new ApiError('STREAM', 'انقطع الاتصال أثناء استلام الإجابة.');
    }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const d = /^data: (.+)$/m.exec(block)?.[1];
      if (!ev || !d) continue;
      let data; try { data = JSON.parse(d); } catch { continue; }
      if (ev === 'meta') onMeta?.(data);
      else if (ev === 'delta') { got = true; onDelta?.(data.text); }
      else if (ev === 'error') throw new ApiError(data.code || 'AI_UPSTREAM', data.message || 'حصل خطأ أثناء توليد الإجابة.');
    }
  }
  return { got };
}
