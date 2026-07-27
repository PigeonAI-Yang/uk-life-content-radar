import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody } from '@fluentui/react-components';
import type { RootSettings } from '../storage/database';

export function SettingsPanel() {
  const [rootPath, setRootPath] = useState('');
  const [settings, setSettings] = useState<RootSettings>();
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
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
      <Button onClick={() => window.terminal.lifecycle.quit()}>完全退出</Button>
    </section>
  );
}
