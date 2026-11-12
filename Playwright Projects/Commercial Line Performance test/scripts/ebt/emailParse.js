// scripts/ebt/emailParse.js — read a business EBT feedback email the user uploads in the Runner.
//
// Accepts an Outlook .msg (drag the email out of Outlook / File > Save As) or an .eml. Returns the sender, sent
// time, subject, plain-text body and every image attached to it (Outlook stores pasted screenshots as hidden inline
// attachments, so those come back too). No extra npm packages: .msg is an OLE compound file, read with the CFB
// reader the xlsx package already ships; .eml is parsed by the small MIME reader below.
'use strict';

const CFB = require('xlsx').CFB;

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp' };
const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

// Collapse Outlook's spacing (blank line after every paragraph, trailing spaces, non-breaking spaces).
function tidyBody(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── .msg ────────────────────────────────────────────────────────────────────
function parseMsg(buf) {
  const cfb = CFB.read(buf, { type: 'buffer' });
  const streams = {};
  cfb.FullPaths.forEach((p, i) => {
    const e = cfb.FileIndex[i];
    if (e && e.type === 2 && e.content) streams[p.replace(/^[^/]*\//, '')] = Buffer.from(e.content);
  });
  const prop = (prefix, id) => {
    const u = streams[`${prefix}__substg1.0_${id}001F`];
    if (u) return u.toString('utf16le').replace(/\0+$/, '');
    const a = streams[`${prefix}__substg1.0_${id}001E`];
    return a ? a.toString('latin1').replace(/\0+$/, '') : '';
  };
  const bin = (prefix, id) => streams[`${prefix}__substg1.0_${id}0102`] || null;

  // Sent time: PR_CLIENT_SUBMIT_TIME (0x0039) in the top-level fixed-length property stream (32-byte header,
  // 16-byte entries: type, id, flags, 8-byte FILETIME).
  let sent = null;
  const ps = streams['__properties_version1.0'];
  if (ps) {
    for (let o = 32; o + 16 <= ps.length; o += 16) {
      const type = ps.readUInt16LE(o), id = ps.readUInt16LE(o + 2);
      if (type === 0x0040 && (id === 0x0039 || (id === 0x0E06 && !sent))) {
        const ft = ps.readBigUInt64LE(o + 8);
        if (ft > 0n) sent = new Date(Number(ft / 10000n) - 11644473600000);
      }
    }
  }

  const headers = prop('', '007D');
  const smtp = [prop('', '5D01'), prop('', '5D02'), prop('', '0C1F'), prop('', '0065')].find((s) => /@/.test(s)) ||
    ((headers.match(/^From:.*<([^>]+@[^>]+)>/mi) || [])[1] || '');
  let body = prop('', '1000');
  if (!body) { const h = bin('', '1013'); if (h) body = htmlToText(h.toString('utf8')); }

  const images = [];
  const attachDirs = [...new Set(Object.keys(streams).map((k) => (k.match(/^(__attach_version1\.0_#[0-9A-F]{8}\/)/) || [])[1]).filter(Boolean))];
  attachDirs.forEach((dir) => {
    const data = bin(dir, '3701');
    if (!data) return;
    const name = prop(dir, '3707') || prop(dir, '3704') || 'attachment';
    let mime = (prop(dir, '370E') || '').toLowerCase();
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!IMAGE_EXT[mime]) mime = EXT_MIME[ext] || mime;
    images.push({ filename: name, contentType: mime, contentId: prop(dir, '3712'), data, isImage: Boolean(IMAGE_EXT[mime]) });
  });

  return {
    subject: prop('', '0037'),
    fromName: prop('', '0C1A') || prop('', '0042'),
    fromEmail: smtp,
    to: prop('', '0E04'),
    sent,
    messageId: prop('', '1035'),
    body: tidyBody(body),
    html: (bin('', '1013') || Buffer.alloc(0)).toString('utf8') || prop('', '1013'), // PR_HTML (binary or string) — empty for RTF-only messages
    attachments: images,
  };
}

// ── .eml ────────────────────────────────────────────────────────────────────
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    const b = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64')
      : Buffer.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    return decodeCharset(b, cs);
  }).replace(/\?=\s+=\?/g, '');
}
function decodeCharset(b, cs) {
  try { return new TextDecoder(String(cs || 'utf-8').toLowerCase().replace(/^us-ascii$/, 'utf-8')).decode(b); } catch { return b.toString('latin1'); }
}
function splitHeaders(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i);
  const rest = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const h = {};
  head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) { const k = m[1].toLowerCase(); if (!(k in h)) h[k] = m[2]; }
  });
  return { h, rest };
}
function param(v, name) { const m = String(v || '').match(new RegExp(`${name}\\*?=\\s*"?([^";]+)"?`, 'i')); return m ? decodeWords(m[1].replace(/^utf-8''/i, '')) : ''; }
function bodyBytes(raw, enc) {
  enc = String(enc || '').toLowerCase();
  if (enc === 'base64') return Buffer.from(raw.replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') return Buffer.from(raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, x) => String.fromCharCode(parseInt(x, 16))), 'latin1');
  return Buffer.from(raw, 'latin1');
}
function walkMime(raw, out) {
  const { h, rest } = splitHeaders(raw);
  const ct = h['content-type'] || 'text/plain';
  const type = ct.split(';')[0].trim().toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = param(ct, 'boundary');
    if (!boundary) return;
    rest.split(`--${boundary}`).slice(1).forEach((part) => { if (!/^--/.test(part)) walkMime(part.replace(/^\r?\n/, ''), out); });
    return;
  }
  const data = bodyBytes(rest, h['content-transfer-encoding']);
  const disp = h['content-disposition'] || '';
  const filename = param(disp, 'filename') || param(ct, 'name');
  if (type === 'text/plain' && !filename && !out.text) out.text = decodeCharset(data, param(ct, 'charset'));
  else if (type === 'text/html' && !filename && !out.html) out.html = decodeCharset(data, param(ct, 'charset'));
  else if (type !== 'message/rfc822') {
    out.attachments.push({ filename: filename || `image.${IMAGE_EXT[type] || 'bin'}`, contentType: type, contentId: (h['content-id'] || '').replace(/[<>]/g, ''), data, isImage: Boolean(IMAGE_EXT[type]) });
  }
}
function parseEml(buf) {
  const raw = buf.toString('latin1');
  const { h } = splitHeaders(raw);
  const out = { text: '', html: '', attachments: [] };
  walkMime(raw, out);
  const from = decodeWords(h.from || '');
  const fm = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return {
    subject: decodeWords(h.subject || ''),
    fromName: fm ? fm[1].trim() : from.replace(/<.*>/, '').trim(),
    fromEmail: fm ? fm[2].trim() : (from.match(/[\w.+-]+@[\w.-]+/) || [''])[0],
    to: decodeWords(h.to || ''),
    sent: h.date ? new Date(h.date) : null,
    messageId: (h['message-id'] || '').trim(),
    body: tidyBody(out.text || htmlToText(out.html)),
    html: out.html || '',
    attachments: out.attachments,
  };
}

// buf: file bytes; name: original file name (decides the format; falls back to sniffing the OLE signature).
function parseEmail(buf, name) {
  const isOle = buf.length > 8 && buf.readUInt32LE(0) === 0xE011CFD0;
  const msg = isOle || /\.msg$/i.test(name || '') ? parseMsg(buf) : parseEml(buf);
  if (msg.sent && isNaN(msg.sent)) msg.sent = null;
  // Give every image a unique, Jira-safe file name (several Outlook screenshots are all "image001.png" otherwise).
  const used = new Set();
  msg.attachments.forEach((a, i) => {
    let base = String(a.filename || `attachment-${i + 1}`).replace(/[^\w.-]+/g, '_');
    let n = base, k = 2;
    while (used.has(n.toLowerCase())) n = base.replace(/(\.\w+)?$/, `-${k++}$1`);
    used.add(n.toLowerCase());
    a.filename = n;
  });
  return msg;
}

// "RE: FW: EBT - Foo" -> "Foo"; leaves the business's own wording otherwise untouched.
function cleanSubject(s) {
  return String(s || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').replace(/^\s*\[?external\]?\s*:?\s*/i, '').replace(/\s+/g, ' ').trim();
}

module.exports = { parseEmail, cleanSubject, htmlToText };
