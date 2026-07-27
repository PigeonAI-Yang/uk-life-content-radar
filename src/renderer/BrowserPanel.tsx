import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody } from '@fluentui/react-components';

type Tab = { id: string; url: string; title: string; status: string; error?: string };
type Receipt = {
  ok: boolean;
  result?: {
    status: string;
    kind?: string;
    destination?: string;
    code?: string;
    existing?: { title: string };
    object?: { name?: string; title?: string; filePath?: string };
  };
  error?: { code: string; message: string; remediation?: string };
};

export function BrowserPanel() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [address, setAddress] = useState('');
  const [find, setFind] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [destination, setDestination] = useState('library');
  const [receipt, setReceipt] = useState<Receipt>();

  const refresh = async () => {
    const result = await window.terminal.business.dispatch('browser.tabs.list', {});
    if (result.ok) {
      const value = result.result as { items: Tab[]; activeId?: string };
      setTabs(value.items);
      if (value.activeId) {
        setActiveId(value.activeId);
        const active = value.items.find((tab) => tab.id === value.activeId);
        if (active) setAddress(active.url);
      }
    }
  };

  useEffect(() => {
    void window.terminal.browser.visible(true);
    void (async () => {
      const listed = await window.terminal.business.dispatch('browser.tabs.list', {});
      if (listed.ok && !(listed.result as { items: Tab[] }).items.length) await window.terminal.browser.create();
      await refresh();
    })();
    return () => { void window.terminal.browser.visible(false); };
  }, []);

  const collect = async (name: string) => {
    const isFile = name === 'collect.image' || name === 'collect.download';
    const result = await window.terminal.business.dispatch(name, {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), tabId: activeId,
      ...(isFile ? { resourceUrl } : {}),
      destination: isFile ? (destination === 'content' ? 'content' : 'assets') : (destination === 'content' ? 'content' : 'library')
    });
    setReceipt(result as Receipt);
    await refresh();
  };

  return (
    <section className="browser-panel">
      <div className="settings-row">
        <Button onClick={async () => { const tab = await window.terminal.browser.create(); setActiveId(tab.id); await refresh(); }}>新建标签</Button>
        {tabs.map((tab) => <Button key={tab.id} appearance="subtle" className={tab.id === activeId ? 'selected' : ''} onClick={async () => {
          await window.terminal.browser.activate(tab.id); setActiveId(tab.id); setAddress(tab.url);
        }}>{tab.title || '新标签页'}</Button>)}
      </div>
      <div className="settings-row">
        <Button aria-label="后退" onClick={() => window.terminal.browser.back(activeId)}>←</Button>
        <Button aria-label="前进" onClick={() => window.terminal.browser.forward(activeId)}>→</Button>
        <Button aria-label="刷新网页" onClick={() => window.terminal.browser.reload(activeId)}>刷新</Button>
        <Input aria-label="浏览器地址" value={address} onChange={(_, data) => setAddress(data.value)} onKeyDown={async (event) => {
          if (event.key === 'Enter') { await window.terminal.browser.navigate(activeId, address); await refresh(); }
        }} />
        <Input aria-label="网页内查找" placeholder="网页内查找" value={find} onChange={(_, data) => setFind(data.value)} />
        <Button onClick={() => window.terminal.browser.find(activeId, find)}>查找</Button>
      </div>
      <div className="settings-row">
        <select aria-label="收集落点" value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="library">资料库</option><option value="assets">素材库</option><option value="content">内容项目</option>
        </select>
        <Button onClick={() => collect('collect.webpage')}>收藏网页</Button>
        <Button onClick={() => collect('collect.selection')}>摘录选中内容</Button>
        <Input aria-label="图片或下载地址" placeholder="图片或下载地址" value={resourceUrl} onChange={(_, data) => setResourceUrl(data.value)} />
        <Button onClick={() => collect('collect.image')}>保存图片</Button>
        <Button onClick={() => collect('collect.download')}>接管下载文件</Button>
      </div>
      {tabs.find((tab) => tab.id === activeId)?.status !== 'ready' && <MessageBar intent="warning"><MessageBarBody>
        页面状态：{tabs.find((tab) => tab.id === activeId)?.status ?? 'loading'}
      </MessageBarBody></MessageBar>}
      {receipt && <MessageBar intent={receipt.ok ? 'success' : 'error'}><MessageBarBody>
        <div data-testid="collection-receipt" data-result={JSON.stringify(receipt)}>
          {receipt.ok
            ? receipt.result?.status === 'duplicate'
              ? `已收藏过：${receipt.result.existing?.title ?? '同一网址'}`
              : `已收集到${receipt.result?.destination === 'content' ? '内容项目' : receipt.result?.destination === 'assets' ? '素材库' : '资料库'}：${receipt.result?.object?.title ?? receipt.result?.object?.name ?? '新对象'}`
            : `${receipt.error?.code ?? 'COLLECT_FAILED'}：${receipt.error?.message ?? '收集失败'}${receipt.error?.remediation ? `。${receipt.error.remediation}` : ''}`}
          {receipt.ok && receipt.result?.object?.filePath && <Button onClick={() => window.terminal.system.openPath(receipt.result?.object?.filePath ?? '')}>打开文件</Button>}
        </div>
      </MessageBarBody></MessageBar>}
    </section>
  );
}
