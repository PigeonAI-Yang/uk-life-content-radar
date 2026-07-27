import { useCallback, useEffect, useState } from 'react';
import { Button, MessageBar, MessageBarBody } from '@fluentui/react-components';

type Platform = 'xiaohongshu' | 'douyin' | 'wechat';
type Candidate = { id: string; platform: Platform; title: string; digest: string; body: string; tags: string[]; assets: { filePath: string }[]; sources: { title: string; url: string }[] };
type Pack = { id: string; directoryPath: string };
type Choice = { id: string; label: string };
type Approval = { status: 'pending' | 'approved' | 'stale'; currentFingerprint: string; approvedAt?: string };

export function PublishingPanel() {
  const [accountId, setAccountId] = useState('');
  const [contentVersionId, setContentVersionId] = useState('');
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [candidateId, setCandidateId] = useState('');
  const [candidate, setCandidate] = useState<Candidate>();
  const [pack, setPack] = useState<Pack>();
  const [approval, setApproval] = useState<Approval>();
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [platform, setPlatform] = useState<Platform>('xiaohongshu');
  const [accounts, setAccounts] = useState<Choice[]>([]);
  const [versions, setVersions] = useState<Choice[]>([]);
  const [assets, setAssets] = useState<Choice[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const dispatch = window.terminal.business.dispatch;
  const refreshCandidates = async () => {
    const result = await dispatch('package.list_candidates', { query: '', limit: 100 });
    if (result.ok) setCandidates((result.result as { items: Candidate[] }).items);
  };
  const loadVersions = useCallback(async (id: string) => {
    setAccountId(id); setContentVersionId('');
    const detail = await dispatch('account.get', { id });
    const contentItems = detail.ok ? (detail.result as { usage: { contents: Choice[] } }).usage.contents : [];
    const contentDetails = await Promise.all(contentItems.map((item) => dispatch('content.get', { id: item.id })));
    const versionItems = contentDetails.flatMap((content) => content.ok
      ? (content.result as { title: string; versions: { id: string; version: number; platform?: string }[] }).versions
        .map((version) => ({ id: version.id, label: `${(content.result as { title: string }).title} · v${version.version}${version.platform ? ` · ${version.platform}` : ''}` }))
      : []);
    setVersions(versionItems);
    if (versionItems[0]) setContentVersionId(versionItems[0].id);
  }, [dispatch]);
  useEffect(() => {
    void (async () => {
      const send = window.terminal.business.dispatch;
      const [accountResult, assetResult] = await Promise.all([
        send('account.search', { query: '', limit: 100 }),
        send('asset.search', { query: '', limit: 100 })
      ]);
      const accountItems = accountResult.ok ? (accountResult.result as { items: Choice[] }).items : [];
      const assetItems = assetResult.ok ? (assetResult.result as { items: { id: string; name: string; versionId: string }[] }).items : [];
      setAccounts(accountItems.map((item) => ({ id: item.id, label: item.label ?? (item as Choice & { name?: string }).name ?? item.id })));
      setAssets(assetItems.map((item) => ({ id: item.versionId, label: item.name })));
      if (accountItems[0]) await loadVersions(accountItems[0].id);
      if (assetItems.length) setAssetIds(assetItems.map((item) => item.versionId));
      const candidateResult = await send('package.list_candidates', { query: '', limit: 100 });
      if (candidateResult.ok) setCandidates((candidateResult.result as { items: Candidate[] }).items);
    })();
  }, [loadVersions]);
  useEffect(() => {
    void Promise.all((candidate?.assets ?? []).map((asset) => window.terminal.system.imageData(asset.filePath))).then(setPreviewImages);
  }, [candidate]);

  const preview = async () => {
    const result = await dispatch('package.create_preview', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), accountId, platform,
      contentVersionId, assetVersionIds: assetIds, templateVersion: `${platform}-v1`
    });
    if (result.ok) { setCandidate(result.result as Candidate); setApproval(undefined); }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const loadCandidate = async () => {
    const result = await dispatch('package.list_candidates', { query: '', limit: 100 });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    const found = (result.result as { items: Candidate[] }).items.find((item) => item.id === candidateId);
    if (found) setCandidate(found);
    else setMessage('未找到发布候选');
  };
  const act = async (name: string) => {
    if (!candidate) return;
    const result = await dispatch(name, { candidateId: candidate.id });
    if (result.ok) setApproval(result.result as Approval);
    setMessage(result.ok ? (name === 'approval.approve' ? '人工批准已绑定当前指纹' : '等待人工批准') : `${result.error.code}: ${result.error.message}`);
  };
  const build = async () => {
    if (!candidate) return;
    const result = await dispatch('package.build', { caller: 'ui', idempotencyKey: crypto.randomUUID(), candidateId: candidate.id });
    if (result.ok) setPack(result.result as Pack);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };

  return (
    <section className="publishing-panel">
      <div className="panel-heading"><div><h2>三平台发布包</h2><p>选择正文和有序图片，人工批准后生成真实磁盘产物</p></div></div>
      <div className="publishing-controls">
        <select aria-label="发布平台" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
          <option value="xiaohongshu">小红书</option><option value="douyin">抖音图文</option><option value="wechat">微信公众号</option>
        </select>
        <select aria-label="发布账号" value={accountId} onChange={(event) => void loadVersions(event.target.value)}>
          <option value="">选择账号</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <select aria-label="正文版本" value={contentVersionId} onChange={(event) => setContentVersionId(event.target.value)}>
          <option value="">选择正文版本</option>{versions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <select multiple aria-label="发布图片" value={assetIds} onChange={(event) =>
          setAssetIds([...event.currentTarget.selectedOptions].map((option) => option.value))}>
          {assets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <ol className="ordered-assets">{assetIds.map((id, index) => <li key={id}>
        <span>{assets.find((item) => item.id === id)?.label ?? `图片 ${index + 1}`}</span>
        <Button aria-label={`上移图片 ${index + 1}`} disabled={!index} onClick={() => setAssetIds((current) => current.map((item, itemIndex) => itemIndex === index - 1 ? id : itemIndex === index ? current[index - 1] : item))}>↑</Button>
        <Button aria-label={`下移图片 ${index + 1}`} disabled={index === assetIds.length - 1} onClick={() => setAssetIds((current) => current.map((item, itemIndex) => itemIndex === index + 1 ? id : itemIndex === index ? current[index + 1] : item))}>↓</Button>
      </li>)}</ol>
      <Button appearance="primary" disabled={!accountId || !contentVersionId} onClick={preview}>生成预览</Button>
      <div className="settings-row">
        <select aria-label="待批准候选" value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
          <option value="">选择候选</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.platform}</option>)}
        </select>
        <Button onClick={refreshCandidates}>刷新候选</Button>
        <Button onClick={loadCandidate}>加载候选</Button>
      </div>
      {candidate && <article className={`platform-preview ${candidate.platform}`}>
        <p className="preview-kicker">{candidate.platform === 'xiaohongshu' ? '小红书预览' : candidate.platform === 'douyin' ? '抖音图文预览' : '微信公众号长文预览'}</p>
        <h3>{candidate.title}</h3>{candidate.platform === 'wechat' && <p className="preview-digest">{candidate.digest}</p>}<p>{candidate.body}</p><p>{candidate.tags.join(' ')}</p>
        <p>来源：{candidate.sources.map((source) => source.title).join('、') || '无关联来源'}</p>
        <div className="preview-images">{previewImages.map((src, index) => <figure key={candidate.assets[index].filePath}><img src={src} alt={`发布图片 ${index + 1}`} /><figcaption>{index + 1}</figcaption></figure>)}</div>
        <p>批准状态：{approval?.status === 'approved' ? '已批准' : approval?.status === 'stale' ? '已失效' : '未批准'}</p>
        <div className="settings-row">
          <Button onClick={() => act('package.request_approval')}>请求批准</Button>
          <Button appearance="primary" onClick={() => act('approval.approve')}>人工批准</Button>
          <Button disabled={approval?.status !== 'approved'} onClick={build}>生成发布包</Button>
        </div>
      </article>}
      {message && <MessageBar><MessageBarBody>{message}</MessageBarBody></MessageBar>}
      {pack && <div className="settings-row">
        <Button onClick={() => window.terminal.system.openPath(pack.directoryPath)}>打开目录</Button>
        <Button onClick={async () => {
          const text = await dispatch('package.copy_text', { id: pack.id });
          if (text.ok) await window.terminal.system.copyText((text.result as { text: string }).text);
        }}>复制正文</Button>
      </div>}
    </section>
  );
}
