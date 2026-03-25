/**
 * IPC Handler: URL Scraping via undici + cheerio
 */

import { ipcMain } from 'electron';
import { load } from 'cheerio';
import type { ScrapeResult } from '../../../src/domain/ports/ipc';
import { consumeUrlData } from './data-consumer.ts';

const MAX_TEXT_LEN = 4096;

export function registerScrapeHandlers(): void {
  ipcMain.handle('scrape:scrapeUrl', async (_event, url: string): Promise<ScrapeResult> => {
    // Validate URL — only allow http/https
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { url, title: '', text: '', lists: [], error: 'Invalid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url, title: '', text: '', lists: [], error: 'Only http/https URLs are allowed' };
    }

    try {
      const { fetch } = await import('undici');
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'PPTX-Agent/1.0 (data extraction)' },
      });
      if (!res.ok) {
        return { url, title: '', text: '', lists: [], error: `HTTP ${res.status}` };
      }
      const html = await res.text();
      const $ = load(html);

      // Remove noise elements
      $('script, style, nav, footer, header, aside, [role="navigation"], .ad, .advertisement').remove();

      const title = $('title').text().trim() || $('h1').first().text().trim();

      // Extract main text
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LEN);

      // Extract visible list items
      const lists: string[] = [];
      $('li').each((_, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 5 && txt.length < 300) lists.push(txt);
      });

      return consumeUrlData(url, { title, text: bodyText, lists: lists.slice(0, 50) });
    } catch (err) {
      return {
        url,
        title: '',
        text: '',
        lists: [],
        error: err instanceof Error ? err.message : 'Scrape failed',
      };
    }
  });
}
