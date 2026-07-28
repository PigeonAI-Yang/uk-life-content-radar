import { describe, expect, test, vi } from 'vitest';
import { WebResearch } from '../src/agent/web-research';

describe('Pi 受控网页研究', () => {
  test('只能读取搜索结果，且正文去除页面标签', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(`<?xml version="1.0"?><rss><channel><item>
        <title>GOV.UK update</title><link>https://www.gov.uk/update</link>
        <description>Official change</description><pubDate>28 Jul 2026</pubDate>
      </item></channel></rss>`))
      .mockResolvedValueOnce(new Response('<html><style>x</style><body><h1>Rule changed</h1><p>From today</p></body></html>', {
        headers: { 'content-type': 'text/html' }
      }));
    const web = new WebResearch(fetcher);
    await expect(web.read('https://example.com/not-searched')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const search = await web.search('UK rule', 5);
    expect(search.items[0]).toMatchObject({ title: 'GOV.UK update', url: 'https://www.gov.uk/update' });
    await expect(web.read(search.items[0].url)).resolves.toMatchObject({ text: 'Rule changed From today' });
  });
});
