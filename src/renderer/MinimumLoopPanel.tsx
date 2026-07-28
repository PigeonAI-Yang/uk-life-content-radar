import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody, Textarea } from '@fluentui/react-components';

export function MinimumLoopPanel() {
  const [sourcePath, setSourcePath] = useState('');
  const [assetPath, setAssetPath] = useState('');
  const [body, setBody] = useState('英国生活第一篇');
  const [result, setResult] = useState('');
  const [dashboard, setDashboard] = useState<{
    continueCreating: { id: string; title: string }[];
    intelligence: { id: string; title: string }[];
    scanStatus: string;
    pending: { id: string; type: string; status: string }[];
    failures: { id: string; type: string; status: string }[];
  }>();
  const statusNames: Record<string, string> = {
    queued: '排队中', running: '执行中', failed: '失败', partial: '部分成功', interrupted: '已中断', cancelled: '已取消'
  };
  const typeNames: Record<string, string> = { 'file.write': '写入文件（file.write）', 'file.write_batch': '批量写入文件（file.write_batch）' };
  const taskText = (item: { type: string; status: string }) => `${typeNames[item.type] ?? item.type} · ${statusNames[item.status] ?? item.status}`;

  const refreshDashboard = async () => {
    const dispatch = window.terminal.business.dispatch;
    const [accounts, tasks, intelligence, scan] = await Promise.all([
      dispatch('account.search', { query: '', limit: 25 }),
      dispatch('task.list', { query: '', limit: 25 }),
      dispatch('intelligence.list', { status: 'candidate', limit: 25 }),
      dispatch('intelligence.scan_status', {})
    ]);
    const failed = [accounts, tasks, intelligence, scan].find((response) => !response.ok);
    if (failed && !failed.ok) return setResult(`${failed.error.code}: ${failed.error.message}`);
    const accountItems = accounts.ok ? (accounts.result as { items: { id: string }[] }).items : [];
    const accountDetails = await Promise.all(accountItems.map((account) => dispatch('account.get', { id: account.id })));
    const taskItems = tasks.ok ? (tasks.result as { items: { id: string; type: string; status: string }[] }).items : [];
    const intelligenceItems = intelligence.ok ? (intelligence.result as { items: { id: string; title: string }[] }).items : [];
    const latestScan = scan.ok ? (scan.result as { latest: { status: string } | null }).latest : null;
    setDashboard({
      continueCreating: accountDetails.flatMap((response) => response.ok ? (response.result as { usage: { contents: { id: string; title: string }[] } }).usage.contents : []),
      intelligence: intelligenceItems,
      scanStatus: latestScan?.status ?? 'not_started',
      pending: taskItems.filter((task) => ['queued', 'running'].includes(task.status)),
      failures: taskItems.filter((task) => ['failed', 'partial', 'interrupted', 'cancelled'].includes(task.status))
    });
  };

  useEffect(() => {
    const dispatch = window.terminal.business.dispatch;
    void Promise.all([
      dispatch('account.search', { query: '', limit: 25 }),
      dispatch('task.list', { query: '', limit: 25 }),
      dispatch('intelligence.list', { status: 'candidate', limit: 25 }),
      dispatch('intelligence.scan_status', {})
    ]).then(async ([accounts, tasks, intelligence, scan]) => {
      if (!accounts.ok || !tasks.ok || !intelligence.ok || !scan.ok) return;
      const accountDetails = await Promise.all((accounts.result as { items: { id: string }[] }).items.map((account) => dispatch('account.get', { id: account.id })));
      const taskItems = (tasks.result as { items: { id: string; type: string; status: string }[] }).items;
      const intelligenceItems = (intelligence.result as { items: { id: string; title: string }[] }).items;
      const latestScan = (scan.result as { latest: { status: string } | null }).latest;
      setDashboard({
        continueCreating: accountDetails.flatMap((response) => response.ok ? (response.result as { usage: { contents: { id: string; title: string }[] } }).usage.contents : []),
        intelligence: intelligenceItems,
        scanStatus: latestScan?.status ?? 'not_started',
        pending: taskItems.filter((task) => ['queued', 'running'].includes(task.status)),
        failures: taskItems.filter((task) => ['failed', 'partial', 'interrupted', 'cancelled'].includes(task.status))
      });
    });
  }, []);

  const create = async () => {
    const dispatch = window.terminal.business.dispatch;
    const account = await dispatch('account.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), name: '英国生活账号', positioning: '英国生活', audience: '在英华人', tone: '清楚'
    });
    if (!account.ok) return setResult(`${account.error.code}: ${account.error.message}`);
    const accountId = (account.result as { id: string }).id;
    const resource = await dispatch('resource.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), title: '本地资料', body: '', filePath: sourcePath
    });
    const asset = await dispatch('asset.import', { caller: 'ui', idempotencyKey: crypto.randomUUID(), filePath: assetPath });
    const content = await dispatch('content.create', { caller: 'ui', idempotencyKey: crypto.randomUUID(), accountId, title: '英国生活内容' });
    if (!resource.ok || !asset.ok || !content.ok) {
      const failed = [resource, asset, content].find((item) => !item.ok);
      return setResult(failed && !failed.ok ? `${failed.error.code}: ${failed.error.message}` : '创建失败');
    }
    const contentId = (content.result as { id: string }).id;
    const assetVersionId = (asset.result as { versionId: string }).versionId;
    await dispatch('content.save_version', { contentId, expectedVersion: 1, body });
    await dispatch('content.generate_platform_version', { caller: 'ui', idempotencyKey: crypto.randomUUID(), contentId, platform: 'xiaohongshu' });
    await dispatch('content.link_resource', { contentId, resourceId: (resource.result as { id: string }).id });
    const linked = await dispatch('content.link_asset', { contentId, assetVersionId, order: 0 });
    setResult(linked.ok ? '快速开始已完成，可从内容、资料库和素材库继续编辑。' : `${linked.error.code}: ${linked.error.message}`);
    await refreshDashboard();
  };

  return (
    <section className="dashboard-panel">
      <div className="panel-heading"><div><h2>今天从这里继续</h2><p>数据来自本地业务根目录和真实任务状态</p></div><Button onClick={refreshDashboard}>刷新状态</Button></div>
      {dashboard && <>
        <div className="dashboard-metrics">
          <article><span>待处理情报</span><strong>{dashboard.intelligence.length}</strong><small>{dashboard.intelligence[0]?.title ?? '暂无候选'}</small></article>
          <article><span>扫描状态</span><strong>{dashboard.scanStatus === 'succeeded' ? '正常' : dashboard.scanStatus === 'partial' ? '部分成功' : dashboard.scanStatus === 'failed' ? '失败' : '未运行'}</strong><small>成功与失败来源均保留</small></article>
          <article><span>待继续内容</span><strong>{dashboard.continueCreating.length}</strong><small>{dashboard.continueCreating[0]?.title ?? '暂无内容'}</small></article>
          <article><span>待处理任务</span><strong>{dashboard.pending.length}</strong><small>{dashboard.pending[0] ? taskText(dashboard.pending[0]) : '没有运行中任务'}</small></article>
        </div>
        <div className="dashboard-columns">
          <div><h3>最近工作</h3>
            <div className="compact-list">{dashboard.continueCreating.length
              ? dashboard.continueCreating.slice(0, 6).map((item) => <div key={item.id}><strong>{item.title}</strong><span>内容 · 可继续编辑</span></div>)
              : <p className="empty-copy">还没有内容，使用下方快速开始创建第一篇。</p>}</div>
          </div>
          <aside><h3>下一步</h3>
            <div className="compact-list">
              <div><strong>处理情报候选</strong><span>{dashboard.intelligence.length} 条待判断</span></div>
              <div><strong>继续编辑内容</strong><span>{dashboard.continueCreating.length} 篇可继续</span></div>
              <div><strong>检查失败任务</strong><span>{dashboard.failures.length} 项需要处理</span></div>
            </div>
          </aside>
        </div>
      </>}
      {(!dashboard || dashboard.continueCreating.length === 0) && <details className="quick-start" open>
        <summary>首次快速开始</summary>
        <h2>快速开始</h2>
        <div className="settings-row">
          <Input aria-label="本地资料路径" placeholder="本地资料绝对路径" value={sourcePath} onChange={(_, data) => setSourcePath(data.value)} />
          <Input aria-label="原始图片路径" placeholder="原始图片绝对路径" value={assetPath} onChange={(_, data) => setAssetPath(data.value)} />
        </div>
        <Textarea aria-label="公共草稿正文" value={body} onChange={(_, data) => setBody(data.value)} />
        <Button appearance="primary" disabled={!sourcePath || !assetPath} onClick={create}>创建账号、资料、内容与素材</Button>
      </details>}
      {result && <MessageBar><MessageBarBody><pre>{result}</pre></MessageBarBody></MessageBar>}
    </section>
  );
}
