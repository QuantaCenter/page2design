import { test, expect } from '@playwright/test';
import type { DesignDocument } from '@page-to-design/core';

test('full-page collection waits for content triggered by preload scrolling', async ({
  request,
  baseURL,
}) => {
  const response = await request.post('/api/convert', {
    data: {
      url: `${baseURL}/tests/fixtures/lazy-page.html`,
      width: 390,
      height: 844,
      fullPage: true,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const document = (await response.json()) as DesignDocument;
  expect(document.nodes.some((node) => node.text?.includes('Loaded below fold'))).toBeTruthy();
  expect(document.nodes.some((node) => node.text?.includes('Loading skeleton'))).toBeFalsy();
  const image = document.nodes.find((node) => node.name === 'late image')!;
  expect(image.kind).toBe('image');
  expect(image.assetId).toBeTruthy();
  expect(image.box.y).toBeGreaterThan(844);
});
