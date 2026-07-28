import { useEffect, useRef, useState } from 'react';
import { Button, Textarea } from '@fluentui/react-components';
import { ChatRegular, ChevronLeftRegular, ChevronRightRegular, SendRegular } from '@fluentui/react-icons';
import type { RouteName } from './routes';

type Account = { id: string; name: string };
type AgentTask = {
  id: string;
  status: string;
  progress: number;
  parameters: { goal?: string; triggerEvent?: string };
  result?: { summary?: string };
  error?: { message?: string; recovery?: string };
  createdAt: string;
};

export function PiSidebar({ route }: { route: RouteName }) {
  const [collapsed, setCollapsed] = useState(false);
  const [account, setAccount] = useState<Account>();
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastTaskStatus = tasks.at(-1)?.status;

  const load = async () => {
    const [accountResponse, taskResponse] = await Promise.all([
      window.terminal.business.dispatch('account.search', { query: '', limit: 10 }),
      window.terminal.business.dispatch('task.list', { query: 'agent.execute', limit: 50 })
    ]);
    if (accountResponse.ok) setAccount((accountResponse.result as { items: Account[] }).items[0]);
    if (taskResponse.ok) {
      const items = (taskResponse.result as { items: AgentTask[] }).items
        .filter((item) => item.parameters.triggerEvent === 'desktop_chat')
        .reverse();
      setTasks(items);
    }
  };

  useEffect(() => {
    const initial = globalThis.setTimeout(() => void load(), 0);
    const timer = globalThis.setInterval(() => void load(), 1500);
    return () => {
      globalThis.clearTimeout(initial);
      globalThis.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [tasks.length, lastTaskStatus]);

  const send = async () => {
    const message = input.trim();
    if (!message || !account || sending) return;
    setSending(true);
    const response = await window.terminal.business.dispatch('task.start', {
      caller: 'desktop-chat',
      idempotencyKey: crypto.randomUUID(),
      type: 'agent.execute',
      parameters: {
        accountId: account.id,
        triggerEvent: 'desktop_chat',
        goal: `当前页面：${route}\n用户消息：${message}`
      }
    });
    if (response.ok) {
      setInput('');
      await load();
    }
    setSending(false);
  };

  if (collapsed) {
    return <aside className="pi-sidebar collapsed" aria-label="Pi 协作栏">
      <Button appearance="subtle" icon={<ChevronLeftRegular />} aria-label="展开 Pi 协作栏" onClick={() => setCollapsed(false)} />
      <ChatRegular aria-hidden />
      <span>Pi</span>
    </aside>;
  }

  return <aside className="pi-sidebar" aria-label="Pi 协作栏">
    <header>
      <div><ChatRegular aria-hidden /><strong>Pi 协作</strong></div>
      <Button appearance="subtle" icon={<ChevronRightRegular />} aria-label="收起 Pi 协作栏" onClick={() => setCollapsed(true)} />
    </header>
    <div className="pi-context">
      <span>{account ? account.name : '尚未建立账号'}</span>
      <small>当前页面：{route}</small>
    </div>
    <div className="pi-messages" aria-live="polite">
      {!tasks.length && <div className="pi-empty">
        <ChatRegular aria-hidden />
        <strong>从当前工作开始</strong>
        <p>告诉 Pi 要查什么、整理什么或继续哪项内容。执行结果会写回终端。</p>
      </div>}
      {tasks.map((task) => <article key={task.id}>
        <div className="pi-user-message">{task.parameters.goal?.replace(/^当前页面：.*\n用户消息：/, '')}</div>
        <div className={`pi-agent-message ${task.status}`}>
          {task.status === 'succeeded'
            ? task.result?.summary
            : task.status === 'failed'
              ? `${task.error?.message ?? 'Pi 执行失败'}${task.error?.recovery ? `。${task.error.recovery}` : ''}`
              : task.status === 'cancelled'
                ? '已取消'
                : `Pi 正在处理，${task.progress}%`}
          {['queued', 'running'].includes(task.status) &&
            <Button appearance="subtle" size="small" onClick={() => window.terminal.business.dispatch('task.cancel', { taskId: task.id })}>取消</Button>}
        </div>
      </article>)}
      <div ref={endRef} />
    </div>
    <div className="pi-composer">
      <div className="pi-input-wrap">
        <Textarea
          aria-label="给 Pi 发消息"
          resize="vertical"
          value={input}
          disabled={!account || sending}
          placeholder={account ? '让 Pi 从当前页面继续工作…' : '请先在“账号”中建立账号'}
          onChange={(_, data) => setInput(data.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button appearance="primary" size="small" icon={<SendRegular />} aria-label="发送给 Pi"
          disabled={!input.trim() || !account || sending} onClick={() => void send()} />
      </div>
    </div>
  </aside>;
}
