// utils/blinqClick.js
async function blinqClick(pageOrFrame, locators, scopeOrOptions) {
  // third arg may be a scope string or an options object { scope, aggressive }
  let scope = undefined;
  let aggressive = false;
  if (typeof scopeOrOptions === 'string') scope = scopeOrOptions;
  if (typeof scopeOrOptions === 'object' && scopeOrOptions !== null) {
    scope = scopeOrOptions.scope || undefined;
    aggressive = !!scopeOrOptions.aggressive;
  }

  // strategy helper: try multiple click approaches against a given node
  async function tryClickNode(node) {
    // 1) Normal click
    try {
      await node.click({ timeout: 30000 });
      return true;
    } catch (e) {
      // continue
    }
    // 2) Force click (may bypass overlays)
    try {
      await node.click({ force: true, timeout: 20000 });
      return true;
    } catch (e) {
      // continue
    }
    // 3) JS click via elementHandle
    try {
      const h = await node.elementHandle();
      if (h) {
        await pageOrFrame.evaluate(el => { el.scrollIntoView({block: 'center', inline: 'center'}); el.click(); }, h);
        return true;
      }
    } catch (e) {
      // continue
    }
    // 4) Bounding-box mouse click
    try {
      const box = await node.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await pageOrFrame.mouse.move(x, y);
        await pageOrFrame.mouse.click(x, y, { timeout: 20000 });
        return true;
      }
    } catch (e) {
      // continue
    }
    // 5) Dispatch pointer events via evaluate
    try {
      const h = await node.elementHandle();
      if (h) {
        await pageOrFrame.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const ev1 = new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 });
          const ev2 = new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 });
          el.dispatchEvent(ev1);
          el.dispatchEvent(ev2);
        }, h);
        return true;
      }
    } catch (e) {
      // continue
    }
    // 6) Focus + keyboard Enter
    try {
      await node.focus();
      await pageOrFrame.keyboard.press('Enter');
      return true;
    } catch (e) {
      // continue
    }
    return false;
  }

  for (const loc of locators) {
    let locatorStr = loc;

    // Convert Blinq internal:text to Playwright text locator
    if (/^internal:text="(.+)"i$/.test(loc)) {
      const m = loc.match(/^internal:text="(.+)"i$/);
      locatorStr = `text=/${m[1]}/i`;
    } else if (/^internal:text="(.+)"s$/.test(loc)) {
      const m = loc.match(/^internal:text="(.+)"s$/);
      locatorStr = `text="${m[1]}"`;
    } else if (/^div\s*>>\s*internal:has-text="(.+)"$/i.test(loc)) {
      const m = loc.match(/^div\s*>>\s*internal:has-text="(.+)"$/i);
      locatorStr = `div:has-text("${m[1]}")`;
    } else if (/^div\s*>>\s*internal:has-text=\/.+\/[i]*$/i.test(loc)) {
      // e.g. `div >> internal:has-text=/^Risk Analysis$/` -> `div >> text=/^Risk Analysis$/`
      const m = loc.match(/^div\s*>>\s*internal:has-text=\/(.+)\/([i]*)$/i);
      if (m) {
        const pattern = m[1];
        const flags = m[2] || '';
        locatorStr = `div >> text=/${pattern}/${flags}`;
      }
    } else if (/^internal:has-text=\/.+\/[i]*$/i.test(loc)) {
      // e.g. `internal:has-text=/foo/i` -> `text=/foo/i`
      const m = loc.match(/^internal:has-text=\/(.+)\/([i]*)$/i) || loc.match(/^internal:has-text\/(.+)\/([i]*)$/i);
      if (m) {
        const pattern = m[1];
        const flags = m[2] || '';
        locatorStr = `text=/${pattern}/${flags}`;
      }
    } else if (/^internal:text="(.+)"i\s*>>\s*div\s*>>\s*internal:has-text="(.+)"i$/i.test(loc)) {
      const m = loc.match(/^internal:text="(.+)"i\s*>>\s*div\s*>>\s*internal:has-text="(.+)"i$/i);
      locatorStr = `div:has-text("${m[1]}"):has-text("${m[2]}")`;
    }

    try {
      // If a scope was provided, search inside that root first
      let element;
      if (scope) {
        try {
          const root = pageOrFrame.locator(scope);
          const rootCount = await root.count();
          if (rootCount === 0) {
            console.log(`🔎 Scope '${scope}' not found; falling back to whole page for locator ${locatorStr}`);
            element = pageOrFrame.locator(locatorStr);
          } else {
            element = root.locator(locatorStr);
            console.log(`🔎 Searching within scope '${scope}' for locator: ${locatorStr}`);
          }
        } catch (sErr) {
          console.warn(`Scope lookup failed (${scope}): ${sErr.message}; falling back to whole page`);
          element = pageOrFrame.locator(locatorStr);
        }
      } else {
        element = pageOrFrame.locator(locatorStr);
      }
      const count = await element.count();
      if (count > 0) {
        console.log(`✅ Found ${count} nodes for locator: ${locatorStr}`);
        // Prefer the first visible/clickable node
        for (let i = 0; i < count; i++) {
          const node = element.nth(i);
          try {
            const visible = await node.isVisible();
            if (!visible) continue;
            await node.scrollIntoViewIfNeeded();
            // Try the multi-strategy click routine
            if (await tryClickNode(node)) {
              console.log(`➡️ Clicked node #${i} for locator: ${locatorStr}`);
              return true;
            }
            // If not clicked and aggressive allowed, try again (some strategies may be repeated)
            if (aggressive) {
              console.log(`🔁 Aggressive mode: retrying strategies on node #${i}`);
              if (await tryClickNode(node)) return true;
            }
          } catch (innerErr) {
            console.warn(`Node #${i} click failed: ${innerErr.message}`);
            // try next
          }
        }

        // If none were visible/clickable, try strategies against the first element as a fallback
        try {
          const node = element.first();
          if (await tryClickNode(node)) {
            console.log(`➡️ Performed fallback click for locator: ${locatorStr}`);
            return true;
          }
        } catch (evalErr) {
          console.warn(`Fallback click strategies failed: ${evalErr.message}`);
        }
      }
    } catch (err) {
      console.warn(`Locator failed: ${locatorStr} — ${err.message}`);
    }
  }
  console.error('❌ Could not click element with any locator');
  return false;
}

module.exports = { blinqClick };
