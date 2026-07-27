import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody, Textarea } from '@fluentui/react-components';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { $createParagraphNode, $createTextNode, $getRoot, type EditorState } from 'lexical';

type Platform = 'xiaohongshu' | 'douyin' | 'wechat';
type Version = {
  id: string; version: number; platform?: Platform; body: string; outline: string;
  verificationState: string; editState: string; filePath?: string; fileStatus?: string;
};
type Content = {
  id: string; accountId: string; title: string; version: number; versions: Version[];
  resources: { source_id: string }[]; excerpts: { excerpt_id: string }[];
  notes: { note_id: string }[]; assets: { asset_version_id: string }[];
};
type ContentSummary = { id: string; title: string };
type AccountSummary = { id: string; name: string };
type ReferenceChoice = { id: string; label: string };
type AssetChoice = { assetId: string; versionId: string; label: string };

function Editor({ body, readOnly, onChange }: { body: string; readOnly: boolean; onChange: (value: string) => void }) {
  return <LexicalComposer initialConfig={{
    namespace: 'content-editor', editable: !readOnly, onError: (error) => { throw error; },
    editorState: () => {
      const root = $getRoot();
      root.clear();
      root.append($createParagraphNode().append($createTextNode(body)));
    }
  }}>
    <RichTextPlugin contentEditable={<ContentEditable className="lexical-editor" aria-label="内容正文" />}
      placeholder={<span className="editor-placeholder">开始写作…</span>} ErrorBoundary={LexicalErrorBoundary} />
    <HistoryPlugin />
    {!readOnly && <OnChangePlugin onChange={(state: EditorState) => state.read(() => onChange($getRoot().getTextContent()))} />}
  </LexicalComposer>;
}

export function ContentEditorPanel() {
  const [accountId, setAccountId] = useState('');
  const [title, setTitle] = useState('');
  const [contentId, setContentId] = useState('');
  const [content, setContent] = useState<Content>();
  const [tab, setTab] = useState<'common' | Platform>('common');
  const [body, setBody] = useState('');
  const [outline, setOutline] = useState('');
  const [verification, setVerification] = useState('');
  const [dirty, setDirty] = useState(false);
  const [historyVersion, setHistoryVersion] = useState<Version>();
  const [referenceKind, setReferenceKind] = useState<'resource' | 'excerpt' | 'note'>('resource');
  const [referenceId, setReferenceId] = useState('');
  const [reference, setReference] = useState<Record<string, unknown>>();
  const [message, setMessage] = useState('');
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [contentItems, setContentItems] = useState<ContentSummary[]>([]);
  const [referenceChoices, setReferenceChoices] = useState<Record<'resource' | 'excerpt' | 'note', ReferenceChoice[]>>({
    resource: [], excerpt: [], note: []
  });
  const [assetChoices, setAssetChoices] = useState<AssetChoice[]>([]);
  const [assetVersionId, setAssetVersionId] = useState('');
  const [slotView, setSlotView] = useState<'resources' | 'assets' | 'references' | 'verification' | 'preview'>('resources');
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);

  const currentVersion = content?.versions.filter((version) => (version.platform ?? 'common') === tab).at(-1);
  const showVersion = (version?: Version) => {
    setBody(version?.body ?? '');
    setOutline(version?.outline ?? '');
    setVerification(JSON.parse(version?.verificationState ?? '[]').join('\n'));
    setDirty(false);
    setHistoryVersion(undefined);
  };
  useEffect(() => {
    void window.terminal.business.dispatch('account.search', { query: '', limit: 100 }).then(async (result) => {
      if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
      const foundAccounts = (result.result as { items: AccountSummary[] }).items;
      setAccounts(foundAccounts);
      if (foundAccounts[0]) setAccountId(foundAccounts[0].id);
      const details = await Promise.all(foundAccounts.map((account) => window.terminal.business.dispatch('account.get', { id: account.id })));
      const foundContents = details.flatMap((detail) => detail.ok
        ? (detail.result as { usage: { contents: ContentSummary[] } }).usage.contents : []);
      setContentItems(foundContents);
      if (foundContents[0]) {
        const loaded = await window.terminal.business.dispatch('content.get', { id: foundContents[0].id });
        if (loaded.ok) {
          const value = loaded.result as Content;
          setContent(value); setContentId(value.id); setTitle(value.title);
          showVersion(value.versions.filter((version) => !version.platform).at(-1));
        }
      }
    });
    void Promise.all((['resource', 'excerpt', 'note'] as const).map(async (kind) => {
      const result = await window.terminal.business.dispatch(`${kind}.search`, { query: '', limit: 100 });
      return [kind, result.ok ? (result.result as { items: Array<{ id: string; title?: string; text?: string; body?: string }> }).items.map((item) => ({
        id: item.id, label: item.title ?? item.text ?? item.body ?? item.id
      })) : []] as const;
    })).then((entries) => setReferenceChoices(Object.fromEntries(entries) as typeof referenceChoices));
    void window.terminal.business.dispatch('asset.search', { query: '', limit: 100 }).then((result) => {
      if (result.ok) setAssetChoices((result.result as { items: Array<{ id: string; versionId: string; name: string }> }).items
        .map((item) => ({ assetId: item.id, versionId: item.versionId, label: item.name })));
    });
  }, []);

  const load = async (id = contentId) => {
    const result = await window.terminal.business.dispatch('content.get', { id });
    if (result.ok) {
      const value = result.result as Content;
      setContent(value); setContentId(id); setTitle(value.title);
      showVersion(value.versions.filter((version) => !version.platform).at(-1));
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const create = async () => {
    const result = await window.terminal.business.dispatch('content.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), accountId, title
    });
    if (result.ok) {
      const value = result.result as Content; setContent(value); setContentId(value.id);
      setContentItems((current) => [...current, { id: value.id, title: value.title }]);
      showVersion(value.versions.filter((version) => !version.platform).at(-1));
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const save = async () => {
    if (!content) return;
    const result = await window.terminal.business.dispatch('content.save_version', {
      contentId: content.id, expectedVersion: content.version, body, outline,
      verificationItems: verification.split('\n').filter(Boolean), platform: tab === 'common' ? undefined : tab
    });
    if (result.ok) {
      const value = result.result as Content;
      setContent(value); showVersion(value.versions.filter((version) => (version.platform ?? 'common') === tab).at(-1));
      setMessage('已保存；关联的旧批准已失效。');
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const generate = async () => {
    if (!content || tab === 'common') return;
    const result = await window.terminal.business.dispatch('content.generate_platform_version', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), contentId: content.id, platform: tab
    });
    if (result.ok) {
      const value = result.result as Content;
      setContent(value); showVersion(value.versions.filter((version) => version.platform === tab).at(-1));
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const link = async (remove: boolean) => {
    if (!content || !referenceId) return;
    const result = await window.terminal.business.dispatch(`${referenceKind}.${remove ? 'unlink_content' : 'link_content'}`, {
      id: referenceId, contentId: content.id
    });
    if (result.ok) await load(content.id);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const inspectReference = async () => {
    const result = await window.terminal.business.dispatch(`${referenceKind}.get`, { id: referenceId });
    if (result.ok) setReference(result.result as Record<string, unknown>);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const linkAsset = async (remove: boolean) => {
    if (!content || !assetVersionId) return;
    const result = await window.terminal.business.dispatch(remove ? 'content.unlink_asset' : 'content.link_asset', {
      contentId: content.id, assetVersionId, ...(remove ? {} : { order: content.assets.length })
    });
    if (result.ok) await load(content.id);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const fromHistory = async () => {
    if (!historyVersion) return;
    const result = await window.terminal.business.dispatch('content.create_from_version', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), versionId: historyVersion.id, accountId
    });
    if (result.ok) {
      const value = result.result as Content; setContent(value); setContentId(value.id); setTab('common');
      showVersion(value.versions.filter((version) => !version.platform).at(-1));
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };

  const shown = historyVersion ?? currentVersion;
  return <section className="content-workspace">
    {(accounts.length > 0 || contentItems.length > 0) && <div className="object-picker">
      <span>账号：</span>{accounts.map((account) =>
        <Button key={account.id} appearance="subtle" className={account.id === accountId ? 'selected' : ''} onClick={() => setAccountId(account.id)}>{account.name}</Button>)}
      <span>内容：</span>{contentItems.map((item) =>
        <Button key={item.id} appearance="subtle" className={item.id === contentId ? 'selected' : ''} onClick={() => void load(item.id)}>{item.title}</Button>)}
    </div>}
    <div className="settings-row">
      <select aria-label="内容账号" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
        <option value="">选择账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <Input aria-label="内容标题" placeholder="内容标题" value={title} onChange={(_, data) => setTitle(data.value)} />
      <Button onClick={create} disabled={!accountId || !title}>新建内容</Button>
      <select aria-label="内容项目" value={contentId} onChange={(event) => setContentId(event.target.value)}>
        <option value="">选择内容项目</option>{contentItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <Button onClick={() => load()} disabled={!contentId}>载入</Button>
    </div>
    {content && <div className="content-editor-layout">
      <div>
        <div className="settings-row version-tabs" role="tablist" aria-label="内容版本页签">
          {(['common', 'xiaohongshu', 'douyin', 'wechat'] as const).map((item) =>
            <Button role="tab" aria-selected={tab === item} key={item} onClick={() => {
              setTab(item);
              showVersion(content.versions.filter((version) => (version.platform ?? 'common') === item).at(-1));
            }}>
              {item === 'common' ? '公共草稿' : item === 'xiaohongshu' ? '小红书' : item === 'douyin' ? '抖音' : '微信公众号'}
            </Button>)}
          {tab !== 'common' && <Button onClick={generate} disabled={dirty}>生成平台版本</Button>}
        </div>
        <div className={outlineCollapsed ? 'editor-main-layout outline-collapsed' : 'editor-main-layout'}>
          <aside className="outline-panel" aria-label="内容大纲栏">
            <Button appearance="subtle" onClick={() => setOutlineCollapsed((value) => !value)}>{outlineCollapsed ? '展开大纲' : '收起大纲'}</Button>
            {!outlineCollapsed && <Textarea aria-label="内容大纲" placeholder="内容大纲" value={outline} disabled={Boolean(historyVersion)}
              onChange={(_, data) => { setOutline(data.value); setDirty(true); }} />}
          </aside>
          <div className="writing-panel">
            <Editor key={shown?.id ?? `${tab}-empty`} body={shown?.body ?? ''} readOnly={Boolean(historyVersion)}
              onChange={(value) => { setBody(value); setDirty(true); }} />
            <Textarea aria-label="待核验事项" placeholder="每行一项待核验内容" value={verification} disabled={Boolean(historyVersion)}
              onChange={(_, data) => { setVerification(data.value); setDirty(true); }} />
            <div className="settings-row">
              <Button appearance="primary" onClick={save} disabled={!dirty || Boolean(historyVersion)}>保存新版本</Button>
              <span>{historyVersion ? '只读历史版本' : dirty ? '有未保存修改' : '已保存'}</span>
              {historyVersion && <Button onClick={fromHistory}>从此版本创建新内容</Button>}
            </div>
            <details open><summary>版本历史</summary>
              <div className="history-list">{content.versions.map((version) =>
                <Button key={version.id} onClick={() => {
                  showVersion(version); setHistoryVersion(version);
                }}>
                  v{version.version} {version.platform ?? '公共'} · {version.editState}
                </Button>)}</div>
            </details>
          </div>
        </div>
      </div>
      <aside className="resource-slot" aria-label="内容资源槽">
        <h2>资源槽</h2>
        <p>资料 {content.resources.length}｜素材 {content.assets.length}｜摘录 {content.excerpts.length}｜笔记 {content.notes.length}</p>
        <div className="slot-tabs" role="tablist" aria-label="资源槽视图">
          {([
            ['resources', '资料'], ['assets', '素材'], ['references', '引用'],
            ['verification', '待核验'], ['preview', '平台预览']
          ] as const).map(([value, label]) => <Button role="tab" aria-selected={slotView === value} key={value}
            appearance="subtle" className={slotView === value ? 'selected' : ''} onClick={() => setSlotView(value)}>{label}</Button>)}
        </div>
        {slotView === 'resources' && <>
          <select aria-label="资料对象" value={referenceKind === 'resource' ? referenceId : ''} onChange={(event) => {
            setReferenceKind('resource'); setReferenceId(event.target.value);
          }}>
            <option value="">选择资料</option>{referenceChoices.resource.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div className="settings-row resource-actions">
            <Button onClick={() => link(false)}>加入资料</Button><Button onClick={() => link(true)}>移除资料</Button><Button onClick={inspectReference}>查看资料</Button>
          </div>
        </>}
        {slotView === 'assets' && <>
          <select aria-label="素材对象" value={assetVersionId} onChange={(event) => setAssetVersionId(event.target.value)}>
            <option value="">选择素材</option>{assetChoices.map((item) => <option key={item.versionId} value={item.versionId}>{item.label}</option>)}
          </select>
          <div className="settings-row resource-actions">
            <Button onClick={() => linkAsset(false)}>加入素材</Button><Button onClick={() => linkAsset(true)}>移除素材</Button>
          </div>
          <ul>{content.assets.map((item) => <li key={item.asset_version_id}>{assetChoices.find((choice) => choice.versionId === item.asset_version_id)?.label ?? '素材'}</li>)}</ul>
        </>}
        {slotView === 'references' && <>
          <select aria-label="引用类型" value={referenceKind === 'resource' ? 'excerpt' : referenceKind} onChange={(event) => {
            setReferenceKind(event.target.value as 'excerpt' | 'note'); setReferenceId('');
          }}>
            <option value="excerpt">摘录</option><option value="note">笔记</option>
          </select>
          <select aria-label="引用对象" value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>
            <option value="">选择{referenceKind === 'note' ? '笔记' : '摘录'}</option>
            {referenceChoices[referenceKind === 'note' ? 'note' : 'excerpt'].map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div className="settings-row resource-actions">
            <Button onClick={() => link(false)}>加入引用</Button><Button onClick={() => link(true)}>移除引用</Button><Button onClick={inspectReference}>回看原文</Button>
          </div>
        </>}
        {(slotView === 'resources' || slotView === 'references') && reference && <article aria-label="引用原文上下文">
          <h3>{String(reference.title ?? (referenceKind === 'excerpt' ? '摘录' : '笔记'))}</h3>
          <p>{String(reference.body ?? reference.text ?? '')}</p>
          {Boolean(reference.context) && <blockquote>{String(reference.context)}</blockquote>}
        </article>}
        {slotView === 'verification' && (verification ? <ul>{verification.split('\n').filter(Boolean).map((item) => <li key={item}>{item}</li>)}</ul> : <p>没有待核验事项</p>)}
        {slotView === 'preview' && <article><h3>{tab === 'common' ? '公共草稿' : '平台预览'}</h3><p>{body}</p></article>}
      </aside>
    </div>}
    {message && <MessageBar intent={message.includes(':') ? 'error' : 'success'}><MessageBarBody>{message}</MessageBarBody></MessageBar>}
  </section>;
}
