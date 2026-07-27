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
  status: string; version: number; approvedStrategy: { versionFile: FileReadback } | null;
};
type Lead = {
  id: string; nickname: string; platform: string; stage: string; coreNeed: string;
  nextAction: string; nextFollowUpAt: string | null; version: number;
  sourceContent: { id: string; title: string } | null; product: { id: string; name: string } | null;
  conversations: { id: string; summary: string; confirmationStatus: string; originalFile: FileReadback }[];
};

export function BusinessPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [message, setMessage] = useState('');
  const [product, setProduct] = useState({
    name: '', targetCustomer: '', problem: '', priceRange: '', serviceScope: '',
    suitableFor: '', unsuitableFor: ''
  });
  const [rationale, setRationale] = useState('');
  const [successMeasure, setSuccessMeasure] = useState('');
  const [lead, setLead] = useState({ nickname: '', coreNeed: '', intent: '', nextAction: '' });
  const [conversation, setConversation] = useState({ leadId: '', text: '', summary: '' });

  const load = async (selected: string) => {
    if (!selected) return;
    const [productResult, strategyResult, leadResult] = await Promise.all([
      window.terminal.business.dispatch('product.list', { accountId: selected }),
      window.terminal.business.dispatch('strategy.list', { accountId: selected }),
      window.terminal.business.dispatch('lead.list', { accountId: selected })
    ]);
    if (productResult.ok) setProducts((productResult.result as { items: Product[] }).items);
    if (strategyResult.ok) setProposals((strategyResult.result as { items: Proposal[] }).items);
    if (leadResult.ok) setLeads((leadResult.result as { items: Lead[] }).items);
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
      proposed: { direction: rationale }, rationale, evidence: [], successMeasure
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage('建议已记录，批准前不会成为正式经营策略。');
    setRationale(''); setSuccessMeasure('');
    await load(accountId);
  };

  const approve = async (item: Proposal) => {
    const result = await window.terminal.business.dispatch('strategy.approve', {
      id: item.id, expectedVersion: item.version
    });
    if (!result.ok) return setMessage(`${result.error.code}: ${result.error.message}`);
    setMessage('经营策略已由你批准并保存为正式版本。');
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
    <div className="business-columns">
      <section>
        <h2>产品与服务</h2>
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
        {products.map((item) => <article className="business-card" key={item.id}>
          <strong>{item.name}</strong><span>第 {item.version} 版 · {item.priceRange}</span>
          <p>{item.targetCustomer}：{item.problem}</p>
          <small>{item.versionFile.fileStatus} · {item.versionFile.filePath}</small>
        </article>)}
      </section>
      <section>
        <h2>经营建议</h2>
        <p>Codex 可以提出建议；只有你在这里批准后，建议才成为正式策略。</p>
        <div className="business-form">
          <Textarea aria-label="经营建议" placeholder="例如：本周用英国租房押金新规吸引咨询，并在结尾引导私信材料清单" value={rationale} onChange={(_, data) => setRationale(data.value)} />
          <Input aria-label="验证指标" placeholder="如何判断有效，例如：7天新增10条有效私信" value={successMeasure} onChange={(_, data) => setSuccessMeasure(data.value)} />
          <Button disabled={!accountId || !products.length || !rationale || !successMeasure} onClick={propose}>记录为待批准建议</Button>
        </div>
        {proposals.map((item) => <article className="business-card" key={item.id}>
          <strong>{item.status === 'pending' ? '待你批准' : item.status === 'approved' ? '已批准' : '已失效'}</strong>
          <p>{item.rationale}</p><span>验证：{item.successMeasure}</span>
          {item.status === 'pending' && <Button appearance="primary" onClick={() => approve(item)}>批准为正式策略</Button>}
          {item.approvedStrategy && <small>{item.approvedStrategy.versionFile.fileStatus} · {item.approvedStrategy.versionFile.filePath}</small>}
        </article>)}
      </section>
      <section>
        <h2>客户与成交</h2>
        <div className="business-form">
          <Input aria-label="客户昵称" placeholder="私信客户昵称" value={lead.nickname} onChange={(_, data) => setLead((value) => ({ ...value, nickname: data.value }))} />
          <Input aria-label="客户需求" placeholder="核心需求" value={lead.coreNeed} onChange={(_, data) => setLead((value) => ({ ...value, coreNeed: data.value }))} />
          <Input aria-label="客户意向" placeholder="意向与预算" value={lead.intent} onChange={(_, data) => setLead((value) => ({ ...value, intent: data.value }))} />
          <Input aria-label="下一步动作" placeholder="下一步跟进" value={lead.nextAction} onChange={(_, data) => setLead((value) => ({ ...value, nextAction: data.value }))} />
          <Button disabled={!accountId || !lead.nickname} onClick={createLead}>记录新私信客户</Button>
        </div>
        <div className="business-form">
          <Select aria-label="沟通所属客户" value={conversation.leadId} onChange={(event) => setConversation((value) => ({ ...value, leadId: event.target.value }))}>
            <option value="">身份未确认，暂不关联</option>
            {leads.map((item) => <option key={item.id} value={item.id}>{item.nickname}</option>)}
          </Select>
          <Textarea aria-label="沟通原文" placeholder="粘贴私信、微信对话或口述记录" value={conversation.text} onChange={(_, data) => setConversation((value) => ({ ...value, text: data.value }))} />
          <Input aria-label="沟通摘要" placeholder="这次沟通说了什么" value={conversation.summary} onChange={(_, data) => setConversation((value) => ({ ...value, summary: data.value }))} />
          <Button disabled={!conversation.text || !conversation.summary} onClick={importConversation}>保存沟通原件</Button>
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
          </div>)}
          {!item.conversations.length && <small>还没有沟通记录，可在上方粘贴私信或微信对话。</small>}
        </article>)}
      </section>
    </div>
  </section>;
}
