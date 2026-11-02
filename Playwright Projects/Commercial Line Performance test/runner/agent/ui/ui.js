// Assistant tab (loaded only when the server has RUNNER_AGENT=1). Everything shown from Jira / tools is escaped.
(function () {
  'use strict';
  var panel = document.getElementById('tab-assistant');
  if (!panel) return;
  var state = { tasks: [], selected: null, meta: null, metrics: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function me() { return window.runnerEmail || ''; }
  function api(method, url, body) {
    return fetch('/api/agent' + url, { method: method, headers: { 'Content-Type': 'application/json', 'X-Runner-User': me() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; }); });
  }
  function ago(iso) { var s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; }
  var LABEL = { running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', awaiting_approval: 'Needs approval', paused: 'Paused', interrupted: 'Interrupted', needs_input: 'Needs input' };

  panel.innerHTML =
    '<div class="page-head"><h1>Assistant <span class="ag-badge" style="vertical-align:middle">Experimental</span></h1>' +
    '<p>Describe what you need done. The assistant plans the steps, runs the Runner\'s own tools, asks before sending anything, and checks the results.</p></div>' +
    '<div class="ag-grid"><div>' +
      '<div class="card"><h2>What do you need?</h2>' +
        '<div class="ag-ask"><textarea id="agInput" placeholder="e.g. Review impeded SMART test execution stories and list linked bugs with severity and due date"></textarea><button class="primary" id="agGo">Run</button></div>' +
        '<div class="ag-sugg" id="agSugg"></div>' +
        '<div class="ag-banner"><b>&#9679; Local only</b> — planning runs on this PC; no Donegal data is sent to any AI service. Reading and reports run automatically; emails wait for your approval.</div>' +
        '<div class="ag-step-err" id="agErr"></div>' +
      '</div>' +
      '<div class="card" id="agTask"><div class="ag-empty">Run a task, or pick one from History.</div></div>' +
    '</div><div>' +
      '<div class="card"><h2>History</h2><ul class="ag-hist" id="agHist"><li class="ag-empty">No tasks yet.</li></ul></div>' +
      '<div class="card"><h2>Remembered for you</h2><div class="ag-kv" id="agMem"></div><div class="hint" style="margin-top:8px">Used when a request doesn\'t say. Clear a box and press Save to forget it.</div></div>' +
      '<div class="card"><h2>Assistant metrics</h2><div class="ag-metrics" id="agMetrics"></div><div id="agTools" class="hint" style="margin-top:10px"></div></div>' +
    '</div></div>';

  var input = document.getElementById('agInput');
  document.getElementById('agGo').addEventListener('click', function () { submit(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(input.value); });

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
  function select(id) { state.selected = id; renderHistory(); var t = state.tasks.find(function (x) { return x.id === id; }); if (t) renderTask(t); }

  function renderHistory() {
    var el = document.getElementById('agHist');
    if (!state.tasks.length) { el.innerHTML = '<li class="ag-empty">No tasks yet.</li>'; return; }
    el.innerHTML = state.tasks.map(function (t) {
      return '<li data-id="' + esc(t.id) + '" class="' + (t.id === state.selected ? 'sel' : '') + '"><div class="t">' + esc(t.objective) + '</div>' +
        '<div class="m"><span class="ag-badge ' + esc(t.status) + '">' + esc(LABEL[t.status] || t.status) + '</span>' + esc(ago(t.createdAt)) + '</div></li>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('li[data-id]'), function (li) { li.addEventListener('click', function () { select(li.dataset.id); }); });
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
    var real = t.steps.length;
    var done = t.steps.filter(function (s) { return ['done', 'skipped'].indexOf(s.status) >= 0; }).length;
    var current = t.steps.find(function (s) { return s.status === 'running' || s.status === 'awaiting_approval'; });
    var html = '<div class="ag-task-head"><div><div class="ag-obj">' + esc(t.objective) + '</div>' +
      '<div class="ag-meta">Planned by ' + esc(t.planner) + ' · ' + esc(ago(t.createdAt)) + (current ? ' · now: ' + esc(current.title) : '') + '</div></div>' +
      '<span class="ag-badge ' + esc(t.status) + '">' + esc(LABEL[t.status] || t.status) + '</span></div>';
    if (t.note) html += '<div class="ag-banner">' + esc(t.note) + '</div>';
    if (real) {
      html += '<div class="ag-progress"><div style="width:' + Math.round((done / real) * 100) + '%"></div></div>';
      html += '<h2 style="margin:4px 0 6px">Plan</h2><ol class="ag-steps">' + t.steps.map(function (s) {
        return '<li class="ag-step ' + esc(s.status) + '"><span class="ag-dot"></span><div><div class="ag-step-title">' + (s.n + 1) + '. ' + esc(s.title) + '</div>' +
          (stepSub(s) ? '<div class="ag-step-sub">' + esc(stepSub(s)) + '</div>' : '') +
          (s.error ? '<div class="ag-step-err">' + esc(s.error) + '</div>' : '') + '</div>' +
          '<span class="ag-risk ' + esc(s.risk) + '">' + esc(s.risk === 'send' ? 'needs approval' : s.risk) + '</span></li>';
      }).join('') + '</ol>';
    }
    var wait = t.steps.find(function (s) { return s.status === 'awaiting_approval'; });
    if (wait) {
      html += '<div class="ag-approve"><h3>Approval needed</h3><div style="font-size:13px">' + esc(wait.title) + '</div>' +
        '<div class="ag-step-sub">' + esc(stepSub(wait) || 'no parameters') + '</div>' +
        '<div class="row"><button class="primary" data-act="approve">Approve and send</button><button data-act="reject">Reject</button></div></div>';
    }
    var acts = [];
    if (t.status === 'running') acts.push(['pause', 'Pause']);
    if (['paused', 'interrupted', 'failed'].indexOf(t.status) >= 0) acts.push(['resume', t.status === 'failed' ? 'Retry' : 'Resume']);
    if (['done', 'cancelled'].indexOf(t.status) < 0) acts.push(['cancel', 'Cancel']);
    if (['done', 'failed', 'cancelled', 'needs_input'].indexOf(t.status) >= 0) acts.push(['rerun', 'Run again'], ['delete', 'Delete']);
    if (acts.length) html += '<div class="ag-actions" style="margin-top:12px">' + acts.map(function (a) { return '<button data-act="' + a[0] + '">' + a[1] + '</button>'; }).join('') + '</div>';
    if (t.summary) html += '<div class="ag-summary">' + esc(t.summary) + files(t) + checks(t) + '</div>';
    html += results(t);
    if (t.status === 'done' && t.followUps && t.followUps.length) html += '<div class="ag-follow">' + t.followUps.map(function (f) { return '<button class="chip" data-follow="' + esc(f) + '">' + esc(f) + '</button>'; }).join('') + '</div>';
    html += '<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Execution log</summary><div class="ag-log">' +
      esc(t.log.map(function (l) { return new Date(l.ts).toLocaleTimeString() + '  ' + l.msg; }).join('\n')) + '</div></details>';
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () {
        var a = b.dataset.act;
        if (a === 'rerun') submit(t.objective, t.id);
        else if (a === 'delete') api('DELETE', '/tasks/' + t.id).then(function () { state.tasks = state.tasks.filter(function (x) { return x.id !== t.id; }); state.selected = null; renderHistory(); el.innerHTML = '<div class="ag-empty">Task deleted.</div>'; }).catch(function (e) { err(e.message); });
        else act(t.id, a);
      });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-follow]'), function (b) {
      b.addEventListener('click', function () { if (/<address>/.test(b.dataset.follow)) { input.value = b.dataset.follow.replace('<address>', ''); input.focus(); } else submit(b.dataset.follow, t.id); });
    });
  }

  function files(t) {
    var out = t.steps.filter(function (s) { return s.result && s.result.file; }).map(function (s) {
      return '<div style="margin-top:6px">&#128196; <a href="/api/agent/files/' + encodeURIComponent(s.result.file) + '?u=' + encodeURIComponent(me()) + '">' + esc(s.result.file) + '</a></div>';
    });
    return out.join('');
  }
  function checks(t) {
    var v = t.steps.find(function (s) { return s.tool === 'validate' && s.result; });
    if (!v) return '';
    return '<ul class="ag-checks">' + v.result.checks.map(function (c) { return '<li class="' + (c.ok ? '' : 'bad') + '">' + (c.ok ? '&#10003; ' : '&#10007; ') + esc(c.check) + (c.note ? ' — ' + esc(c.note) : '') + '</li>'; }).join('') + '</ul>';
  }
  function results(t) {
    var html = '';
    var an = (t.steps.find(function (s) { return s.tool === 'analysis.blockerInsights' && s.result; }) || {}).result;
    if (an) {
      var list = function (label, arr) { return arr.length ? '<div style="margin-top:6px"><b>' + esc(label) + ' (' + arr.length + '):</b> ' + esc(arr.join(', ')) + '</div>' : ''; };
      html += '<div class="ag-summary"><h2 style="margin:0 0 4px">Insights</h2>' +
        list('Ready to unblock — every linked bug closed', an.readyToUnblock) + list('No bug linked', an.noBug) +
        list('Open bugs past due', an.overdue.map(function (o) { return o.bug + ' (' + o.status + ', due ' + o.due + ')'; })) +
        list('Due today', an.dueToday) + list('Open bugs with no due date', an.openNoDueDate.map(function (o) { return o.bug + (o.severity ? ' (' + o.severity + ')' : ''); })) + '</div>';
    }
    var st = (t.steps.find(function (s) { return s.tool === 'jira.impededStories' && s.result; }) || {}).result;
    if (st && st.rows.length) {
      var today = new Date().toLocaleDateString('en-CA');
      var site = 'https://donegalgroup.atlassian.net/browse/';
      var link = function (k) { return k ? '<a href="' + site + encodeURIComponent(k) + '" target="_blank" rel="noopener">' + esc(k) + '</a>' : ''; };
      html += '<div class="ag-table-wrap"><table class="ag-table"><thead><tr><th>Story</th><th>Summary</th><th>Bug</th><th>Status</th><th>Severity</th><th>Due</th></tr></thead><tbody>' +
        st.rows.map(function (r) {
          var overdue = r.due && r.due < today && !/^(closed|rejected|fixed|done)$/i.test(r.bugStatus || '');
          return '<tr><td>' + link(r.story) + '</td><td>' + esc(r.storySummary) + '</td><td>' + (r.bug ? link(r.bug) : '<span class="hint">none</span>') + '</td><td>' + esc(r.bugStatus || '') +
            '</td><td class="ag-sev-' + esc(r.severity) + '">' + esc(r.severity || '') + '</td><td class="' + (overdue ? 'ag-overdue' : '') + '">' + esc(r.due || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var df = (t.steps.find(function (s) { return s.tool === 'jira.openDefects' && s.result; }) || {}).result;
    if (df) {
      var sevs = ['Critical', 'High', 'Medium', 'Low', 'None'];
      html += '<div class="ag-table-wrap"><table class="ag-table"><thead><tr><th>Status</th>' + sevs.map(function (s) { return '<th>' + s + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
        Object.keys(df.byStatus).map(function (k) { var row = df.byStatus[k]; var tot = 0; Object.keys(row).forEach(function (x) { tot += row[x]; });
          return '<tr><td>' + esc(k) + '</td>' + sevs.map(function (s) { return '<td>' + (row[s] || '') + '</td>'; }).join('') + '<td><b>' + tot + '</b></td></tr>'; }).join('') + '</tbody></table></div>';
    }
    ['runner.queueStatus', 'runner.usageStats'].forEach(function (tool) {
      var r = (t.steps.find(function (s) { return s.tool === tool && s.result; }) || {}).result;
      if (r) html += '<div class="ag-log" style="max-height:220px">' + esc(JSON.stringify(r, null, 2)) + '</div>';
    });
    return html;
  }

  function renderMemory(mem) {
    var el = document.getElementById('agMem');
    var rows = [['defaultProject', 'Default Jira project', 'SMART'], ['defaultRecipients', 'Default email recipients', 'name@donegalgroup.com']];
    el.innerHTML = rows.map(function (r) {
      return '<label for="agm-' + r[0] + '">' + r[1] + '</label><div style="display:flex;gap:6px"><input id="agm-' + r[0] + '" value="' + esc(mem[r[0]] || '') + '" placeholder="' + r[2] + '"><button data-key="' + r[0] + '">Save</button></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('button[data-key]'), function (b) {
      b.addEventListener('click', function () {
        api('POST', '/memory', { key: b.dataset.key, value: document.getElementById('agm-' + b.dataset.key).value.trim() || null })
          .then(function (m) { renderMemory(m); err(''); }).catch(function (e) { err(e.message); });
      });
    });
  }
  function loadMetrics() {
    api('GET', '/metrics').then(function (m) {
      document.getElementById('agMetrics').innerHTML = [[m.tasks, 'Tasks'], [m.completionRate + '%', 'Completed'], [m.retries, 'Retries']].map(function (x) {
        return '<div class="stat"><div class="n">' + esc(x[0]) + '</div><div class="l">' + esc(x[1]) + '</div></div>'; }).join('');
    }).catch(function () {});
  }

  function load() {
    if (!me()) { err('Enter your email in Settings to use the Assistant.'); return; }
    api('GET', '/meta').then(function (m) {
      state.meta = m;
      document.getElementById('agSugg').innerHTML = m.suggestions.map(function (s) { return '<button class="chip" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('#agSugg [data-s]'), function (b) { b.addEventListener('click', function () { input.value = b.dataset.s; input.focus(); }); });
      document.getElementById('agTools').innerHTML = 'Tools: ' + m.tools.map(function (t) { return esc(t.name) + (t.risk === 'send' ? ' (approval)' : ''); }).join(', ');
      renderMemory(m.memory || {});
    }).catch(function (e) { err(e.message); });
    api('GET', '/tasks').then(function (list) { state.tasks = list; renderHistory(); if (!state.selected && list[0]) select(list[0].id); }).catch(function () {});
    loadMetrics();
  }
  window.__loadAgent = load;

  // Live updates: the Runner's existing event stream carries 'agent' task events.
  var es = new EventSource('/api/stream');
  es.addEventListener('agent', function (e) { try { var p = JSON.parse(e.data); if (p.user === me()) api('GET', '/tasks/' + p.id).then(upsert).catch(function () {}); } catch (_) {} });

  if (document.querySelector('.tab-btn[data-tab="assistant"].active')) load();
})();
