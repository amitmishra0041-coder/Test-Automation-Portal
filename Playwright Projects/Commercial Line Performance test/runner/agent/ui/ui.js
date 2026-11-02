// Assistant tab (loaded only when the server has RUNNER_AGENT=1). Everything shown from Jira / tools is escaped.
// Layout: one thing at a time — ask box, then one task card (Summary | Stories & bugs | Defects | Plan | Log tabs);
// approvals as a bar above the card; History / memory / metrics live in a slide-out drawer.
(function () {
  'use strict';
  var panel = document.getElementById('tab-assistant');
  if (!panel) return;
  var state = { tasks: [], selected: null, meta: null, tab: 'summary', filter: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function me() { return window.runnerEmail || ''; }
  function api(method, url, body) {
    return fetch('/api/agent' + url, { method: method, headers: { 'Content-Type': 'application/json', 'X-Runner-User': me() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; }); });
  }
  function ago(iso) { var s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; }
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  function stepOf(t, tool) { return (t.steps.find(function (s) { return s.tool === tool && s.result; }) || {}).result; }
  var LABEL = { running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', awaiting_approval: 'Waiting for you', paused: 'Paused', interrupted: 'Interrupted', needs_input: 'Needs input' };

  panel.innerHTML =
    '<div class="ag-top"><h1>Assistant <span class="ag-badge">Experimental</span></h1>' +
      '<div class="ag-top-r"><span class="ag-local">&#128274; Local only &middot; no AI service</span><button id="agHistBtn">&#128339; History</button></div></div>' +
    '<div class="ag-main">' +
      '<div id="agHero" class="ag-hero"><h2>What do you need?</h2><p>I plan the steps, run the safe ones and ask before sending anything.</p></div>' +
      '<div class="ag-ask"><input id="agInput" placeholder="e.g. Review impeded SMART test execution stories and list linked bugs"><button class="primary" id="agGo">Run</button></div>' +
      '<div class="ag-sugg" id="agSugg"></div>' +
      '<div class="ag-err" id="agErr"></div>' +
      '<div id="agApprove"></div>' +
      '<div id="agTask"></div>' +
      '<div id="agFoot" class="ag-local ag-foot-note">&#9679; Your data stays on this PC</div>' +
    '</div>' +
    '<div class="ag-dim" id="agDim" hidden></div>' +
    '<aside class="ag-drawer" id="agDrawer" hidden><div class="ag-drawer-head"><b>History &amp; settings</b><button id="agClose" aria-label="Close">&#10005;</button></div>' +
      '<button class="ag-link" id="agNew" style="margin-top:12px">+ New task</button>' +
      '<h3>Recent tasks</h3><ul class="ag-hist" id="agHist"></ul>' +
      '<h3>Remembered for you</h3><div class="ag-kv" id="agMem"></div><div class="hint">Used when a request doesn\'t say. Clear a box and Save to forget it.</div>' +
      '<h3>Assistant</h3><div id="agMetrics" class="ag-mline"></div></aside>';

  var input = document.getElementById('agInput');
  document.getElementById('agGo').addEventListener('click', function () { submit(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(input.value); });
  function drawer(open) { document.getElementById('agDrawer').hidden = !open; document.getElementById('agDim').hidden = !open; }
  document.getElementById('agHistBtn').addEventListener('click', function () { drawer(true); });
  document.getElementById('agClose').addEventListener('click', function () { drawer(false); });
  document.getElementById('agDim').addEventListener('click', function () { drawer(false); });
  document.getElementById('agNew').addEventListener('click', function () { state.selected = null; renderHistory(); drawer(false); renderTask(null); input.focus(); });

  function err(msg) { document.getElementById('agErr').textContent = msg || ''; }
  function submit(text, continueFrom) {
    err('');
    if (!me()) { err('Enter your email in Settings first.'); return; }
    if (!String(text || '').trim()) { err('Type what you need, or pick a suggestion.'); return; }
    api('POST', '/tasks', { objective: text, continueFrom: continueFrom }).then(function (t) { input.value = ''; upsert(t); select(t.id); }).catch(function (e) { err(e.message); });
  }
  function act(id, action) {
    if (action === 'cancel' && !confirm('Cancel this task?')) return;
    api('POST', '/tasks/' + id + '/' + action).then(upsert).catch(function (e) { err(e.message); });
  }
  function upsert(t) {
    var i = state.tasks.findIndex(function (x) { return x.id === t.id; });
    if (i >= 0) state.tasks[i] = t; else state.tasks.unshift(t);
    renderHistory();
    if (state.selected === t.id) renderTask(t);
    if (t.status === 'done' || t.status === 'failed') loadMetrics();
  }
  function select(id) {
    if (state.selected !== id) { state.tab = 'summary'; state.filter = null; }
    state.selected = id; renderHistory(); drawer(false);
    renderTask(state.tasks.find(function (x) { return x.id === id; }));
  }

  function renderHistory() {
    var el = document.getElementById('agHist');
    if (!state.tasks.length) { el.innerHTML = '<li class="ag-empty">No tasks yet.</li>'; return; }
    el.innerHTML = state.tasks.map(function (t) {
      return '<li data-id="' + esc(t.id) + '" class="' + (t.id === state.selected ? 'sel' : '') + '"><div class="t">' + esc(t.objective) + '</div>' +
        '<div class="m"><span class="ag-badge ' + esc(t.status) + '">' + esc(LABEL[t.status] || t.status) + '</span>' + esc(ago(t.createdAt)) + '</div></li>';
    }).join('');
    each(el, 'li[data-id]', function (li) { li.addEventListener('click', function () { select(li.dataset.id); }); });
  }

  function stepSub(s) {
    var a = Object.keys(s.args || {}).filter(function (k) { return s.args[k]; }).map(function (k) { return k + ': ' + s.args[k]; }).join(' · ');
    var bits = [];
    if (a) bits.push(a);
    if (s.ms != null) bits.push((s.ms / 1000).toFixed(1) + 's');
    if (s.attempts > 1) bits.push('retried');
    return bits.join(' · ');
  }

  function renderTask(t) {
    var el = document.getElementById('agTask');
    document.getElementById('agHero').hidden = !!t;
    document.getElementById('agSugg').hidden = !!t;
    document.getElementById('agFoot').hidden = !!t;
    var ap = document.getElementById('agApprove');
    ap.innerHTML = '';
    if (!t) { el.innerHTML = ''; return; }

    var wait = t.steps.find(function (s) { return s.status === 'awaiting_approval'; });
    if (wait) {
      ap.innerHTML = '<div class="ag-bar"><span>&#9993;</span><div class="tx"><b>Waiting for you:</b> ' + esc(wait.title) +
        (stepSub(wait) ? ' <span class="ag-sub">(' + esc(stepSub(wait)) + ')</span>' : '') + '</div>' +
        '<button data-act="reject">Reject</button><button class="primary" data-act="approve">Approve</button></div>';
      each(ap, '[data-act]', function (b) { b.addEventListener('click', function () { act(t.id, b.dataset.act); }); });
    }

    var total = t.steps.length;
    var finished = t.steps.filter(function (s) { return ['done', 'skipped'].indexOf(s.status) >= 0; }).length;
    var current = t.steps.find(function (s) { return s.status === 'running' || s.status === 'awaiting_approval'; });
    var v = stepOf(t, 'validate');
    var bad = v ? v.checks.filter(function (c) { return !c.ok; }).length : 0;
    var stepText = !total ? '' : t.status === 'done' ? total + ' of ' + total + ' steps' + (v ? (bad ? ' · ' + bad + ' check(s) failed' : ' · checks passed') : '')
      : current ? 'Step ' + (current.n + 1) + ' of ' + total + ' · ' + current.title : finished + ' of ' + total + ' steps';
    var started = new Date(t.createdAt);
    var dur = t.updatedAt && t.status === 'done' ? ' · ' + Math.max(1, Math.round((new Date(t.updatedAt) - started) / 1000)) + ' s' : '';

    var st = stepOf(t, 'jira.impededStories'), df = stepOf(t, 'jira.openDefects');
    var tabs = [['summary', 'Summary']];
    if (st) tabs.push(['stories', 'Stories & bugs (' + st.bugLinks + ')']);
    if (df) tabs.push(['defects', 'Defects (' + df.total + ')']);
    tabs.push(['plan', 'Plan'], ['log', 'Log']);
    if (!tabs.some(function (x) { return x[0] === state.tab; })) state.tab = 'summary';

    var html = '<div class="ag-card"><div class="ag-head"><div><div class="ag-obj">' + esc(t.objective) + '</div>' +
      '<div class="ag-meta">' + esc(started.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })) + dur + '</div></div>' +
      '<span class="ag-badge ' + esc(t.status) + '">' + esc(LABEL[t.status] || t.status) + '</span></div>';
    if (total) html += '<div class="ag-stepper">' + t.steps.map(function (s, i) {
      return (i ? '<span class="ag-line"></span>' : '') + '<span class="ag-dot ' + esc(s.status) + '" title="' + esc((s.n + 1) + '. ' + s.title) + '"></span>';
    }).join('') + '<span class="ag-steptext">' + esc(stepText) + '</span></div>';
    html += '<div class="ag-tabs">' + tabs.map(function (x) { return '<button data-tab="' + x[0] + '" class="' + (x[0] === state.tab ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    html += '<div class="ag-body">' + (state.tab === 'summary' ? summary(t) : state.tab === 'stories' ? stories(st) : state.tab === 'defects' ? defects(df) : state.tab === 'plan' ? plan(t) : log(t)) + '</div>';

    var acts = [];
    if (t.status === 'running') acts.push(['pause', 'Pause']);
    if (['paused', 'interrupted', 'failed'].indexOf(t.status) >= 0) acts.push(['resume', t.status === 'failed' ? 'Retry' : 'Resume']);
    if (['done', 'cancelled'].indexOf(t.status) < 0) acts.push(['cancel', 'Cancel']);
    if (['done', 'failed', 'cancelled', 'needs_input'].indexOf(t.status) >= 0) acts.push(['rerun', 'Run again'], ['delete', 'Delete']);
    html += '<div class="ag-foot"><span class="ag-sub">' + (stepOf(t, 'analysis.blockerInsights') && state.tab === 'summary' ? 'Click a tile to see those items' : '') + '</span><span class="ag-acts">' +
      acts.map(function (a) { return '<button class="ag-link' + (a[0] === 'delete' ? ' danger' : '') + '" data-act="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</span></div></div>';
    el.innerHTML = html;

    each(el, '.ag-tabs [data-tab]', function (b) { b.addEventListener('click', function () { state.tab = b.dataset.tab; state.filter = null; renderTask(t); }); });
    each(el, '[data-tile]', function (b) { b.addEventListener('click', function () { state.filter = tileFilters(t)[b.dataset.tile]; state.tab = 'stories'; renderTask(t); }); });
    each(el, '[data-clear]', function (b) { b.addEventListener('click', function () { state.filter = null; renderTask(t); }); });
    each(el, '[data-act]', function (b) {
      b.addEventListener('click', function () {
        var a = b.dataset.act;
        if (a === 'rerun') submit(t.objective, t.id);
        else if (a === 'delete') {
          if (!confirm('Delete this task?')) return;
          api('DELETE', '/tasks/' + t.id).then(function () { state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; }); state.selected = null; renderHistory(); renderTask(null); }).catch(function (e) { err(e.message); });
        } else act(t.id, a);
      });
    });
    each(el, '[data-follow]', function (b) {
      b.addEventListener('click', function () { if (/<address>/.test(b.dataset.follow)) { input.value = b.dataset.follow.replace('<address>', ''); input.focus(); } else submit(b.dataset.follow, t.id); });
    });
  }

  // ── tabs ──────────────────────────────────────────────────────────────────────────────────────────────
  function tileFilters(t) {
    var an = stepOf(t, 'analysis.blockerInsights');
    if (!an) return {};
    return {
      overdue: { label: 'Bugs overdue', bugs: an.overdue.map(function (o) { return o.bug; }) },
      ready: { label: 'Ready to unblock', stories: an.readyToUnblock },
      nodue: { label: 'Open, no due date', bugs: an.openNoDueDate.map(function (o) { return o.bug; }) },
      nobug: { label: 'No bug linked', stories: an.noBug },
    };
  }
  function summary(t) {
    var html = '';
    var st = stepOf(t, 'jira.impededStories'), an = stepOf(t, 'analysis.blockerInsights'), df = stepOf(t, 'jira.openDefects');
    if (st) html += '<div class="ag-headline"><b>' + st.stories + '</b> impeded stories &middot; <b>' + st.bugLinks + '</b> linked bugs</div>';
    else if (df) html += '<div class="ag-headline"><b>' + df.total + '</b> open defects</div>';
    else if (t.summary && !stepOf(t, 'runner.queueStatus') && !stepOf(t, 'runner.usageStats')) html += '<div class="ag-headline small">' + esc(t.summary) + '</div>';
    if (t.note) html += '<div class="ag-sub">' + esc(t.note) + '</div>';
    if (an) {
      var tiles = [['overdue', an.overdue.length, 'Bugs overdue', 'red'], ['ready', an.readyToUnblock.length, 'Ready to unblock', 'green'],
        ['nodue', an.openNoDueDate.length, 'Open, no due date', 'amber'], ['nobug', an.noBug.length, 'No bug linked', 'muted']];
      html += '<div class="ag-tiles">' + tiles.map(function (x) {
        return '<button class="ag-tile ' + x[3] + '" data-tile="' + x[0] + '"' + (x[1] ? '' : ' disabled') + '><span class="n">' + x[1] + '</span><span class="t">' + x[2] + '</span></button>';
      }).join('') + '</div>';
      if (an.dueToday.length) html += '<div class="ag-sub" style="margin-top:8px">Due today: ' + esc(an.dueToday.join(', ')) + '</div>';
    }
    ['runner.queueStatus', 'runner.usageStats'].forEach(function (tool) { var r = stepOf(t, tool); if (r) html += plainResult(tool, r); });
    var fl = t.steps.filter(function (s) { return s.result && s.result.file; });
    if (fl.length) html += '<div class="ag-files">' + fl.map(function (s) {
      return '<a class="ag-file" href="/api/agent/files/' + encodeURIComponent(s.result.file) + '?u=' + encodeURIComponent(me()) + '">&#11015; ' + esc(s.result.file) + '</a>';
    }).join('') + '</div>';
    if ((st || df) && t.summary && ['failed', 'cancelled'].indexOf(t.status) >= 0) html += '<div class="ag-sub" style="margin-top:10px">' + esc(t.summary) + '</div>';
    if (t.status === 'done' && t.followUps && t.followUps.length) html += '<div class="ag-follow">' + t.followUps.map(function (f) { return '<button class="chip" data-follow="' + esc(f) + '">' + esc(f) + '</button>'; }).join('') + '</div>';
    if (!html) html = '<div class="ag-sub">' + (t.status === 'awaiting_approval' ? 'Nothing has been sent. Approve or reject above.' : t.status === 'running' ? 'Working on it…' : 'No results yet.') + '</div>';
    return html;
  }
  function plainResult(tool, r) {
    if (tool === 'runner.queueStatus') {
      var row = function (j) { return '<li>' + esc(j.label || j.suite || j.id || 'job') + (j.requestedBy ? ' <span class="ag-sub">— ' + esc(j.requestedBy) + '</span>' : '') + '</li>'; };
      var run = r.running || [], q = r.queued || [];
      return '<div class="ag-headline small"><b>' + run.length + '</b> running &middot; <b>' + q.length + '</b> queued</div>' +
        (run.length + q.length ? '<ul class="ag-plain">' + run.map(row).join('') + q.map(row).join('') + '</ul>' : '');
    }
    var by = r.jobsByTool || {};
    return '<div class="ag-headline small"><b>' + r.submissions + '</b> submissions in the last ' + r.days + ' days</div><ul class="ag-plain">' +
      Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (k) { return '<li>' + esc(k) + ' <span class="ag-sub">— ' + by[k] + ' jobs</span></li>'; }).join('') + '</ul>';
  }
  function stories(st) {
    if (!st || !st.rows.length) return '<div class="ag-sub">No rows.</div>';
    var today = new Date().toLocaleDateString('en-CA');
    var site = 'https://donegalgroup.atlassian.net/browse/';
    var link = function (k) { return k ? '<a href="' + site + encodeURIComponent(k) + '" target="_blank" rel="noopener">' + esc(k) + '</a>' : ''; };
    var f = state.filter, rows = st.rows;
    if (f) rows = rows.filter(function (r) { return f.bugs ? f.bugs.indexOf(r.bug) >= 0 : f.stories.indexOf(r.story) >= 0; });
    if (f && f.bugs) { var seen = {}; rows = rows.filter(function (r) { if (seen[r.bug]) return false; seen[r.bug] = 1; return true; }); }
    return (f ? '<div class="ag-filter">Showing: <b>' + esc(f.label) + '</b> (' + rows.length + ') <button class="ag-link" data-clear>Show all</button></div>' : '') +
      '<div class="ag-table-wrap"><table class="ag-table"><thead><tr><th>Story</th><th>Summary</th><th>Bug</th><th>Status</th><th>Severity</th><th>Due</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var overdue = r.due && r.due < today && !/^(closed|rejected|fixed|done|resolved)$/i.test(r.bugStatus || '');
        return '<tr><td>' + link(r.story) + '</td><td>' + esc(r.storySummary) + '</td><td>' + (r.bug ? link(r.bug) : '<span class="ag-sub">none</span>') + '</td><td>' + esc(r.bugStatus || '') +
          '</td><td class="ag-sev-' + esc(r.severity) + '">' + esc(r.severity || '') + '</td><td class="' + (overdue ? 'ag-overdue' : '') + '">' + esc(r.due || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function defects(df) {
    var sevs = ['Critical', 'High', 'Medium', 'Low', 'None'];
    return '<div class="ag-table-wrap"><table class="ag-table"><thead><tr><th>Status</th>' + sevs.map(function (s) { return '<th>' + s + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
      Object.keys(df.byStatus).map(function (k) { var row = df.byStatus[k]; var tot = 0; Object.keys(row).forEach(function (x) { tot += row[x]; });
        return '<tr><td>' + esc(k) + '</td>' + sevs.map(function (s) { return '<td>' + (row[s] || '') + '</td>'; }).join('') + '<td><b>' + tot + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function plan(t) {
    if (!t.steps.length) return '<div class="ag-sub">' + esc(t.summary || 'No plan.') + '</div>';
    var v = stepOf(t, 'validate');
    return '<ol class="ag-steps">' + t.steps.map(function (s) {
      return '<li class="ag-step"><span class="ag-dot ' + esc(s.status) + '"></span><div><div class="ag-step-title">' + (s.n + 1) + '. ' + esc(s.title) + '</div>' +
        (stepSub(s) ? '<div class="ag-step-sub">' + esc(stepSub(s)) + '</div>' : '') +
        (s.error ? '<div class="ag-step-err">' + esc(s.error) + '</div>' : '') + '</div>' +
        '<span class="ag-risk ' + esc(s.risk) + '">' + esc(s.risk === 'send' ? 'needs approval' : s.risk) + '</span></li>';
    }).join('') + '</ol>' +
      (v ? '<ul class="ag-checks">' + v.checks.map(function (c) { return '<li class="' + (c.ok ? '' : 'bad') + '">' + (c.ok ? '&#10003; ' : '&#10007; ') + esc(c.check) + (c.note ? ' — ' + esc(c.note) : '') + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="ag-sub" style="margin-top:8px">Planned by ' + esc(t.planner) + '</div>';
  }
  function log(t) {
    return '<div class="ag-log">' + esc(t.log.map(function (l) { return new Date(l.ts).toLocaleTimeString() + '  ' + l.msg; }).join('\n')) + '</div>';
  }

  // ── drawer ────────────────────────────────────────────────────────────────────────────────────────────
  function renderMemory(mem) {
    var el = document.getElementById('agMem');
    var rows = [['defaultProject', 'Default project', 'SMART'], ['defaultRecipients', 'Default recipients', 'name@donegalgroup.com']];
    el.innerHTML = rows.map(function (r) {
      return '<label for="agm-' + r[0] + '">' + r[1] + '</label><div class="ag-kv-row"><input id="agm-' + r[0] + '" value="' + esc(mem[r[0]] || '') + '" placeholder="' + r[2] + '"><button data-key="' + r[0] + '">Save</button></div>';
    }).join('');
    each(el, 'button[data-key]', function (b) {
      b.addEventListener('click', function () {
        api('POST', '/memory', { key: b.dataset.key, value: document.getElementById('agm-' + b.dataset.key).value.trim() || null })
          .then(function (m) { renderMemory(m); err(''); }).catch(function (e) { err(e.message); });
      });
    });
  }
  function loadMetrics() {
    api('GET', '/metrics').then(function (m) {
      document.getElementById('agMetrics').innerHTML = '<div><span>Tasks</span>' + esc(m.tasks) + ' &middot; ' + esc(m.completionRate) + '% completed</div><div><span>Retries</span>' + esc(m.retries) + '</div>' +
        (state.meta ? '<div><span>Tools</span>' + state.meta.tools.length + ' (' + state.meta.tools.filter(function (x) { return x.risk === 'send'; }).length + ' need approval)</div>' : '');
    }).catch(function () {});
  }

  function load() {
    if (!me()) { err('Enter your email in Settings to use the Assistant.'); return; }
    api('GET', '/meta').then(function (m) {
      state.meta = m;
      document.getElementById('agSugg').innerHTML = m.suggestions.map(function (s) { return '<button class="chip" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
      each(document, '#agSugg [data-s]', function (b) { b.addEventListener('click', function () { input.value = b.dataset.s; input.focus(); }); });
      renderMemory(m.memory || {});
      loadMetrics();
    }).catch(function (e) { err(e.message); });
    api('GET', '/tasks').then(function (list) { state.tasks = list; renderHistory(); if (!state.selected && list[0]) select(list[0].id); }).catch(function () {});
  }
  window.__loadAgent = load;

  // Live updates: the Runner's existing event stream carries 'agent' task pings (id/user/status only).
  var es = new EventSource('/api/stream');
  es.addEventListener('agent', function (e) { try { var p = JSON.parse(e.data); if (p.user === me()) api('GET', '/tasks/' + p.id).then(upsert).catch(function () {}); } catch (_) {} });

  renderTask(null);
  if (document.querySelector('.tab-btn[data-tab="assistant"].active')) load();
})();
