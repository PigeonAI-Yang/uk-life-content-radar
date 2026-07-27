import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody, Textarea } from '@fluentui/react-components';

type Kind = 'resource' | 'excerpt' | 'note';
type Choice = { id: string; label: string };
type SavedView = { id: string; name: string; filters: Record<string, unknown> };
type Item = {
  id: string; title?: string; body?: string; text?: string; context?: string;
  sourceId?: string; canonicalUrl?: string; version: number; status: string;
  usage?: { content_id: string }[]; snapshots?: { url: string; title: string; context: string }[];
  type?: Kind; topic?: string; region?: string; targetAudience?: string; tags?: string[];
  createdAt?: string; updatedAt?: string;
};

export function LibraryPanel() {
  const [kind, setKind] = useState<Kind>('resource');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [contentId, setContentId] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item>();
  const [message, setMessage] = useState('');
  const [topic, setTopic] = useState('');
  const [region, setRegion] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [tags, setTags] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [platform, setPlatform] = useState('');
  const [source, setSource] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sources, setSources] = useState<Choice[]>([]);
  const [contents, setContents] = useState<Choice[]>([]);
  const [accounts, setAccounts] = useState<Choice[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  useEffect(() => {
    void (async () => {
      const dispatch = window.terminal.business.dispatch;
      const [resources, accounts] = await Promise.all([
        dispatch('resource.search', { query: '', limit: 100 }),
        dispatch('account.search', { query: '', limit: 100 })
      ]);
      if (resources.ok) {
        const resourceItems = (resources.result as { items: Item[] }).items;
        setItems(resourceItems);
        setSources(resourceItems.map((item) => ({ id: item.id, label: item.title ?? item.id })));
      }
      if (accounts.ok) {
        const accountItems = (accounts.result as { items: { id: string; name: string }[] }).items;
        setAccounts(accountItems.map((account) => ({ id: account.id, label: account.name })));
        const details = await Promise.all(accountItems.map((account) => dispatch('account.get', { id: account.id })));
        setContents(details.flatMap((detail) => detail.ok
          ? (detail.result as { usage: { contents: { id: string; title: string }[] } }).usage.contents.map((content) => ({ id: content.id, label: content.title }))
          : []));
      }
      const views = await dispatch('saved_view.list', { scope: 'library' });
      if (views.ok) setSavedViews(views.result as SavedView[]);
    })();
  }, []);

  const search = async () => {
    const result = await window.terminal.business.dispatch('search.query', {
      query, types: [kind], topic: topic || undefined, region: region || undefined,
      targetAudience: targetAudience || undefined, tags: tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      source: source || undefined, dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined, dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
      status: filterStatus || undefined, accountId: accountId || undefined, platform: platform || undefined, includeArchived, limit: 100
    });
    if (result.ok) setItems((result.result as { items: Item[] }).items);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };

  const create = async () => {
    const input = kind === 'resource'
      ? { caller: 'ui', idempotencyKey: crypto.randomUUID(), title, body, topic, region, targetAudience, tags: tags ? tags.split(',') : [] }
      : kind === 'excerpt'
        ? { sourceId, text: body, context: '用户在资料库创建', topic, region, targetAudience, tags: tags ? tags.split(',') : [] }
        : { body, sourceId: sourceId || undefined, contentId: contentId || undefined, topic, region, targetAudience, tags: tags ? tags.split(',') : [] };
    const result = await window.terminal.business.dispatch(`${kind}.create`, input);
    if (result.ok) {
      const created = result.result as Item;
      setSelected(created);
      if (kind === 'resource') setSources((current) => [...current, { id: created.id, label: created.title ?? created.id }]);
      await search();
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const select = async (item: Item) => {
    const result = await window.terminal.business.dispatch(`${item.type ?? kind}.get`, { id: item.id });
    if (result.ok) {
      const detail = result.result as Item;
      setSelected(detail);
      setTitle(detail.title ?? '');
      setBody(detail.body ?? detail.text ?? '');
      setSourceId(detail.sourceId ?? '');
    }
  };
  const saveView = async () => {
    const result = await window.terminal.business.dispatch('saved_view.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), name: `资料视图 ${new Date().toLocaleTimeString()}`, scope: 'library',
      filters: { query, types: [kind], topic: topic || undefined, region: region || undefined,
        targetAudience: targetAudience || undefined, tags: tags ? tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        source: source || undefined, dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined, dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
        status: filterStatus || undefined, accountId: accountId || undefined, platform: platform || undefined, includeArchived, limit: 100 }
    });
    if (result.ok) {
      const view = result.result as SavedView;
      setSavedViews((current) => [...current, view]);
      setMessage(`视图已保存：${view.name}`);
    } else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const applyView = async (id: string) => {
    const view = savedViews.find((item) => item.id === id);
    if (!view) return;
    const filters = view.filters;
    const types = filters.types as Kind[] | undefined;
    setKind(types?.[0] ?? 'resource');
    setQuery(String(filters.query ?? ''));
    setTopic(String(filters.topic ?? ''));
    setRegion(String(filters.region ?? ''));
    setTargetAudience(String(filters.targetAudience ?? ''));
    setTags((filters.tags as string[] | undefined)?.join(',') ?? '');
    setSource(String(filters.source ?? ''));
    setDateFrom(String(filters.dateFrom ?? '').slice(0, 10));
    setDateTo(String(filters.dateTo ?? '').slice(0, 10));
    setFilterStatus(String(filters.status ?? ''));
    setAccountId(String(filters.accountId ?? ''));
    setPlatform(String(filters.platform ?? ''));
    setIncludeArchived(Boolean(filters.includeArchived));
    const result = await window.terminal.business.dispatch('search.query', filters);
    if (result.ok) setItems((result.result as { items: Item[] }).items);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const update = async () => {
    if (!selected) return;
    const input = kind === 'resource'
      ? { id: selected.id, expectedVersion: selected.version, title: title || selected.title, body: body || selected.body }
      : kind === 'excerpt'
        ? { id: selected.id, expectedVersion: selected.version, text: body || selected.text, context: selected.context ?? '' }
        : { id: selected.id, expectedVersion: selected.version, body: body || selected.body };
    const result = await window.terminal.business.dispatch(`${kind}.update`, input);
    if (result.ok) { setSelected(result.result as Item); await search(); }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const status = async (action: 'archive' | 'restore') => {
    if (!selected) return;
    const result = await window.terminal.business.dispatch(`${kind}.${action}`, { id: selected.id, expectedVersion: selected.version });
    if (result.ok) { setSelected(result.result as Item); await search(); }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const link = async (remove: boolean) => {
    if (!selected || !contentId) return;
    const result = await window.terminal.business.dispatch(`${kind}.${remove ? 'unlink_content' : 'link_content'}`, { id: selected.id, contentId });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    const readback = await window.terminal.business.dispatch(`${kind}.get`, { id: selected.id });
    if (readback.ok) setSelected(readback.result as Item);
    else setMessage(`${readback.error.code}: ${readback.error.message}`);
  };

  return (
    <section className="library-panel">
      <div className="settings-row">
        <select aria-label="资料对象类型" value={kind} onChange={(event) => { setKind(event.target.value as Kind); setItems([]); setSelected(undefined); }}>
          <option value="resource">资料</option><option value="excerpt">摘录</option><option value="note">笔记</option>
        </select>
        <Input aria-label="资料库搜索" value={query} onChange={(_, data) => setQuery(data.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} />
        <Button onClick={search}>搜索</Button>
        <Button onClick={saveView}>保存视图</Button>
        <select aria-label="已保存视图" defaultValue="" onChange={(event) => void applyView(event.target.value)}>
          <option value="">应用保存视图</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
        </select>
      </div>
      <div className="settings-row library-filters">
        <Input aria-label="主题筛选" placeholder="主题" value={topic} onChange={(_, data) => setTopic(data.value)} />
        <Input aria-label="地区筛选" placeholder="地区" value={region} onChange={(_, data) => setRegion(data.value)} />
        <Input aria-label="人群筛选" placeholder="目标人群" value={targetAudience} onChange={(_, data) => setTargetAudience(data.value)} />
        <Input aria-label="标签筛选" placeholder="标签，逗号分隔" value={tags} onChange={(_, data) => setTags(data.value)} />
        <select aria-label="来源筛选" value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">全部来源</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <input type="date" aria-label="开始日期筛选" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <input type="date" aria-label="结束日期筛选" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <select aria-label="账号筛选" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          <option value="">全部账号</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <select aria-label="平台筛选" value={platform} onChange={(event) => setPlatform(event.target.value)}>
          <option value="">全部平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option><option value="wechat">微信公众号</option>
        </select>
        <select aria-label="状态筛选" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
          <option value="">全部状态</option><option value="active">正常</option><option value="archived">已归档</option>
        </select>
        <label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />包括归档</label>
      </div>
      <div className="settings-row">
        {kind === 'resource' && <Input aria-label="资料标题" placeholder="标题" value={title} onChange={(_, data) => setTitle(data.value)} />}
        {kind !== 'resource' && <select aria-label="来源资料" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">选择来源资料</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
        </select>}
        {kind === 'note' && <select aria-label="笔记所属内容" value={contentId} onChange={(event) => setContentId(event.target.value)}>
          <option value="">不关联内容</option>{contents.map((content) => <option key={content.id} value={content.id}>{content.label}</option>)}
        </select>}
        <Textarea aria-label="资料正文" placeholder={kind === 'excerpt' ? '摘录文字' : '正文'} value={body} onChange={(_, data) => setBody(data.value)} />
        <Button appearance="primary" disabled={!body || (kind === 'resource' && !title) || (kind === 'excerpt' && !sourceId)} onClick={create}>新建{kind === 'resource' ? '资料' : kind === 'excerpt' ? '摘录' : '笔记'}</Button>
      </div>
      <div className="library-layout">
        <div className="library-list" role="list">
          {!items.length && <p>搜索无结果</p>}
          {items.map((item) => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => void select(item)} onDoubleClick={() => void select(item)}>
            <strong>{item.title ?? item.text ?? item.body}</strong>
            <span>{item.canonicalUrl ?? item.sourceId ?? '本地'} · {item.status} · 使用 {item.usage?.length ?? 0} 次</span>
          </button>)}
        </div>
        {selected && <aside className="library-reader" aria-label="资料阅读器">
          <Button appearance="subtle" onClick={() => setSelected(undefined)}>关闭阅读器</Button>
          <h2>{selected.title ?? (kind === 'excerpt' ? '摘录' : '笔记')}</h2>
          <p>来源：{selected.canonicalUrl ? new URL(selected.canonicalUrl).hostname : '本地资料'}｜更新：{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '未知'}｜状态：{selected.status}</p>
          <p>{selected.body ?? selected.text}</p>
          {selected.context && <details><summary>来源上下文</summary><p>{selected.context}</p></details>}
          <select aria-label="关联内容" value={contentId} onChange={(event) => setContentId(event.target.value)}>
            <option value="">选择内容项目</option>{contents.map((content) => <option key={content.id} value={content.id}>{content.label}</option>)}
          </select>
          <div className="settings-row">
            {selected.canonicalUrl && <Button onClick={() => window.terminal.system.openExternal(selected.canonicalUrl ?? '')}>查看原文</Button>}
            {kind === 'resource' && <Button onClick={() => { setKind('excerpt'); setSourceId(selected.id); setBody(''); setSelected(undefined); }}>摘录</Button>}
            <Button onClick={update}>保存更新</Button>
            <Button onClick={() => status(selected.status === 'archived' ? 'restore' : 'archive')}>{selected.status === 'archived' ? '恢复' : '归档'}</Button>
            <Button onClick={() => link(false)}>加入内容</Button>
            <Button onClick={() => link(true)}>移除关联</Button>
          </div>
          <details><summary>用于哪些内容</summary>
            {(selected.usage ?? []).length
              ? <ul>{(selected.usage ?? []).map((usage) => <li key={usage.content_id}>{contents.find((content) => content.id === usage.content_id)?.label ?? '内容项目'}</li>)}</ul>
              : <p>尚未用于任何内容</p>}
          </details>
        </aside>}
      </div>
      {message && <MessageBar intent="error"><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    </section>
  );
}
