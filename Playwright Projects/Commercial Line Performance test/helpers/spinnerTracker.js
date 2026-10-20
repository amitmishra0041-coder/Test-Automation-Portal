// Counts WriteBiz "processing" spinners (.dgic-status-spinner inside the status
// modal: "Loading Client Information...", "Saving information and redirecting...",
// "Please wait...") so each milestone can report how many spins it took and how
// long they were on screen - the closest measure of server processing per page.
//
// Usage (once, before the first navigation):
//   const spinTracker = await attachSpinnerTracker(page);
//   ... spinTracker.take()  -> { spins, spinSecs, spinMessages } for spins that
//                              finished since the last take()
async function attachSpinnerTracker(page) {
  const done = [];
  const open = new Map(); // page -> { start, msg } (one spinner at a time per page)
  const close = (p, end) => {
    const s = open.get(p);
    if (!s) return;
    open.delete(p);
    done.push({ start: s.start, end, msg: s.msg });
  };

  const context = page.context();
  // The page reports a spin's start as soon as it appears and its end when it
  // hides. A spinner still up when the page navigates away ("Saving information
  // and redirecting...") can't report its own end, so it's closed when that
  // page's next document starts ('doc').
  await context.exposeBinding('__wbSpinEvent', (source, ev) => {
    if (source.frame !== source.page.mainFrame()) return;
    if (ev.type === 'start') { close(source.page, ev.t); open.set(source.page, { start: ev.t, msg: ev.msg }); }
    else if (ev.type === 'end' || ev.type === 'doc') close(source.page, ev.t);
  });
  await context.addInitScript(() => {
    if (window.__wbSpinWatch || window !== window.top) return;
    window.__wbSpinWatch = true;
    const send = (ev) => { try { window.__wbSpinEvent(ev); } catch (_) {} };
    send({ type: 'doc', t: Math.round(performance.timeOrigin) });
    let spinning = false;
    setInterval(() => {
      let el = null;
      for (const s of document.querySelectorAll('.dgic-status-spinner')) {
        if (s.offsetParent !== null && s.getClientRects().length) { el = s; break; }
      }
      if (el && !spinning) {
        spinning = true;
        const box = el.closest('.modal-content') || el.parentElement;
        const msgEl = box && box.querySelector('.dgic-status-message-content');
        send({ type: 'start', t: Date.now(), msg: ((msgEl && msgEl.textContent) || '').trim().slice(0, 80) });
      } else if (!el && spinning) {
        spinning = false;
        send({ type: 'end', t: Date.now() });
      }
    }, 100);
  });

  let cursor = 0;
  return {
    take() {
      const batch = done.slice(cursor);
      cursor = done.length;
      const spinSecs = batch.reduce((s, e) => s + Math.max(0, e.end - e.start), 0) / 1000;
      const msgs = {};
      for (const e of batch) { const k = e.msg || '(no message)'; msgs[k] = (msgs[k] || 0) + 1; }
      return {
        spins: batch.length,
        spinSecs: +spinSecs.toFixed(2),
        spinMessages: Object.entries(msgs).map(([m, n]) => (n > 1 ? `${m} x${n}` : m)),
      };
    },
  };
}

module.exports = { attachSpinnerTracker };
