/**
 * Robust Guidewire click helper.
 * Attempts multiple strategies (frames, visible filter, element.click, dispatchEvent, mouse click).
 * Returns true if click succeeded, false otherwise.
 */
async function clickGuidewireText(page, text) {
  const attempts = [];

  // helper: is element visible in viewport and not aria-hidden
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style && style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      !(el.getAttribute && el.getAttribute('aria-hidden') === 'true') &&
      rect.width > 0 && rect.height > 0
    );
  }

  // Search across main page and all frames for matching visible elements
  async function findElementsInAllFrames() {
    const frames = [page.mainFrame(), ...page.frames()];
    const results = [];
    for (const f of frames) {
      try {
        const handles = await f.$$('*'); // get all elements (we'll filter in page.evaluate)
        // Use evaluate to find visible elements whose innerText matches exactly
        const elems = await f.evaluate((t) => {
          const nodes = Array.from(document.querySelectorAll('*'));
          return nodes
            .filter(n => {
              const txt = (n.innerText || '').trim();
              if (!txt) return false;
              return txt === t || txt.toLowerCase() === t.toLowerCase();
            })
            .map(n => ({
              xpath: (() => {
                // build short xpath to identify element for later use
                function indexInParent(node) {
                  if (!node.parentNode) return 1;
                  const tag = node.tagName;
                  const siblings = Array.from(node.parentNode.children).filter(s => s.tagName === tag);
                  return siblings.indexOf(node) + 1;
                }
                let path = '';
                let node = n;
                while (node && node.nodeType === 1) {
                  path = '/' + node.tagName.toLowerCase() + '[' + indexInParent(node) + ']' + path;
                  node = node.parentNode;
                }
                return path;
              })(),
              tag: n.tagName,
              text: n.innerText.trim(),
              ariaHidden: n.getAttribute && n.getAttribute('aria-hidden'),
              rect: (() => {
                const r = n.getBoundingClientRect();
                return { x: r.x, y: r.y, w: r.width, h: r.height };
              })()
            }));
        }, text);

        // attach frame reference info
        for (const e of elems) results.push({ frame: f, info: e });
      } catch (err) {
        // ignore frames we can't access
      }
    }
    return results;
  }

  // Try to click an element handle using several strategies
  async function tryClickHandle(handle, label) {
    try {
      // 1) Try Playwright click
      await handle.scrollIntoViewIfNeeded();
      await handle.waitForElementState('visible', { timeout: 2000 }).catch(() => {});
      await handle.click({ timeout: 3000 }).catch(() => {});
      attempts.push(`Playwright click succeeded: ${label}`);
      return true;
    } catch (e1) {
      attempts.push(`Playwright click failed: ${label} - ${String(e1).slice(0,120)}`);
    }

    try {
      // 2) Try dispatchEvent click inside page context (sometimes Guidewire needs JS events)
      await handle.evaluate((el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      attempts.push(`JS dispatchEvent click succeeded: ${label}`);
      return true;
    } catch (e2) {
      attempts.push(`JS dispatchEvent click failed: ${label} - ${String(e2).slice(0,120)}`);
    }

    try {
      // 3) Use bounding box + page.mouse.click at center (works if element is visible but overlay intercepts)
      const box = await handle.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.click(cx, cy);
        attempts.push(`Mouse click at bbox center succeeded: ${label} (${cx}, ${cy})`);
        return true;
      } else {
        attempts.push(`Mouse click skipped (no bbox): ${label}`);
      }
    } catch (e3) {
      attempts.push(`Mouse click failed: ${label} - ${String(e3).slice(0,120)}`);
    }

    return false;
  }

  // MAIN sequence
  try {
    // wait briefly for guidewire panels and network idle
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(350); // small safe delay
  } catch (e) {}

  // 1) Try getByText (friendly)
  try {
    const candidate = page.getByText(text, { exact: true });
    if (await candidate.count() > 0) {
      for (let i = 0; i < await candidate.count(); i++) {
        const h = candidate.nth(i);
        const ok = await tryClickHandle(h, `getByText exact #${i}`);
        if (ok) {
          console.log('clickGuidewireText attempts:', attempts);
          return true;
        }
      }
      attempts.push('getByText found elements but all click attempts failed');
    } else {
      attempts.push('getByText found 0 elements');
    }
  } catch (e) {
    attempts.push(`getByText threw: ${String(e).slice(0,120)}`);
  }

  // 2) Try internal text selector similar to Blinq
  try {
    const candidate2 = page.locator('internal:text="' + text + '"i');
    if (await candidate2.count() > 0) {
      for (let i = 0; i < await candidate2.count(); i++) {
        const h = candidate2.nth(i);
        const ok = await tryClickHandle(h, `internal:text #${i}`);
        if (ok) {
          console.log('clickGuidewireText attempts:', attempts);
          return true;
        }
      }
      attempts.push('internal:text found elements but all click attempts failed');
    } else {
      attempts.push('internal:text found 0 elements');
    }
  } catch (e) {
    attempts.push(`internal:text threw: ${String(e).slice(0,120)}`);
  }

  // 3) Search across frames for exact visible text and try clicking by XPath built earlier
  try {
    const found = await findElementsInAllFrames();
    if (found.length === 0) {
      attempts.push('findElementsInAllFrames found 0 candidates');
    } else {
      // filter visible ones (rect width/height > 0 and not aria-hidden)
      const visibles = found.filter(f => f.info.rect.w > 0 && f.info.rect.h > 0 && f.info.ariaHidden !== 'true');
      const candidates = visibles.length ? visibles : found; // prefer visibles
      attempts.push(`findElementsInAllFrames candidates: ${candidates.length}`);
      for (let i = 0; i < candidates.length; i++) {
        const fr = candidates[i].frame;
        const xp = candidates[i].info.xpath;
        try {
          // use the frame to find element by xpath
          const handles = await fr.$x(xp);
          if (handles && handles.length) {
            for (let k = 0; k < handles.length; k++) {
              const ok = await tryClickHandle(handles[k], `frame xpath ${xp} #${k}`);
              if (ok) {
                console.log('clickGuidewireText attempts:', attempts);
                return true;
              }
            }
          }
        } catch (ex) {
          attempts.push(`frame xpath attempt failed: ${xp} - ${String(ex).slice(0,120)}`);
        }
      }
    }
  } catch (e) {
    attempts.push(`findElementsInAllFrames threw: ${String(e).slice(0,120)}`);
  }

  // 4) As a last resort, try clicking any element that contains the text (fuzzy) using CSS :has-text
  try {
    const loose = page.locator(`:has-text("${text}")`);
    const cnt = await loose.count();
    if (cnt > 0) {
      for (let i = 0; i < cnt; i++) {
        const h = loose.nth(i);
        const ok = await tryClickHandle(h, `:has-text #${i}`);
        if (ok) {
          console.log('clickGuidewireText attempts:', attempts);
          return true;
        }
      }
      attempts.push(':has-text found elements but all click attempts failed');
    } else {
      attempts.push(':has-text found 0 elements');
    }
  } catch (e) {
    attempts.push(`:has-text threw: ${String(e).slice(0,120)}`);
  }

  // Nothing worked
  console.log('clickGuidewireText attempts:', attempts);
  return false;
}
