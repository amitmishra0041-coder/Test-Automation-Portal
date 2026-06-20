const { test, expect } = require('@playwright/test');

test('sanity - quick', async () => {
  expect(1 + 1).toBe(2);
});
