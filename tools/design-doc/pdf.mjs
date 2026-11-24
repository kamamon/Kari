// 制作計画・実装指示書の HTML を、A4 の PDF にする。使い方: node tools/design-doc/pdf.mjs <HTML> <PDF>
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const [src, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('file://' + resolve(src));
const foot = '<div style="font-size:7px;color:#7a837d;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>霧境の狩人 制作計画・実装指示書 第 2 版 v2.0 | 2026.11.24 | 数値・名称は初期設計</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';
await page.pdf({ path: out, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot, preferCSSPageSize: true });
await browser.close();
