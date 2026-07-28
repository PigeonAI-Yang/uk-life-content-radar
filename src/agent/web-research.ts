import { BusinessError } from '../contracts/errors';

type Fetcher = typeof fetch;

const decodeXml = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'");

const textOnly = (value: string) => decodeXml(value)
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export class WebResearch {
  private readonly readableUrls = new Set<string>();

  constructor(private readonly fetcher: Fetcher = fetch) {}

  async search(query: string, limit: number) {
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new BusinessError('AGENT_EXECUTION_FAILED', `网页搜索失败：HTTP ${response.status}`, '稍后重试或更换检索词');
    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit).map((match) => {
      const item = match[1];
      const read = (tag: string) => decodeXml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? '');
      const result = {
        title: textOnly(read('title')),
        url: read('link').trim(),
        summary: textOnly(read('description')),
        publishedAt: textOnly(read('pubDate')) || undefined
      };
      if (result.url.startsWith('https://') || result.url.startsWith('http://')) this.readableUrls.add(result.url);
      return result;
    }).filter((item) => item.title && this.readableUrls.has(item.url));
    return { query, items };
  }

  async read(url: string) {
    if (!this.readableUrls.has(url)) {
      throw new BusinessError('INVALID_INPUT', '只能读取本次网页搜索返回的地址', '先使用 web_search 搜索该来源');
    }
    const response = await this.fetcher(url, {
      headers: { 'user-agent': 'Mozilla/5.0 ContentMediaTerminal/0.1' },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new BusinessError('AGENT_EXECUTION_FAILED', `网页读取失败：HTTP ${response.status}`, '记录来源失败并继续其他来源');
    const body = await response.text();
    return {
      url: response.url || url,
      contentType: response.headers.get('content-type') ?? '',
      text: textOnly(body).slice(0, 30_000),
      fetchedAt: new Date().toISOString()
    };
  }
}
