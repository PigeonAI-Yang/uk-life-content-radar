import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody, Select } from '@fluentui/react-components';
import type { RootSettings } from '../storage/database';

export function SettingsPanel() {
  const [rootPath, setRootPath] = useState('');
  const [settings, setSettings] = useState<RootSettings>();
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiModels, setApiModels] = useState<string[]>([]);
  const [apiStatus, setApiStatus] = useState('');
  const [auth, setAuth] = useState<{ selected: string | null; candidates: { source: string; detected: boolean; message: string }[] }>();
  const [authEvent, setAuthEvent] = useState('');
  const [business, setBusiness] = useState<{
    rootPath: string; databasePath: string; databaseByteSize: number; temporaryPath: string; exportDirectory: string;
    platformTemplates: Record<string, unknown>; index: { available: boolean; indexed: number; objects: number };
    storageAlert?: { code: string; message: string; requiredBytes: number; freeBytes: number };
    lastScan?: { fileCount: number; byteSize: number; growthFiles: number; growthBytes: number; freeBytes: number; scannedAt: string };
  }>();
  const [exportDirectory, setExportDirectory] = useState('');
  const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 ** 2).toFixed(1)} MB`;

  const refreshBusiness = async () => {
    const response = await window.terminal.business.dispatch('settings.get', {});
    if (response.ok) {
      const value = response.result as typeof business;
      setBusiness(value);
      setExportDirectory(value?.exportDirectory ?? '');
    }
  };

  useEffect(() => {
    void window.terminal.agent.scanAuth().then((value) => setAuth(value as typeof auth));
    void window.terminal.agent.getCustomApi().then((value) => {
      const result = value as { config?: { baseUrl: string; model: string } };
      setApiBaseUrl(result.config?.baseUrl ?? '');
      setApiModel(result.config?.model ?? '');
    });
    const unsubscribe = window.terminal.agent.onAuthEvent((value) => {
      const event = value as { type?: string; userCode?: string; instructions?: string };
      setAuthEvent(event.type === 'device_code' ? `验证码：${event.userCode}` : event.instructions ?? '请在浏览器完成登录');
    });
    void window.terminal.settings.get().then((value) => {
      if (value) {
        setSettings(value);
        setRootPath(value.rootPath);
        void window.terminal.business.dispatch('settings.get', {}).then((response) => {
          if (response.ok) {
            const businessValue = response.result as typeof business;
            setBusiness(businessValue);
            setExportDirectory(businessValue?.exportDirectory ?? '');
          }
        });
      }
    });
    return unsubscribe;
  }, []);

  const chooseRoot = async () => {
    const selected = await window.terminal.settings.chooseRoot();
    if (selected) setRootPath(selected);
  };

  const initialize = async () => {
    setError('');
    try {
      setSettings(await window.terminal.settings.initializeRoot(rootPath));
      await refreshBusiness();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="settings-panel">
      <div className="panel-heading"><div><h2>业务数据存储</h2><p>已有业务数据后根目录只读，避免数据库与磁盘文件失去对应关系</p></div></div>
      <div className="settings-row">
        <Input aria-label="业务根目录" value={rootPath} readOnly={Boolean(settings)} onChange={(_, data) => setRootPath(data.value)} />
        {!settings && <Button onClick={chooseRoot}>浏览</Button>}
        {!settings && <Button appearance="primary" disabled={!rootPath} onClick={initialize}>初始化</Button>}
      </div>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {settings && (
        <><dl>
          <dt>数据库</dt><dd>{settings.databasePath}</dd>
          <dt>数据库容量</dt><dd>{bytes(business?.databaseByteSize ?? 0)}</dd>
          <dt>临时目录</dt><dd>{settings.temporaryPath}</dd>
          <dt>迁移版本</dt><dd>{settings.migrationVersion}</dd>
          <dt>全文检索</dt><dd>{settings.fts5 ? '可用' : '不可用'}</dd>
          {business?.lastScan && <><dt>文件数量</dt><dd>{business.lastScan.fileCount} 个</dd><dt>占用容量</dt><dd>{bytes(business.lastScan.byteSize)}</dd>
            <dt>本次增长</dt><dd>{business.lastScan.growthFiles} 个文件 / {bytes(business.lastScan.growthBytes)}</dd>
            <dt>磁盘可用</dt><dd>{bytes(business.lastScan.freeBytes)}</dd><dt>最近扫描</dt><dd>{new Date(business.lastScan.scannedAt).toLocaleString()}</dd></>}
          <dt>索引状态</dt><dd>{business?.index.available ? `${business.index.indexed}/${business.index.objects}` : '不可用'}</dd>
          {business?.storageAlert && <><dt>存储影响</dt><dd role="alert">{business.storageAlert.code}: {business.storageAlert.message}（需要 {business.storageAlert.requiredBytes}，可用 {business.storageAlert.freeBytes}）</dd></>}
        </dl>
        <div className="settings-row">
          <Input aria-label="默认导出目录" value={exportDirectory} onChange={(_, data) => setExportDirectory(data.value)} />
          <Button onClick={async () => {
            const response = await window.terminal.business.dispatch('settings.update_export_directory', { directory: exportDirectory });
            if (!response.ok) setError(`${response.error.code}: ${response.error.message}`); else await refreshBusiness();
          }}>保存导出目录</Button>
          <Button disabled={scanning} onClick={async () => {
            setScanning(true);
            try {
              const response = await window.terminal.business.dispatch('storage.scan', {});
              if (!response.ok) setError(`${response.error.code}: ${response.error.message}`); else await refreshBusiness();
            } finally {
              setScanning(false);
            }
          }}>{scanning ? '扫描中…' : '扫描存储'}</Button>
        </div></>
      )}
      <section className="settings-agent">
        <div className="panel-heading"><div><h2>Pi 工作助手</h2><p>可直接接入本机 CockpitTools，也可填写 OpenAI Responses 兼容 API。</p></div></div>
        <p>{auth?.selected ? '已检测到可用登录候选，连接后才会确认有效。' : '尚未登录。'}</p>
        {auth?.candidates.map((item) => <small key={item.source}>{item.message}<br /></small>)}
        {authEvent && <MessageBar><MessageBarBody>{authEvent}</MessageBarBody></MessageBar>}
        <div className="settings-row">
          <Button onClick={async () => setAuth(await window.terminal.agent.scanAuth() as typeof auth)}>扫描本机登录</Button>
          <Button onClick={async () => setAuth(await window.terminal.agent.importCodex() as typeof auth)}>使用本机 Codex 登录</Button>
          <Button onClick={async () => setAuth(await window.terminal.agent.login('browser') as typeof auth)}>订阅登录</Button>
          <Button onClick={async () => setAuth(await window.terminal.agent.login('device_code') as typeof auth)}>验证码登录</Button>
        </div>
        <div className="settings-row">
          <Button onClick={async () => {
            try {
              const result = await window.terminal.agent.importCockpit() as {
                config: { baseUrl: string; model: string }; models: string[];
              };
              setApiBaseUrl(result.config.baseUrl); setApiModel(result.config.model); setApiModels(result.models);
              setApiStatus('已导入 CockpitTools，本地密钥已加密保存。');
            } catch (cause) {
              setApiStatus(cause instanceof Error ? cause.message : String(cause));
            }
          }}>导入 CockpitTools</Button>
          <Input aria-label="自定义 API 地址" placeholder="例如 http://127.0.0.1:61946/v1" value={apiBaseUrl} onChange={(_, data) => setApiBaseUrl(data.value)} />
          <Input type="password" aria-label="自定义 API Key" placeholder="留空表示沿用已保存密钥" value={apiKey} onChange={(_, data) => setApiKey(data.value)} />
        </div>
        <div className="settings-row">
          {apiModels.length ? <Select aria-label="自定义 API 模型" value={apiModel} onChange={(event) => setApiModel(event.target.value)}>
            {apiModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </Select> : <Input aria-label="自定义 API 模型" placeholder="模型名称" value={apiModel} onChange={(_, data) => setApiModel(data.value)} />}
          <Button disabled={!apiBaseUrl || !apiModel} onClick={async () => {
            try {
              await window.terminal.agent.saveCustomApi({ baseUrl: apiBaseUrl, model: apiModel, apiKey: apiKey || undefined });
              setApiKey(''); setApiStatus('自定义 API 已保存。');
            } catch (cause) {
              setApiStatus(cause instanceof Error ? cause.message : String(cause));
            }
          }}>保存 API 配置</Button>
          <Button disabled={!apiBaseUrl} onClick={async () => {
            try {
              await window.terminal.agent.saveCustomApi({ baseUrl: apiBaseUrl, model: apiModel || 'gpt-5.6-sol', apiKey: apiKey || undefined });
              const result = await window.terminal.agent.discoverModels() as { models: string[] };
              setApiModels(result.models);
              if (!apiModel && result.models[0]) setApiModel(result.models[0]);
              setApiStatus(`发现 ${result.models.length} 个模型。`);
            } catch (cause) {
              setApiStatus(cause instanceof Error ? cause.message : String(cause));
            }
          }}>读取模型</Button>
          <Button disabled={!apiBaseUrl || !apiModel} onClick={async () => {
            try {
              await window.terminal.agent.saveCustomApi({ baseUrl: apiBaseUrl, model: apiModel, apiKey: apiKey || undefined });
              const result = await window.terminal.agent.testCustomApi() as { model: string };
              setApiKey(''); setApiStatus(`连接成功：${result.model}`);
            } catch (cause) {
              setApiStatus(cause instanceof Error ? cause.message : String(cause));
            }
          }}>测试连接</Button>
        </div>
        {apiStatus && <MessageBar><MessageBarBody>{apiStatus}</MessageBarBody></MessageBar>}
      </section>
      <Button onClick={() => window.terminal.lifecycle.quit()}>完全退出</Button>
    </section>
  );
}
