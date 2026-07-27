import { useEffect, useState } from 'react';
import { Button, Input, MessageBar, MessageBarBody } from '@fluentui/react-components';

type Version = {
  id: string; version: number; filePath: string; byteSize: number; sha256: string;
  fileMtime: string; fileStatus: string; operation: string; width?: number; height?: number;
};
type Asset = {
  id: string; name: string; version: number; status: string; versionId: string;
  filePath: string; fileStatus: string; width?: number; height?: number;
  versions: Version[]; usage: Array<{ content_id: string; image_order: number }>; operations: Array<Record<string, unknown>>;
};

export function AssetPanel() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset>();
  const [versionId, setVersionId] = useState('');
  const [externalPath, setExternalPath] = useState('');
  const [importPath, setImportPath] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [message, setMessage] = useState('');
  const [width, setWidth] = useState('1080');
  const [height, setHeight] = useState('1440');
  const [quality, setQuality] = useState('70');
  const [text, setText] = useState('英国生活');
  const [preview, setPreview] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const showItems = async (assets: Asset[]) => {
    setItems(assets);
    const entries = await Promise.all(assets.filter((asset) => asset.fileStatus === 'present').map(async (asset) =>
      [asset.id, await window.terminal.system.imageData(asset.filePath)] as const));
    setThumbnails(Object.fromEntries(entries));
  };
  useEffect(() => {
    void window.terminal.business.dispatch('asset.search', { query: '', limit: 100 }).then((result) => {
      if (result.ok) void showItems((result.result as { items: Asset[] }).items);
      else setMessage(`${result.error.code}: ${result.error.message}`);
    });
  }, []);

  const search = async () => {
    const result = await window.terminal.business.dispatch('asset.search', { query, limit: 100 });
    if (result.ok) await showItems((result.result as { items: Asset[] }).items);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const importAsset = async () => {
    const result = await window.terminal.business.dispatch('asset.import', {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), filePath: importPath
    });
    if (result.ok) {
      const value = result.result as Asset; setSelected(value); setVersionId(value.versionId);
      setPreview(await window.terminal.system.imageData(value.versions.at(-1)!.filePath)); await search();
    }
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const read = async (id: string) => {
    const result = await window.terminal.business.dispatch('asset.get', { id });
    if (result.ok) {
      const value = result.result as Asset;
      setSelected(value); setVersionId(value.versionId);
      setPreview(await window.terminal.system.imageData(value.versions.at(-1)!.filePath));
      setItems((current) => current.map((item) => item.id === id ? value : item));
    } else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const status = async () => {
    if (!selected) return;
    const result = await window.terminal.business.dispatch(`asset.${selected.status === 'archived' ? 'restore' : 'archive'}`, {
      id: selected.id, expectedVersion: selected.version
    });
    if (result.ok) setSelected(result.result as Asset);
    else setMessage(`${result.error.code}: ${result.error.message}`);
  };
  const run = async (command: string, extra: Record<string, unknown>) => {
    if (!selected) return;
    const result = await window.terminal.business.dispatch(command, {
      caller: 'ui', idempotencyKey: crypto.randomUUID(), assetId: selected.id, versionId, ...extra
    });
    if (result.ok) {
      const value = result.result as Asset;
      setSelected(value); setVersionId(value.versionId); setMessage('图片处理完成并已保存为新版本。');
      setPreview(await window.terminal.system.imageData(value.versions.at(-1)!.filePath));
    } else setMessage(`${result.error.code}: ${result.error.message}`);
  };

  const shown = selected?.versions.find((version) => version.id === versionId);
  return <section className="asset-panel">
    <div className="settings-row asset-toolbar">
      <Input aria-label="素材搜索" value={query} onChange={(_, data) => setQuery(data.value)} />
      <Button onClick={search}>搜索素材</Button>
      <Input aria-label="导入图片路径" value={importPath} onChange={(_, data) => setImportPath(data.value)} />
      <Button onClick={importAsset} disabled={!importPath}>导入图片</Button>
      <Button onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}>{layout === 'grid' ? '列表视图' : '网格视图'}</Button>
    </div>
    <div className="asset-layout">
      <div className={`asset-${layout}`} role="list">
        {items.map((asset) => <button key={asset.id} onClick={() => void read(asset.id)}>
          {thumbnails[asset.id]
            ? <img className="asset-thumbnail" src={thumbnails[asset.id]} alt="" />
            : <span className="asset-thumbnail" aria-hidden="true">{asset.fileStatus === 'missing' ? '文件丢失' : '无法预览'}</span>}
          <strong>{asset.name}</strong><span>{asset.width ?? '?'} × {asset.height ?? '?'} · 使用 {asset.usage.length} 次 · {asset.versions.length} 个版本</span>
        </button>)}
        {!items.length && <p>暂无素材</p>}
      </div>
      {selected && <aside className="asset-reader" aria-label="素材详情">
        <h2>{selected.name}</h2>
        <select aria-label="素材历史版本" value={versionId} onChange={async (event) => {
          setVersionId(event.target.value);
          const version = selected.versions.find((item) => item.id === event.target.value);
          if (version?.fileStatus === 'present') setPreview(await window.terminal.system.imageData(version.filePath));
        }}>
          {selected.versions.map((version) => <option key={version.id} value={version.id}>
            v{version.version} · {version.operation} · {version.fileStatus}
          </option>)}
        </select>
        {shown && <>
          {preview && <img className="asset-preview" src={preview} alt={selected.name} />}
          <p>{shown.width ?? '?'} × {shown.height ?? '?'}｜{shown.byteSize} 字节｜{shown.fileStatus}</p>
          <p className="path-readback">{shown.filePath}</p>
          <p className="path-readback">摘要：{shown.sha256}</p>
        </>}
        <div className="settings-row asset-controls">
          <Input aria-label="图片宽度" value={width} onChange={(_, data) => setWidth(data.value)} />
          <Input aria-label="图片高度" value={height} onChange={(_, data) => setHeight(data.value)} />
          <Input aria-label="压缩质量" value={quality} onChange={(_, data) => setQuality(data.value)} />
        </div>
        <div className="settings-row asset-controls">
          <Button onClick={() => run('asset.crop', { left: 0, top: 0, width: Number(width), height: Number(height) })}>裁剪</Button>
          <Button onClick={() => run('asset.resize', { width: Number(width), height: Number(height) })}>缩放</Button>
          <Button onClick={() => run('asset.compress', { quality: Number(quality) })}>压缩</Button>
          <Button onClick={() => run('asset.convert_platform_size', { templateVersion: 'xiaohongshu-v1' })}>平台尺寸</Button>
        </div>
        <div className="settings-row asset-controls">
          <Input aria-label="叠加文字" value={text} onChange={(_, data) => setText(data.value)} />
          <Button onClick={() => run('asset.overlay_text', { text, font: 'Microsoft YaHei', size: 48, color: '#ffd700', x: 24, y: 72 })}>叠加文字</Button>
        </div>
        <div className="settings-row asset-controls">
          <Input aria-label="外部修改图片路径" value={externalPath} onChange={(_, data) => setExternalPath(data.value)} />
          <Button onClick={() => run('asset.import_external_version', { filePath: externalPath })}>导入外部版本</Button>
          <Button onClick={status}>{selected.status === 'archived' ? '恢复素材' : '归档素材'}</Button>
        </div>
        <details><summary>使用记录</summary>
          {selected.usage.length ? <ul>{selected.usage.map((usage) => <li key={`${usage.content_id}-${usage.image_order}`}>内容项目 · 第 {usage.image_order + 1} 张图片</li>)}</ul> : <p>尚未用于任何内容</p>}
        </details>
        <details><summary>处理记录</summary>
          {selected.operations.length ? <ul>{selected.operations.map((operation) => <li key={String(operation.id)}>{String(operation.operation)} · {String(operation.status)}</li>)}</ul> : <p>暂无处理记录</p>}
        </details>
      </aside>}
    </div>
    {message && <MessageBar intent={message.includes(':') ? 'error' : 'success'}><MessageBarBody>{message}</MessageBarBody></MessageBar>}
  </section>;
}
