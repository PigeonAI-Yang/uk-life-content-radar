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

export function BusinessPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [message, setMessage] = useState('');
  const [product, setProduct] = useState({
    name: '', targetCustomer: '', problem: '', priceRange: '', serviceScope: '',
    suitableFor: '', unsuitableFor: ''
  });
  const [rationale, setRationale] = useState('');
  const [successMeasure, setSuccessMeasure] = useState('');

  const load = async (selected: string) => {
    if (!selected) return;
    const [productResult, strategyResult] = await Promise.all([
      window.terminal.business.dispatch('product.list', { accountId: selected }),
      window.terminal.business.dispatch('strategy.list', { accountId: selected })
    ]);
    if (productResult.ok) setProducts((productResult.result as { items: Product[] }).items);
    if (strategyResult.ok) setProposals((strategyResult.result as { items: Proposal[] }).items);
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

  const changeProduct = (key: keyof typeof product) => (_: unknown, data: { value: string }) =>
    setProduct((current) => ({ ...current, [key]: data.value }));

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
    </div>
  </section>;
}
