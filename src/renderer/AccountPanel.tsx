import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody, Textarea } from '@fluentui/react-components';

type Account = {
  id: string; name: string; positioning: string; audience: string; tone: string; version: number; status: string;
  forbiddenExpressions: string[]; platformIdentities: Record<string, string>; defaultTemplates: Record<string, string>;
  platformStates?: Record<string, { identity: string; template: string }>;
  configFile?: { filePath: string; byteSize: number; sha256: string; fileMtime: string; fileStatus: string };
  usage?: { contents: unknown[]; packages: unknown[] };
};

export function AccountPanel() {
  const [items, setItems] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account>();
  const [name, setName] = useState('');
  const [positioning, setPositioning] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('');
  const [forbidden, setForbidden] = useState('');
  const [xiaohongshuIdentity, setXiaohongshuIdentity] = useState('');
  const [douyinIdentity, setDouyinIdentity] = useState('');
  const [wechatIdentity, setWechatIdentity] = useState('');
  const [xiaohongshuTemplate, setXiaohongshuTemplate] = useState('');
  const [douyinTemplate, setDouyinTemplate] = useState('');
  const [wechatTemplate, setWechatTemplate] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const fill = (value: Account) => {
    setAccount(value); setName(value.name); setPositioning(value.positioning); setAudience(value.audience); setTone(value.tone);
    setForbidden(value.forbiddenExpressions.join('\n'));
    setXiaohongshuIdentity(value.platformIdentities.xiaohongshu ?? '');
    setDouyinIdentity(value.platformIdentities.douyin ?? '');
    setWechatIdentity(value.platformIdentities.wechat ?? '');
    setXiaohongshuTemplate(value.defaultTemplates.xiaohongshu ?? '');
    setDouyinTemplate(value.defaultTemplates.douyin ?? '');
    setWechatTemplate(value.defaultTemplates.wechat ?? '');
    setDirty(false);
  };
  useEffect(() => {
    void window.terminal.business.dispatch('account.search', { query: '', limit: 100 }).then(async (result) => {
      if (!result.ok) { setLoading(false); return setMessage(`${result.error.code}: ${result.error.message}`); }
      const found = (result.result as { items: Account[] }).items;
      setItems(found);
      if (found[0]) {
        const detail = await window.terminal.business.dispatch('account.get', { id: found[0].id });
        if (detail.ok) fill(detail.result as Account);
      }
      setLoading(false);
    });
  }, []);
  const values = () => ({
    name, positioning, audience, tone, forbiddenExpressions: forbidden.split('\n').map((value) => value.trim()).filter(Boolean),
    platformIdentities: { xiaohongshu: xiaohongshuIdentity, douyin: douyinIdentity, wechat: wechatIdentity },
    defaultTemplates: { xiaohongshu: xiaohongshuTemplate, douyin: douyinTemplate, wechat: wechatTemplate }
  });
  const create = async () => {
    const result = await window.terminal.business.dispatch('account.create', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), ...values()
    });
    if (result.ok) {
      const value = result.result as Account;
      fill(value); setItems((current) => [value, ...current.filter((item) => item.id !== value.id)]);
      setMessage('账号已创建并写入配置文件。');
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const update = async () => {
    if (!account) return;
    const result = await window.terminal.business.dispatch('account.update', { id: account.id, expectedVersion: account.version, ...values() });
    if (result.ok) { fill(result.result as Account); setMessage('账号配置已保存为新版本。'); }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const search = async () => {
    const result = await window.terminal.business.dispatch('account.search', { query: name, limit: 100 });
    if (result.ok) setItems((result.result as { items: Account[] }).items);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const change = (setter: (value: string) => void) => (_: unknown, data: { value: string }) => { setter(data.value); setDirty(true); };
  const select = async (item: Account) => {
    const result = await window.terminal.business.dispatch('account.get', { id: item.id });
    if (result.ok) fill(result.result as Account);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const platformNames: Record<string, string> = { xiaohongshu: '小红书', douyin: '抖音图文', wechat: '微信公众号' };
  const visibleItems = items.length ? items : account ? [account] : [];

  return <section className="account-workspace">
    <h2>账号配置</h2>
    <div className="account-toolbar">
      <Input aria-label="账号名称" placeholder="账号名称或搜索词" value={name} onChange={change(setName)} />
      <Button onClick={search}>搜索账号</Button>
      <Button appearance="primary" disabled={loading || !name.trim()} onClick={create}>创建账号</Button>
      <Button disabled={!account || !dirty} onClick={update}>保存账号</Button>
      <span>{loading ? '正在读取账号…' : dirty ? '有未保存修改' : account ? '配置已保存' : '首次使用：暂无账号'}</span>
    </div>
    <div className="account-layout">
      <aside className="account-list" aria-label="账号列表">
        <h3>账号列表</h3>
        {visibleItems.length ? visibleItems.map((item) =>
          <Button key={item.id} appearance={item.id === account?.id ? 'primary' : 'subtle'} onClick={() => select(item)}>{item.name}</Button>)
          : <p className="empty-copy">还没有账号</p>}
      </aside>
      <div className="account-detail">
        <section>
          <h3>名称与定位</h3>
          <div className="account-form-grid">
            <Input aria-label="账号定位" placeholder="定位" value={positioning} onChange={change(setPositioning)} />
          </div>
        </section>
        <section>
          <h3>受众与语气</h3>
          <div className="account-form-grid">
            <Input aria-label="目标受众" placeholder="受众" value={audience} onChange={change(setAudience)} />
            <Input aria-label="内容语气" placeholder="语气" value={tone} onChange={change(setTone)} />
          </div>
        </section>
        <section>
          <h3>禁用表达</h3>
          <Textarea aria-label="禁用表达" placeholder="每行一个禁用表达" value={forbidden} onChange={change(setForbidden)} />
        </section>
        <section>
          <h3>平台身份与默认模板</h3>
          <div className="account-form-grid">
            <Input aria-label="小红书平台身份" placeholder="小红书身份" value={xiaohongshuIdentity} onChange={change(setXiaohongshuIdentity)} />
            <Input aria-label="小红书默认模板" placeholder="小红书模板版本" value={xiaohongshuTemplate} onChange={change(setXiaohongshuTemplate)} />
            <Input aria-label="抖音平台身份" placeholder="抖音身份" value={douyinIdentity} onChange={change(setDouyinIdentity)} />
            <Input aria-label="抖音默认模板" placeholder="抖音模板版本" value={douyinTemplate} onChange={change(setDouyinTemplate)} />
            <Input aria-label="微信公众号平台身份" placeholder="微信公众号身份" value={wechatIdentity} onChange={change(setWechatIdentity)} />
            <Input aria-label="微信公众号默认模板" placeholder="微信公众号模板版本" value={wechatTemplate} onChange={change(setWechatTemplate)} />
          </div>
        </section>
        {account && <>
          <p>账号：{account.name}｜版本：{account.version}｜状态：{account.status}</p>
          <p>内容 {account.usage?.contents.length ?? 0} 项｜发布包 {account.usage?.packages.length ?? 0} 项</p>
          <div className="platform-state-grid">
            {Object.entries(account.platformStates ?? {}).map(([platform, state]) =>
              <p key={platform}>{platformNames[platform] ?? platform}：身份 {state.identity}｜模板 {state.template}</p>)}
          </div>
          {account.configFile && <p className="path-readback">
            配置文件：{account.configFile.filePath}｜{account.configFile.byteSize} 字节｜{account.configFile.fileStatus}｜摘要 {account.configFile.sha256}
          </p>}
          <p>资料与素材按使用关系跨账号复用，不创建账号私有副本。</p>
        </>}
      </div>
    </div>
    {message && <MessageBar intent={message.includes(':') ? 'error' : 'success'}><MessageBarBody>{message}</MessageBarBody></MessageBar>}
  </section>;
}
