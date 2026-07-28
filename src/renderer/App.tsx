import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Button,
  FluentProvider,
  Input,
  Select,
  webLightTheme
} from '@fluentui/react-components';
import {
  BoxRegular,
  BriefcaseRegular,
  EditRegular,
  GlobeRegular,
  HomeRegular,
  ImageRegular,
  LibraryRegular,
  NavigationRegular,
  PersonRegular,
  SearchRegular,
  SettingsRegular,
  TaskListSquareLtrRegular
} from '@fluentui/react-icons';
import { routes, type RouteName } from './routes';
import { SettingsPanel } from './SettingsPanel';
import { AccountPanel } from './AccountPanel';
import { TaskPanel } from './TaskPanel';
import { MinimumLoopPanel } from './MinimumLoopPanel';
import { PublishingPanel } from './PublishingPanel';
import { BrowserPanel } from './BrowserPanel';
import { LibraryPanel } from './LibraryPanel';
import { ContentEditorPanel } from './ContentEditorPanel';
import { AssetPanel } from './AssetPanel';
import { BusinessPanel } from './BusinessPanel';
import { PiSidebar } from './PiSidebar';
import './app.css';

export function App() {
  const [route, setRoute] = useState<RouteName>('工作台');
  const [collapsed, setCollapsed] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchMode, setSearchMode] = useState<'keyword' | 'semantic'>('keyword');
  const [globalResults, setGlobalResults] = useState<{ id: string; type: string; title: string; status: string; score?: number }[]>();
  const typeNames: Record<string, string> = {
    resource: '资料（resource）', excerpt: '摘录（excerpt）', note: '笔记（note）', content: '内容（content）',
    asset: '素材（asset）', package: '发布包（package）', account: '账号（account）'
  };
  const statusNames: Record<string, string> = { active: '使用中', archived: '已归档', completed: '已完成' };
  const routeIcons: Record<RouteName, ReactElement> = {
    工作台: <HomeRegular />,
    浏览与收集: <GlobeRegular />,
    资料库: <LibraryRegular />,
    内容: <EditRegular />,
    素材库: <ImageRegular />,
    发布包: <BoxRegular />,
    情报: <BriefcaseRegular />,
    账号: <PersonRegular />,
    任务: <TaskListSquareLtrRegular />,
    设置: <SettingsRegular />
  };
  const runGlobalSearch = async () => {
    const response = await window.terminal.business.dispatch('search.query', {
      query: globalQuery, mode: searchMode, types: ['resource', 'excerpt', 'note', 'content', 'asset', 'package', 'account'],
      tags: [], includeArchived: true, limit: 25
    });
    if (response.ok) setGlobalResults((response.result as { items: typeof globalResults }).items);
    else setGlobalResults([]);
  };
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    globalThis.addEventListener('keydown', focusSearch);
    return () => globalThis.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <FluentProvider theme={webLightTheme} className="app">
      <header className="app-header">
        <Button appearance="subtle" icon={<NavigationRegular />} aria-label="折叠导航" onClick={() => setCollapsed(!collapsed)} />
        <div className="app-brand"><strong>自媒体桌面终端</strong><span>本地工作区</span></div>
        <div className="global-search">
          <Select aria-label="全局搜索模式" value={searchMode} onChange={(event) => setSearchMode(event.target.value as 'keyword' | 'semantic')}>
            <option value="keyword">关键词</option><option value="semantic">语义</option>
          </Select>
          <Input ref={searchRef} aria-label="全局搜索" contentBefore={<SearchRegular />} placeholder="搜索资料、内容、素材和发布包"
            value={globalQuery} onChange={(_, data) => setGlobalQuery(data.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void runGlobalSearch(); }} />
        </div>
      </header>
      <div className="body">
        <nav className={collapsed ? 'collapsed' : ''} aria-label="一级导航">
          {routes.map((item) => (
            <Button key={item} appearance="subtle" className={route === item ? 'active' : ''}
              icon={routeIcons[item]} aria-label={item} title={collapsed ? item : undefined} onClick={() => setRoute(item)}>
              {collapsed ? null : item}
            </Button>
          ))}
        </nav>
        <main>
          {globalResults && <section className="search-results-panel" aria-label="全局搜索结果">
            <h2>全局搜索结果</h2>
            {globalResults.length ? <div className="global-results">{globalResults.map((item) => <div key={`${item.type}-${item.id}`}>
              <strong>{item.title}</strong>
              <span>{typeNames[item.type] ?? item.type} · {statusNames[item.status] ?? item.status}{item.score === undefined ? '' : ` · 相关度 ${Math.round(item.score * 100)}%`}</span>
            </div>)}</div> : <p>搜索无结果</p>}
          </section>}
          <div className="page-heading">
            <h1>{route}</h1>
          </div>
          {route === '设置' ? <SettingsPanel /> : route === '账号' ? <AccountPanel /> : route === '任务' ? <TaskPanel /> : route === '工作台' ? <MinimumLoopPanel /> : route === '内容' ? <ContentEditorPanel /> : route === '发布包' ? <PublishingPanel /> : route === '情报' ? <BusinessPanel /> : route === '浏览与收集' ? <BrowserPanel /> : route === '资料库' ? <LibraryPanel /> : <AssetPanel />}
        </main>
        <PiSidebar route={route} />
      </div>
    </FluentProvider>
  );
}
