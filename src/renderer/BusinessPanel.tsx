import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody, Select, Textarea } from '@fluentui/react-components';

type Account = { id: string; name: string };
type FileReadback = { filePath: string; byteSize: number; fileMtime: string; fileStatus: string };
type Product = {
  id: string; name: string; targetCustomer: string; problem: string; priceRange: string;
  serviceScope: string; suitableFor: string; unsuitableFor: string; version: number;
  versionFile: FileReadback;
};
type Proposal = {
  id: string; productId: string | null; rationale: string; successMeasure: string;
  proposed: Record<string, unknown>; evidence: string[]; status: string; version: number;
  approvedStrategy: { versionFile: FileReadback } | null;
};
type Lead = {
  id: string; nickname: string; platform: string; stage: string; coreNeed: string;
  nextAction: string; nextFollowUpAt: string | null; version: number;
  sourceContent: { id: string; title: string } | null; product: { id: string; name: string } | null;
  conversations: { id: string; summary: string; confirmationStatus: string; originalFile: FileReadback }[];
};
type IntelligenceCandidate = {
  id: string; title: string; audience: string; impact: string; timeliness: string;
  verificationStatus: string; discoveredAt: string; publishBefore: string | null; status: string;
};
type ContentItem = { id: string; title: string };
type Deal = { id: string; nickname: string; outcome: string; amount_minor: number | null; currency: string; reason: string };

export function BusinessPanel() {
  const [activeSection, setActiveSection] = useState<'today' | 'customers' | 'content' | 'product'>('today');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [candidates, setCandidates] = useState<IntelligenceCandidate[]>([]);
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [message, setMessage] = useState('');
  const [product, setProduct] = useState({
    name: '', targetCustomer: '', problem: '', priceRange: '', serviceScope: '',
    suitableFor: '', unsuitableFor: ''
  });
  const [rationale, setRationale] = useState('');
  const [strategyReason, setStrategyReason] = useState('');
  const [successMeasure, setSuccessMeasure] = useState('');
  const [lead, setLead] = useState({ nickname: '', coreNeed: '', intent: '', nextAction: '' });
  const [conversation, setConversation] = useState({ leadId: '', text: '', summary: '' });
  const [deal, setDeal] = useState({ leadId: '', outcome: 'won', amount: '', reason: '', contentInsight: '' });
  const [metrics, setMetrics] = useState({ contentId: '', views: '', likes: '', saves: '', comments: '', messages: '' });

  const load = async (selected: string) => {
    if (!selected) return;
    const [productResult, strategyResult, leadResult, intelligenceResult, contentResult, dealResult] = await Promise.all([
      window.terminal.business.dispatch('product.list', { accountId: selected }),
      window.terminal.business.dispatch('strategy.list', { accountId: selected }),
      window.terminal.business.dispatch('lead.list', { accountId: selected }),
      window.terminal.business.dispatch('intelligence.list', { limit: 25 }),
      window.terminal.business.dispatch('search.query', {
        query: '', types: ['content'], accountId: selected, includeArchived: true, limit: 100
      }),
      window.terminal.business.dispatch('deal.list', { accountId: selected })
    ]);
    if (productResult.ok) setProducts((productResult.result as { items: Product[] }).items);
    if (strategyResult.ok) setProposals((strategyResult.result as { items: Proposal[] }).items);
    if (leadResult.ok) setLeads((leadResult.result as { items: Lead[] }).items);
    if (intelligenceResult.ok) setCandidates((intelligenceResult.result as { items: IntelligenceCandidate[] }).items);
    if (contentResult.ok) setContents((contentResult.result as { items: ContentItem[] }).items);
    if (dealResult.ok) setDeals((dealResult.result as { items: Deal[] }).items);
  };

  useEffect(() => {
    void window.terminal.business.dispatch('account.search', { query: '', limit: 100 }).then((result) => {
      if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
      const found = (result.result as { items: Account[] }).items;
      setAccounts(found);
      if (found[0]) {
        setAccountId(found[0].id);
        void load(found[0].id);
      }
    });
  }, []);

  const createProduct = async () => {
    const result = await window.terminal.business.dispatch('product.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), accountId, ...product
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage('产品已保存，并写入可见版本文件。');
    setProduct({ name: '', targetCustomer: '', problem: '', priceRange: '', serviceScope: '', suitableFor: '', unsuitableFor: '' });
    await load(accountId);
  };

  const propose = async () => {
    const result = await window.terminal.business.dispatch('strategy.propose', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), accountId,
      productId: products[0]?.id, proposalType: 'conversion',
      proposed: { direction: rationale }, rationale: strategyReason || rationale, evidence: [], successMeasure
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage('建议已记录，批准前不会成为正式经营策略。');
    setRationale(''); setStrategyReason(''); setSuccessMeasure('');
    await load(accountId);
  };

  const approve = async (item: Proposal) => {
    const result = await window.terminal.business.dispatch('strategy.approve', {
      id: item.id, expectedVersion: item.version
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    const handoff = result.result as {
      agentTask: { id: string; status: string } | null;
      dispatchError: { code: string; message: string } | null;
    };
    setMessage(handoff.agentTask
      ? `策略已批准，Pi 接力任务 ${handoff.agentTask.id.slice(0, 8)} 已进入队列。可到“任务”查看。`
      : `策略已批准，但接力失败：${handoff.dispatchError?.message ?? '请到任务页重试'}`);
    await load(accountId);
  };

  const createLead = async () => {
    const result = await window.terminal.business.dispatch('lead.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), accountId,
      productId: products[0]?.id, platform: 'xiaohongshu', ...lead
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setLead({ nickname: '', coreNeed: '', intent: '', nextAction: '' });
    setMessage('客户线索已记录，并保留来源产品关系。');
    await load(accountId);
  };

  const advanceLead = async (item: Lead) => {
    const stages: Record<string, string> = {
      new_message: 'need_understood', need_understood: 'wechat_added',
      wechat_added: 'negotiating', negotiating: 'won'
    };
    const next = stages[item.stage];
    if (!next) return;
    const result = await window.terminal.business.dispatch('lead.update', {
      id: item.id, expectedVersion: item.version, stage: next, wechatAdded: next === 'wechat_added'
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    await load(accountId);
  };

  const importConversation = async () => {
    const result = await window.terminal.business.dispatch('conversation.import', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), leadId: conversation.leadId || undefined,
      channel: 'xiaohongshu', occurredAt: new Date().toISOString(),
      text: conversation.text, summary: conversation.summary, needs: [], objections: [],
      suggestedReply: '', conclusion: ''
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setConversation({ leadId: '', text: '', summary: '' });
    setMessage(conversation.leadId ? '沟通原文已保存，等待你确认提取结果。' : '身份未确认，材料已单独进入待确认，不会自动合并客户。');
    await load(accountId);
  };

  const promoteCandidate = async (item: IntelligenceCandidate, destination: 'resource' | 'content') => {
    const result = await window.terminal.business.dispatch(`intelligence.promote_${destination}`, {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), candidateId: item.id,
      ...(destination === 'content' ? { accountId } : {})
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage(destination === 'resource' ? '资讯候选已进入资料库，并保留来源关系。' : '资讯候选已建立内容项目，等待你决定是否创作。');
    await load(accountId);
  };

  const confirmConversation = async (record: { id: string }) => {
    const result = await window.terminal.business.dispatch('conversation.confirm', {
      id: record.id, expectedVersion: 1
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage('沟通提取结果已由你确认。');
    await load(accountId);
  };

  const recordDeal = async () => {
    const selectedLead = leads.find((item) => item.id === deal.leadId);
    if (!selectedLead?.product) return setMessage('请先给客户关联产品，再记录成交结果。');
    const result = await window.terminal.business.dispatch('deal.record', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), leadId: selectedLead.id,
      productId: selectedLead.product.id, outcome: deal.outcome,
      amountMinor: deal.amount ? Math.round(Number(deal.amount) * 100) : undefined,
      currency: 'GBP', decidedAt: new Date().toISOString(), reason: deal.reason,
      contentInsight: deal.contentInsight
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setDeal({ leadId: '', outcome: 'won', amount: '', reason: '', contentInsight: '' });
    setMessage(deal.outcome === 'won' ? '成交结果已记录，并会进入内容复盘。' : '未成交原因已记录，并会进入内容复盘。');
    await load(accountId);
  };

  const recordMetrics = async () => {
    const numbers = Object.fromEntries(Object.entries(metrics)
      .filter(([key, value]) => key !== 'contentId' && value !== '')
      .map(([key, value]) => [key, Number(value)]));
    const result = await window.terminal.business.dispatch('post_metrics.record', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), contentId: metrics.contentId,
      platform: 'xiaohongshu', observedAt: new Date().toISOString(), sourceType: 'manual', ...numbers
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage('平台表现已按“手工观察”记录，不会冒充自动回流。');
  };

  const changeProduct = (key: keyof typeof product) => (_: unknown, data: { value: string }) =>
    setProduct((current) => ({ ...current, [key]: data.value }));
  const stageNames: Record<string, string> = {
    new_message: '新私信', need_understood: '已了解需求', wechat_added: '已加微信',
    negotiating: '洽谈中', won: '已成交', lost: '未成交'
  };
  const today = new Date().toISOString().slice(0, 10);
  const due = leads.filter((item) => item.nextFollowUpAt?.slice(0, 10) === today);

  return <section className="business-workspace">
    <div className="account-toolbar">
      <Select aria-label="经营账号" value={accountId} onChange={(event) => {
        setAccountId(event.target.value); void load(event.target.value);
      }}>
        <option value="">选择账号</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </Select>
      <span>{accountId ? '经营资料只写入当前账号' : '请先在“账号”中建立账号'}</span>
    </div>
    {message && <MessageBar><MessageBarBody>{message}</MessageBarBody></MessageBar>}
    <div className="dashboard-metrics">
      <article><span>当前产品</span><strong>{products.length}</strong></article>
      <article><span>待批准建议</span><strong>{proposals.filter((item) => item.status === 'pending').length}</strong></article>
      <article><span>洽谈中的客户</span><strong>{leads.filter((item) => item.stage === 'negotiating').length}</strong></article>
      <article><span>今天要跟进</span><strong>{due.length}</strong></article>
    </div>
    <div className="business-tabs" role="tablist" aria-label="经营工作区">
      {([
        ['today', '今日待办'],
        ['customers', '客户与成交'],
        ['content', '内容机会'],
        ['product', '产品设置']
      ] as const).map(([key, label]) =>
        <Button key={key} role="tab" aria-selected={activeSection === key}
          appearance="subtle" onClick={() => setActiveSection(key)}>{label}</Button>)}
    </div>
    <div className="business-tab-panel">
      {activeSection === 'product' && <section className="business-section">
        <h2>产品与服务</h2>
        <details className="business-disclosure">
          <summary>新增产品或服务</summary>
          <div className="business-form">
            <Input aria-label="产品名称" placeholder="产品或服务名称" value={product.name} onChange={changeProduct('name')} />
            <Input aria-label="目标客户" placeholder="适合谁" value={product.targetCustomer} onChange={changeProduct('targetCustomer')} />
            <Textarea aria-label="解决的问题" placeholder="解决什么问题" value={product.problem} onChange={changeProduct('problem')} />
            <Input aria-label="价格范围" placeholder="价格范围" value={product.priceRange} onChange={changeProduct('priceRange')} />
            <Textarea aria-label="服务范围" placeholder="交付内容与边界" value={product.serviceScope} onChange={changeProduct('serviceScope')} />
            <Input aria-label="适合情况" placeholder="适合的情况" value={product.suitableFor} onChange={changeProduct('suitableFor')} />
            <Input aria-label="不适合情况" placeholder="不适合的情况" value={product.unsuitableFor} onChange={changeProduct('unsuitableFor')} />
            <Button appearance="primary" disabled={!accountId || !product.name || !product.targetCustomer || !product.problem || !product.priceRange || !product.serviceScope} onClick={createProduct}>保存产品</Button>
          </div>
        </details>
        {products.map((item) => <article className="business-card" key={item.id}>
          <strong>{item.name}</strong><span>第 {item.version} 版 · {item.priceRange}</span>
          <p>{item.targetCustomer}：{item.problem}</p>
          <small>{item.versionFile.fileStatus} · {item.versionFile.filePath}</small>
        </article>)}
      </section>}
      {activeSection === 'content' && <section className="business-section">
        <h2>资讯候选</h2>
        {!candidates.length && <p className="empty-copy">还没有扫描候选。后台扫描只收集和整理，不会替你决定选题。</p>}
        {candidates.map((item) => {
          const isToday = item.discoveredAt.slice(0, 10) === today;
          return <article className="business-card" key={item.id}>
            <strong>{item.title}</strong>
            <span>{isToday ? '今天发现' : `历史候选（${item.discoveredAt.slice(0, 10)}）`} · {item.verificationStatus}</span>
            <p>{item.impact}</p><span>影响人群：{item.audience} · 时效：{item.timeliness}</span>
            {item.publishBefore && <small>建议最晚处理：{item.publishBefore.slice(0, 10)}</small>}
            {item.status === 'candidate' && <div>
              <Button onClick={() => promoteCandidate(item, 'resource')}>存入资料库</Button>
              <Button onClick={() => promoteCandidate(item, 'content')}>建立内容项目</Button>
            </div>}
          </article>;
        })}
      </section>}
      {activeSection === 'today' && <section className="business-section">
        <div className="business-section-heading">
          <div><h2>今日待办</h2><p>先处理需要你判断的事项，批准前不会改变正式经营策略。</p></div>
          <Button onClick={() => setActiveSection('customers')}>查看客户跟进</Button>
        </div>
        {!proposals.some((item) => item.status === 'pending') && !leads.some((item) =>
          item.conversations.some((record) => record.confirmationStatus === 'pending')) &&
          <p className="business-empty">目前没有待批准或待确认事项。</p>}
        {proposals.map((item) => <article className="business-card" key={item.id}>
          <div className="business-card-heading">
            <strong>{item.status === 'pending' ? '经营建议待批准' : item.status === 'approved' ? '正式经营策略' : '已失效建议'}</strong>
            <span>{item.status === 'pending' ? '需要你的决定' : item.status === 'approved' ? '已生效' : '仅供追溯'}</span>
          </div>
          <div className="strategy-proposal">
            <h3>建议</h3>
            <p>{String(item.proposed.direction ?? item.proposed.summary ?? '建议正文缺失，请勿批准')}</p>
            <dl>
              <div><dt>为什么现在做</dt><dd>{item.rationale}</dd></div>
              <div><dt>判断依据</dt><dd>{item.evidence.length ? item.evidence.join('；') : '暂未提供依据'}</dd></div>
              <div><dt>如何判断有效</dt><dd>{item.successMeasure}</dd></div>
            </dl>
          </div>
          {item.status === 'pending' && <Button appearance="primary" onClick={() => approve(item)}>批准为正式策略</Button>}
          {item.approvedStrategy && <small>{item.approvedStrategy.versionFile.fileStatus} · {item.approvedStrategy.versionFile.filePath}</small>}
        </article>)}
        <details className="business-disclosure">
          <summary>提出新的经营建议</summary>
          <div className="business-form">
            <Textarea aria-label="经营建议" placeholder="具体建议做什么" value={rationale} onChange={(_, data) => setRationale(data.value)} />
            <Input aria-label="建议依据" placeholder="为什么现在值得做" value={strategyReason} onChange={(_, data) => setStrategyReason(data.value)} />
            <Input aria-label="验证指标" placeholder="如何判断有效，例如：7天新增10条有效私信" value={successMeasure} onChange={(_, data) => setSuccessMeasure(data.value)} />
            <Button disabled={!accountId || !products.length || !rationale || !successMeasure} onClick={propose}>提交为待批准建议</Button>
          </div>
        </details>
      </section>}
      {activeSection === 'customers' && <section className="business-section">
        <h2>客户与成交</h2>
        <div className="business-actions">
          <details className="business-disclosure"><summary>记录新私信客户</summary>
            <div className="business-form">
              <Input aria-label="客户昵称" placeholder="私信客户昵称" value={lead.nickname} onChange={(_, data) => setLead((value) => ({ ...value, nickname: data.value }))} />
              <Input aria-label="客户需求" placeholder="核心需求" value={lead.coreNeed} onChange={(_, data) => setLead((value) => ({ ...value, coreNeed: data.value }))} />
              <Input aria-label="客户意向" placeholder="意向与预算" value={lead.intent} onChange={(_, data) => setLead((value) => ({ ...value, intent: data.value }))} />
              <Input aria-label="下一步动作" placeholder="下一步跟进" value={lead.nextAction} onChange={(_, data) => setLead((value) => ({ ...value, nextAction: data.value }))} />
              <Button disabled={!accountId || !lead.nickname} onClick={createLead}>保存客户</Button>
            </div>
          </details>
          <details className="business-disclosure"><summary>导入沟通记录</summary>
            <div className="business-form">
              <Select aria-label="沟通所属客户" value={conversation.leadId} onChange={(event) => setConversation((value) => ({ ...value, leadId: event.target.value }))}>
                <option value="">身份未确认，暂不关联</option>
                {leads.map((item) => <option key={item.id} value={item.id}>{item.nickname}</option>)}
              </Select>
              <Textarea aria-label="沟通原文" placeholder="粘贴私信、微信对话或口述记录" value={conversation.text} onChange={(_, data) => setConversation((value) => ({ ...value, text: data.value }))} />
              <Input aria-label="沟通摘要" placeholder="这次沟通说了什么" value={conversation.summary} onChange={(_, data) => setConversation((value) => ({ ...value, summary: data.value }))} />
              <Button disabled={!conversation.text || !conversation.summary} onClick={importConversation}>保存沟通原件</Button>
            </div>
          </details>
        </div>
        {leads.map((item) => <article className="business-card" key={item.id}>
          <strong>{item.nickname}</strong><span>{stageNames[item.stage] ?? item.stage} · {item.platform}</span>
          <p>{item.coreNeed || '需求待了解'}；下一步：{item.nextAction || '待安排'}</p>
          <span>来源帖子：{item.sourceContent?.title ?? '尚未关联'} · 产品：{item.product?.name ?? '尚未关联'}</span>
          {!['won', 'lost'].includes(item.stage) && <Button onClick={() => advanceLead(item)}>推进到下一阶段</Button>}
          {item.conversations.map((record) => <div key={record.id}>
            <small>{record.confirmationStatus === 'pending' ? '待确认' : '已确认'} · {
              record.originalFile.fileStatus === 'missing' ? '原始文件缺失，请重新导入' :
              record.originalFile.fileStatus === 'modified' ? '原始文件已被外部修改，请核对' : '原始文件正常'
            }</small>
            {record.originalFile.fileStatus !== 'missing' && <Button size="small" onClick={() => window.terminal.system.openPath(record.originalFile.filePath)}>打开原始文件</Button>}
            {record.confirmationStatus === 'pending' && <Button size="small" onClick={() => confirmConversation(record)}>确认提取结果</Button>}
          </div>)}
          {!item.conversations.length && <small>还没有沟通记录，可在上方粘贴私信或微信对话。</small>}
        </article>)}
        <details className="business-disclosure"><summary>记录成交结果</summary>
        <div className="business-form">
          <Select aria-label="成交客户" value={deal.leadId} onChange={(event) => setDeal((value) => ({ ...value, leadId: event.target.value }))}>
            <option value="">选择客户</option>
            {leads.map((item) => <option key={item.id} value={item.id}>{item.nickname}</option>)}
          </Select>
          <Select aria-label="成交结果" value={deal.outcome} onChange={(event) => setDeal((value) => ({ ...value, outcome: event.target.value }))}>
            <option value="won">已成交</option><option value="lost">未成交</option>
          </Select>
          <Input aria-label="成交金额" type="number" min="0" placeholder="成交金额（英镑，可留空）" value={deal.amount} onChange={(_, data) => setDeal((value) => ({ ...value, amount: data.value }))} />
          <Input aria-label="结果原因" placeholder="成交或未成交的主要原因" value={deal.reason} onChange={(_, data) => setDeal((value) => ({ ...value, reason: data.value }))} />
          <Textarea aria-label="内容启发" placeholder="这次结果对下一轮内容有什么启发" value={deal.contentInsight} onChange={(_, data) => setDeal((value) => ({ ...value, contentInsight: data.value }))} />
          <Button disabled={!deal.leadId || !deal.reason} onClick={recordDeal}>保存成交结果</Button>
        </div></details>
        {deals.map((item) => <article className="business-card" key={item.id}>
          <strong>{item.nickname} · {item.outcome === 'won' ? '已成交' : '未成交'}</strong>
          <span>{item.amount_minor === null ? '未记录金额' : `${item.currency} ${(item.amount_minor / 100).toFixed(2)}`} · {item.reason}</span>
        </article>)}
        <details className="business-disclosure"><summary>记录帖子表现</summary>
        <div className="business-form">
          <Select aria-label="表现所属内容" value={metrics.contentId} onChange={(event) => setMetrics((value) => ({ ...value, contentId: event.target.value }))}>
            <option value="">选择内容</option>
            {contents.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </Select>
          {(['views', 'likes', 'saves', 'comments', 'messages'] as const).map((field) =>
            <Input key={field} aria-label={field} type="number" min="0" placeholder={
              ({ views: '浏览', likes: '点赞', saves: '收藏', comments: '评论', messages: '私信' })[field]
            } value={metrics[field]} onChange={(_, data) => setMetrics((value) => ({ ...value, [field]: data.value }))} />)}
          <Button disabled={!metrics.contentId} onClick={recordMetrics}>保存手工观察</Button>
        </div></details>
      </section>}
    </div>
  </section>;
}
