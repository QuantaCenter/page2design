import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { DesignDocument } from '@quantacenter/page2design';

for (const width of [390, 1440])
  test(`single and multiline ellipses remain inspectable native text at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    const folder = `artifacts/ellipsis/${width}`;
    await mkdir(folder, { recursive: true });
    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'H5 页面 URL' })
      .fill(`${baseURL}/tests/fixtures/ellipsis.html`);
    await page.getByRole('combobox', { name: '画板宽度' }).selectOption(String(width));
    const converting = page.waitForResponse(
      (response) =>
        response.url().includes('/api/convert') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '转换为设计图' }).click();
    const response = await converting;
    expect(response.ok(), await response.text()).toBeTruthy();
    const document = (await response.json()) as DesignDocument;
    await expect(page.getByText('原生 Canvas 图层', { exact: true })).toBeVisible();
    const subjects = document.nodes.filter((node) =>
      /^(single-|multi-|short-text)/.test(node.name),
    );
    expect(subjects).toHaveLength(13);
    const texts = subjects.map((subject) => {
      expect(subject.kind, subject.name).toBe('frame');
      const text = document.nodes.find(
        (node) => node.parentId === subject.id && node.kind === 'text',
      )!;
      expect(text, `${subject.name} has a native text layer`).toBeTruthy();
      expect(text.assetId).toBeUndefined();
      if (!['short-text', 'multi-bili-short'].includes(subject.name)) {
        expect(text.textOverflow?.truncated, subject.name).toBe(true);
        expect(text.textOverflow?.visibleText, subject.name).toContain('…');
        expect(
          text.runs?.some((run) => run.generated === 'ellipsis'),
          subject.name,
        ).toBeTruthy();
        expect(text.text!.length).toBeGreaterThan(text.textOverflow!.visibleText!.length);
      } else
        expect(text.textOverflow?.truncated, `${subject.name} is not falsely truncated`).not.toBe(
          true,
        );
      if (subject.name === 'multi-bili-long') expect(text.style['font-weight']).toBe('500');
      return text;
    });
    const first = texts[0];
    await page.getByTestId(`layer-${first.id}`).click();
    await expect(page.getByTestId('text-overflow-info')).toContainText('单行省略');
    await expect(page.getByTestId('full-text')).toHaveText(first.text!);
    await expect(page.getByTestId('visible-text')).toHaveText(first.textOverflow!.visibleText!);
    const canvas = page.getByTestId('design-canvas');
    const marker = first.runs!.find((run) => run.generated === 'ellipsis')!;
    for (const scale of [100, 200]) {
      await page.getByTestId(`layer-${first.id}`).dblclick();
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(String(scale));
      await canvas.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const camera = JSON.parse((await canvas.getAttribute('data-camera'))!);
      const bounds = (await canvas.boundingBox())!;
      await page.mouse.click(
        bounds.x + camera.x + (marker.x + marker.width / 2) * camera.scale,
        bounds.y + camera.y + (marker.y + marker.height / 2) * camera.scale,
      );
      await expect(page.getByTestId(`layer-${first.id}`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('full-text')).toHaveText(first.text!);
    }
    const complex = document.nodes.find((node) => node.name === 'complex-mixed')!;
    expect(complex.kind).toBe('raster');
    expect(complex.text).toContain('复杂混排');
    await page.getByTestId(`layer-${complex.id}`).click();
    await expect(page.getByTestId('full-text')).toHaveText(complex.text!);
    const download = async (name: string) => {
      await page.getByRole('button', { name: '导出', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name }).click();
      return readFile((await (await downloading).path())!);
    };
    const png = await download('Canvas 图片');
    const flat = JSON.parse((await download('设计文档')).toString()) as DesignDocument;
    expect(flat.nodes.find((node) => node.id === first.id)?.textOverflow).toEqual(
      first.textOverflow,
    );
    await page.getByRole('button', { name: '原始层级', exact: true }).click();
    expect(await download('Canvas 图片')).toEqual(png);
    const reference = Buffer.from(document.referenceImage.split(',')[1], 'base64');
    const original = await sharp(reference)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const actual = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const results = [...subjects, complex].map((subject) => {
      let count = 0,
        different = 0,
        sum = 0;
      for (
        let y = Math.floor(subject.box.y);
        y < Math.ceil(subject.box.y + subject.box.height);
        y++
      )
        for (
          let x = Math.floor(subject.box.x);
          x < Math.ceil(subject.box.x + subject.box.width);
          x++
        ) {
          const offset = (y * document.width + x) * 4;
          const delta = Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs(actual.data[offset + channel] - original.data[offset + channel]),
            ),
          );
          count++;
          sum += delta;
          if (delta > 32) different++;
        }
      return {
        name: subject.name,
        pixels: count,
        different,
        ratio: different / count,
        mean: sum / count,
      };
    });
    await writeFile(`${folder}/reference.png`, reference);
    await writeFile(`${folder}/canvas.png`, png);
    await writeFile(`${folder}/design.json`, JSON.stringify(document));
    await writeFile(`${folder}/report.json`, JSON.stringify(results, null, 2));
    expect(
      results.filter((result) => result.ratio > 0.01 || result.mean > 2),
      `Ellipsis appearance: ${folder}`,
    ).toEqual([]);
  });
