// scripts/jiraStatusOnePage.js — the one-page QA status slide for senior management (2026-11-11), in the same
// look as the weekly EBT slide: hours-outstanding tiles on top, then one column per area (ClaimCenter | SMARTCOMM |
// OneInc) with what was completed this sprint and the remaining work, blocked items worded in business language.
//
// Hours = Jira remaining estimates, EXCLUDING regression, performance and automation cards and deferred work
// (the QA lead's rule: the page shows the functional testing left).
// Status wording next to an item, first one that exists:
//   1. the QA leads' status emails dropped on the Jira tab (statusNotes.emails): the CC/CM daily status table
//      (by Jira key) and the OneInc update's "Area – status" lines (matched to the Jira card by name)
//   2. only when no dropped email covers Jira keys: the newest "Daily status" email in this PC's Outlook inbox
//   3. the open defects linked to the card (blocked / in-progress items)
// Everything is reworded by fixed local rules (businessNote) — no AI service, nothing leaves this PC.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const PptxGenJS = require('pptxgenjs');
const { parseStatusEmail } = require('./statusNotes');

const N = '1F2A44', B = '2E5597', L = 'D9E2F3', A = 'E8A317', G = '4CAF50', T = '2A8C8C', D = '404040', GR = 'BFBFBF', RED = 'B03A2E', F = 'Calibri';
const AREAS = [['ClaimCenter', 'ClaimCenter', B], ['SmartComm', 'SMARTCOMM', T], ['OneInc', 'OneInc', G]];

const isImpeded = (i) => /impeded|blocked/i.test(i.status);
const inProg = (i) => /in progress|in review/i.test(i.status);
const readyQa = (i) => /ready for qa/i.test(i.status);
const isDesign = (s) => /test[ _-]*(design|planning)|qa[ _-]*prep/i.test(s);
const excluded = (i) => /regression|performance|automation/i.test(`${i.summary} ${i.parent || ''}`) || /deferred|retired/i.test(i.status);
const hrs = (n) => `${Math.round(n)} h`;
const sum = (a) => a.reduce((x, i) => x + (i.rem || 0), 0);
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// "Test Execution - Integration - WSAP Integration" -> "WSAP Integration"; "CC_Test Execution_OneInc_QuickCheck" -> "QuickCheck".
function nice(s) {
  return String(s)
    .replace(/^CC_Test[ _](Execution|Design)_(OneInc_)?/i, '')
    .replace(/^Test[ _-]*(execution|design)\s*-\s*(Integration|Feature|Common)\s*-\s*/i, '')
    .replace(/^Test[ _-]*(execution|design)\s*-\s*/i, '')
    .replace(/[_ -]*(Test[_ ]?(Execution|Exec|Design|Planning)|QA[_ ]?(Exec|Prep))\b.*$/i, '')
    .replace(/^(QA|IR)[_ -]+/i, '').replace(/^SmartCOMM[_ ]/i, '')
    .replace(/\s*-?\s*Part\s*-?\s*0?\d+$/i, '').replace(/^Claim ?Center\s*-\s*/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2') // AppliedClaimDownloadAPI -> Applied Claim Download API
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
// SmartCOMM templates: a DIG letter / letterhead is a ClaimCenter template; a story under the BillingCenter epic
// that isn't feature work is a BillingCenter template (same rule as jiraStatusDeck.js).
function templateOf(i) {
  const t = i.summary;
  if (/^DIG\s*-?\s*\d+/i.test(t) || /letterhead/i.test(t)) return 'CC';
  if (/billing\s*center/i.test(i.parent || '') && !/^(BC|QA|IR)[_ -]|smartcomm/i.test(t)) return 'BC';
  return null;
}

// ── blocker comments ────────────────────────────────────────────────────────────────────────────────────
function outlookNotes() {
  if (process.platform !== 'win32' || /^(0|false|off)$/i.test(process.env.STATUS_EMAIL_FROM_OUTLOOK || '')) return null;
  const tmp = path.join(os.tmpdir(), `status-email-${Date.now()}.json`);
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'statusEmailFromOutlook.ps1'),
      '-From', process.env.STATUS_EMAIL_SENDER || 'Vimal', '-Subject', process.env.STATUS_EMAIL_SUBJECT || 'Daily status', '-OutJson', tmp], { stdio: 'pipe', timeout: 60000 });
    const m = JSON.parse(fs.readFileSync(tmp, 'utf8').replace(/^﻿/, '') || '{}');
    if (!m.html) return null;
    return { from: 'Outlook', received: m.received, subject: m.subject, ...parseStatusEmail({ html: m.html }) };
  } catch (e) { console.warn(`Status email not read from Outlook: ${String(e.message).split('\n')[0]}`); return null; } finally { fs.rmSync(tmp, { force: true }); }
}

// A QA comment in management language: no Jira keys, no tester shorthand. Known phrasings map to fixed wording;
// anything else falls back to its first sentence.
const EXPECTED_RE = /(?:should|scheduled to|expected to|will)\s+(?:be\s+)?(?:completed?|closed?)\s+by\s+(\d{1,2}\/\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2})/i;
function businessNote(note, { noDate = false } = {}) {
  const t = String(note || '').replace(/\s*\(?\b[A-Z][A-Z0-9]+-\d+\b\)?,?/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const parts = [];
  let m;
  if ((m = t.match(/(\d{1,3})\s*%\s*(?:of\s+)?testing\s+completed?/i))) parts.push(`${m[1]}% tested`);
  if ((m = t.match(/\b(\d+)\s+open\s+(?:defects?|bugs?)/i))) parts.push(`${m[1]} open defect${m[1] === '1' ? '' : 's'}`);
  if (/in fixed status|if fixes are deployed|once fix(es)? (is|are) deployed/i.test(t)) parts.push('fixes awaiting deployment');
  if (!noDate && (m = t.match(EXPECTED_RE))) parts.push(`expected complete ${m[1]}`);
  if (noDate && !parts.length && EXPECTED_RE.test(t)) return '';
  if ((m = t.match(/dev(?:elopment)?\s+completion:?\s*([A-Za-z]{3,9}\.?\s+\d{1,2})/i))) parts.push(`waiting on development, expected ${m[1]}`);
  if (/majority of testing is completed|testing (is )?(mostly|largely|almost) complete/i.test(t)) parts.push('most testing complete');
  if ((m = t.match(/awaiting (?:updates?|clarifications?|inputs?|confirmation|requirements?) from (BAs?|business|vendor|dev\w*)\s*-?\s*(\d+)?/i))) {
    const who = /^BA/i.test(m[1]) ? 'business analyst' : /^dev/i.test(m[1]) ? 'development' : m[1].toLowerCase();
    parts.push(`awaiting ${who} input${m[2] ? ` on ${m[2]} remaining item(s)` : ''}`);
  }
  if (/awaiting vendor/i.test(t) && !parts.some((p) => /vendor/.test(p))) parts.push('waiting on the vendor');
  if (/awaiting code deployment|awaiting deployment|pending deployment/i.test(t)) parts.push('waiting on a code deployment');
  if (/mainframe validation is pending/i.test(t)) parts.push('ClaimCenter side verified, mainframe-side check pending');
  if (/(file|extract)[^.]*\bnot (been )?(created|generated)/i.test(t)) parts.push('one extract file is not being produced yet (fix in progress)');
  if (!parts.length) {
    const first = t.split(/(?<=[.;:])\s|\n/)[0].replace(/[.;:]$/, '').replace(/\bBAs?\b/g, 'business analysts').replace(/\bdev\b/gi, 'development');
    parts.push(first.length > 95 ? `${first.slice(0, 92).replace(/\s+\S*$/, '')}…` : first);
  }
  const s = parts.join('; ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── the slide ───────────────────────────────────────────────────────────────────────────────────────────
function buildOnePage({ items, doneItems, scAll = [], bugs = [], emails = [] }) {
  const NOW = new Date();
  const sprints = items.flatMap((i) => i.sprints);
  const active = sprints.filter((s) => s.state === 'active' && s.end).sort((a, b) => new Date(a.end) - new Date(b.end))[0];
  if (!active) throw new Error('No active sprint found on any item — nothing to report for the current sprint.');
  const sNo = (String(active.name).match(/sprint\s*(\d+)/i) || [])[1];
  const S = sNo ? `Sprint ${sNo}` : 'Current sprint';
  // "This week" = since Monday 00:00 on the PC building the deck.
  const weekStart = new Date(NOW); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const bugByKey = new Map(bugs.map((b) => [b.key, b]));
  const today = NOW.toLocaleDateString('en-CA');
  // Emails oldest first, so the newest note for a card wins.
  const byKey = {}; const named = new Map();
  for (const e of emails) {
    Object.assign(byKey, e.byKey || {});
    for (const n of e.named || []) named.set(n.name.toLowerCase(), n);
  }
  // "Common UI Part 1 & 2" belongs to the card whose name contains every one of its words.
  const words = (t) => new Set(nice(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').map((w) => w.replace(/s$/, ''))
    .filter((w) => w && !/^(part|update|make|the|and|in|of|to|for|\d+)$/.test(w)));
  const namedNotes = [...named.values()].map((n) => ({ ...n, w: [...words(n.name)] })).filter((n) => n.w.length);
  const rawNote = (i) => {
    if (byKey[i.key] && byKey[i.key].note) return byKey[i.key].note;
    const iw = words(i.summary);
    const hit = namedNotes.filter((n) => n.w.every((w) => iw.has(w))).sort((a, b) => b.w.length - a.w.length)[0];
    return hit ? hit.note : '';
  };
  const reason = (i) => {
    const n = businessNote(rawNote(i));
    if (n) return n;
    const bs = (i.openBugs || []).map((k) => bugByKey.get(k)).filter(Boolean);
    if (!bs.length || !(isImpeded(i) || inProg(i))) return isImpeded(i) ? 'Waiting on a dependency' : '';
    const dues = bs.map((b) => b.due).filter(Boolean).sort();
    const when = !dues.length ? 'no fix date yet' : dues[0] < today ? 'fix overdue' : `fix due ${fmtDate(new Date(`${dues[dues.length - 1]}T12:00:00`))}`;
    return isImpeded(i) ? `Waiting on ${bs.length} defect fix${bs.length > 1 ? 'es' : ''} (${when})` : `${bs.length} open defect${bs.length > 1 ? 's' : ''} (${when})`;
  };

  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const s = pptx.addSlide(); s.background = { color: 'F2F2F2' };
  s.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.8, fill: { color: N } });
  s.addText('QA Status Summary - ClaimCenter', { x: 0.4, y: 0.1, w: 8.5, h: 0.6, fontFace: F, fontSize: 24, bold: true, color: 'FFFFFF', isTextBox: true });
  s.addText(`${S} (ends ${fmtDate(new Date(active.end))})  |  ${NOW.toLocaleDateString('en-US')}`, { x: 8.3, y: 0.15, w: 4.7, h: 0.5, fontFace: F, fontSize: 12, color: L, align: 'right', isTextBox: true });

  const data = AREAS.map(([key, label, color]) => {
    const open = items.filter((i) => i.area === key && !excluded(i));
    const done = doneItems.filter((i) => i.area === key && !excluded(i) && i.resolved && new Date(i.resolved) >= weekStart);
    return { key, label, color, open, done, blocked: open.filter(isImpeded) };
  });
  const allOpen = data.flatMap((a) => a.open);

  // tiles
  const tiles = [...data.map((a) => [hrs(sum(a.open)), `${a.label} hours left`, a.color]), [hrs(sum(allOpen)), 'Total hours left', N]];
  tiles.forEach(([n, l, c], i) => {
    const w = 3.02, x = 0.4 + i * (w + 0.15), y = 0.98;
    s.addShape('roundRect', { x, y, w, h: 0.95, fill: { color: 'FFFFFF' }, line: { color: GR, width: 0.75 }, rectRadius: 0.08 });
    s.addShape('rect', { x, y: y + 0.12, w: 0.08, h: 0.71, fill: { color: c } });
    s.addText(n, { x: x + 0.2, y: y + 0.04, w: w - 0.3, h: 0.55, fontFace: F, fontSize: 24, bold: true, color: c, isTextBox: true, margin: 0, wrap: false });
    s.addText(l, { x: x + 0.2, y: y + 0.6, w: w - 0.3, h: 0.28, fontFace: F, fontSize: 10.5, color: D, isTextBox: true, margin: 0 });
  });

  // One entry per piece of work: a design + execution pair (or Part 1 / Part 2) of the same thing is one line.
  const merged = (list) => {
    const m = new Map();
    for (const i of list) { const k = nice(i.summary); const e = m.get(k) || { name: k, rem: 0, items: [] }; e.rem += i.rem; e.items.push(i); m.set(k, e); }
    return [...m.values()].sort((a, b) => b.rem - a.rem);
  };
  const names = (list, max) => { const n = merged(list).map((e) => e.name); return n.length > max ? `${n.slice(0, max).join(', ')} (+${n.length - max} more)` : n.join(', '); };
  const tplCount = (list, sys) => new Set(list.filter((i) => templateOf(i) === sys).map((i) => nice(i.summary))).size;
  const tplLines = (list, text) => [['CC', 'ClaimCenter letter'], ['BC', 'billing']].map(([sys, lbl]) => [tplCount(list, sys), lbl]).filter(([n]) => n).map(([n, lbl]) => text(n, lbl));

  const completedLines = (a) => {
    const exec = a.done.filter((i) => !isDesign(i.summary)); const des = a.done.filter((i) => isDesign(i.summary));
    const out = [];
    if (a.key === 'SmartComm') {
      const t = (list) => tplLines(list, (n, lbl) => `${n} ${lbl} template${n > 1 ? 's' : ''}`).join(', ');
      if (t(exec)) out.push(`Tested: ${t(exec)}`);
      const other = exec.filter((i) => !templateOf(i)); if (other.length) out.push(`Features tested: ${names(other, 6)}`);
      if (t(des)) out.push(`Test design finished: ${t(des)}`);
      // Overall template progress (all sprints): a template is tested once every execution card for it is done.
      const live = scAll.filter((i) => !/retired|deferred/i.test(i.status) && !/sub-?task/i.test(i.type) && !/[_ ]enhancement$/i.test(i.summary) && !isDesign(i.summary));
      const prog = [['CC', 'ClaimCenter'], ['BC', 'Billing']].map(([sys, lbl]) => {
        const byT = new Map(); for (const i of live) if (templateOf(i) === sys) { const k = nice(i.summary); byT.set(k, (byT.get(k) ?? true) && /^(done|closed)$/i.test(i.status)); }
        return byT.size ? `${lbl} ${[...byT.values()].filter(Boolean).length} of ${byT.size}` : '';
      }).filter(Boolean);
      if (prog.length) out.push(`Overall templates tested: ${prog.join(', ')}`);
    } else {
      if (exec.length) out.push(`Testing finished: ${names(exec, 7)}`);
      if (des.length) out.push(`Test design finished for ${merged(des).length} area${merged(des).length > 1 ? 's' : ''}${exec.length ? '' : `: ${names(des, 6)}`}`);
    }
    return out.length ? out : ['Nothing closed yet this week'];
  };
  // When an item is expected to finish: the date in its status email line, else its Jira due date.
  const targetOf = (i) => {
    const m = rawNote(i).match(EXPECTED_RE);
    const d = m ? new Date(/\//.test(m[1]) ? `${m[1]}/${NOW.getFullYear()}` : `${m[1]} ${NOW.getFullYear()}`) : i.due ? new Date(`${i.due}T12:00:00`) : null;
    return d && !isNaN(d) ? d : null;
  };
  // OneInc (QA lead, 2026-11-11): remaining work by when it completes — this week, next week, later — instead of
  // by Jira status; blocked items stay red and say so.
  const byTargetWeek = (a) => {
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const nextEnd = new Date(weekEnd); nextEnd.setDate(nextEnd.getDate() + 7);
    const groups = [['Completing this week', []], ['Due next week', []], ['Later', []], ['No target date yet', []]];
    for (const e of merged(a.open)) {
      const dates = e.items.map(targetOf).filter(Boolean).sort((x, y) => y - x);
      e.target = dates[0] || null;
      groups[!e.target ? 3 : e.target < weekEnd ? 0 : e.target < nextEnd ? 1 : 2][1].push(e);
    }
    return groups.filter(([, list]) => list.length).map(([label, list]) => {
      const last = list.map((e) => e.target).filter(Boolean).sort((x, y) => y - x)[0];
      return { label: `${label}${last ? ` – by ${fmtDate(last)}` : ''} (${list.length})`, color: N, lines: list.map((e) => {
        const blocked = e.items.some(isImpeded);
        const src = e.items.find((i) => rawNote(i)) || e.items[0];
        const note = businessNote(rawNote(src), { noDate: true }) || (blocked || e.items.some(inProg) ? reason(src) : '');
        const state = blocked ? 'Blocked' : e.items.some(inProg) ? '' : e.items.some(readyQa) ? 'Ready to test' : 'Not started';
        return { t: `${e.name}${e.rem >= 0.5 ? ` (${hrs(e.rem)})` : ''} – ${[state, note && state ? note.charAt(0).toLowerCase() + note.slice(1) : note].filter(Boolean).join('; ') || 'In progress'}`, color: blocked ? RED : D };
      }) };
    });
  };
  const remainingGroups = (a) => {
    if (a.key === 'OneInc') return byTargetWeek(a);
    const bucket = (i) => (isImpeded(i) ? 'blocked' : inProg(i) ? 'inprog' : readyQa(i) ? 'ready' : 'todo');
    const by = (g) => a.open.filter((i) => bucket(i) === g);
    const line = (e, withReason) => { const r = withReason ? reason(e.items.find((i) => reason(i)) || e.items[0]) : businessNote(rawNote(e.items.find((i) => rawNote(i)) || e.items[0])); return `${e.name}${e.rem >= 0.5 ? ` (${hrs(e.rem)})` : ''}${r ? ` – ${r}` : ''}`; };
    const lines = (g, withReason, max = 99) => {
      const list = by(g); const out = [];
      if (a.key === 'SmartComm') {
        const tp = list.filter((i) => templateOf(i));
        out.push(...tplLines(tp, (n, lbl) => `${n} ${lbl} template${n > 1 ? 's' : ''}`).map((t, k) => {
          if (!withReason || k) return t;
          const bs = [...new Set(tp.flatMap((i) => i.openBugs || []))].length;
          return `${t}${bs ? ` – waiting on ${bs} defect fix${bs > 1 ? 'es' : ''}` : ''}`;
        }));
      }
      const rest = merged(a.key === 'SmartComm' ? list.filter((i) => !templateOf(i)) : list);
      // Blocked and in-progress items carry the QA lead's comment; long quiet lists collapse to names.
      if (withReason || rest.length <= max || rest.some((e) => e.items.some((i) => rawNote(i)))) out.push(...rest.map((e) => line(e, withReason || g === 'inprog')));
      else out.push(`${rest.slice(0, max).map((e) => e.name).join(', ')} (+${rest.length - max} more)`);
      return out;
    };
    return [['In progress', lines('inprog', false), N], ['Blocked', lines('blocked', true), RED], ['Ready to test', lines('ready', false, 4), N], ['Not started', lines('todo', false, 4), N]]
      .filter(([, l]) => l.length).map(([label, l, color]) => ({ label: `${label} (${by({ 'In progress': 'inprog', Blocked: 'blocked', 'Ready to test': 'ready', 'Not started': 'todo' }[label]).length})`, lines: l, color }));
  };

  // columns
  const top = 2.13, H = 4.87, W = 4.05, GAP = 0.19;
  const cols = data.map((a) => {
    const done = completedLines(a); const groups = remainingGroups(a);
    const paras = [{ head: `Completed this week (${a.done.length})`, color: G }, ...done.map((t) => ({ t })),
      { head: `Remaining work (${a.open.length} items, ${hrs(sum(a.open))})`, color: a.color === G ? N : a.color },
      ...groups.flatMap((g) => [{ sub: g.label, color: g.color }, ...g.lines.map((t) => (typeof t === 'string' ? { t, color: g.color === RED ? RED : D } : t))])];
    // Largest font (10.5 → 7.5 pt) whose estimated wrapped height fits the column.
    const fits = (fs) => {
      const cpl = ((W - 0.45) * 72) / (fs * 0.435); let n = 0;
      for (const p of paras) n += p.head ? 1.5 : p.sub ? 1.15 : Math.ceil((String(p.t).length + 3) / cpl) * 1.02;
      return n * fs * 1.21 <= (H - 0.5) * 72;
    };
    let fs = 10.5; while (fs > 7.5 && !fits(fs)) fs -= 0.5;
    return { paras, fs };
  });
  // Columns stay within 1 pt of the tightest one, so the page reads as one piece.
  const minFs = Math.min(...cols.map((c) => c.fs));
  data.forEach((a, ci) => {
    const x = 0.4 + ci * (W + GAP);
    const { paras } = cols[ci]; const fs = Math.min(cols[ci].fs, minFs + 1);
    s.addShape('rect', { x, y: top, w: W, h: H, fill: { color: 'FFFFFF' }, line: { color: GR, width: 0.75 } });
    s.addShape('rect', { x, y: top, w: W, h: 0.36, fill: { color: a.color } });
    s.addText(a.label, { x: x + 0.12, y: top, w: W - 0.2, h: 0.36, fontFace: F, fontSize: 13, bold: true, color: 'FFFFFF', isTextBox: true, margin: 0 });
    const runs = paras.map((p, i) => {
      const last = i === paras.length - 1;
      if (p.head) return { text: p.head, options: { bold: true, color: p.color, fontSize: fs + 1.5, breakLine: !last, paraSpaceBefore: i ? 7 : 0, paraSpaceAfter: 2 } };
      if (p.sub) return { text: p.sub, options: { bold: true, color: p.color, fontSize: fs, breakLine: !last, paraSpaceBefore: 3 } };
      return { text: p.t, options: { bullet: { code: '25AA', indent: 10 }, color: p.color || D, fontSize: fs, breakLine: !last } };
    });
    s.addText(runs, { x: x + 0.05, y: top + 0.42, w: W - 0.1, h: H - 0.46, fontFace: F, valign: 'top', isTextBox: true, margin: [2, 6, 2, 6] });
  });
  const used = emails.filter((e) => Object.keys(e.byKey || {}).length || (e.named || []).length);
  const src = used.length ? `QA status emails (${used.map((e) => `${(String(e.from).match(/,\s*(\S+)/) || String(e.from).match(/^(\S+)/) || ['', 'email'])[1]} ${new Date(e.received).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}`).join(', ')})` : 'defects linked in Jira';
  s.addText(`Hours are Jira remaining estimates and exclude regression, performance and automation work and deferred items.  Status details: Jira and ${src}.`,
    { x: 0.4, y: 7.05, w: 12.5, h: 0.3, fontFace: F, fontSize: 9, italic: true, color: '7F7F7F', isTextBox: true, margin: 0 });

  return { pptx, onePage: { sprint: S, hours: Object.fromEntries(data.map((a) => [a.key, Math.round(sum(a.open))])), completedThisWeek: data.reduce((n, a) => n + a.done.length, 0), statusSource: src } };
}

module.exports = { buildOnePage, outlookNotes, businessNote };
