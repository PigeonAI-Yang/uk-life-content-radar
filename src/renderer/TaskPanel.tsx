import { useEffect, useState } from 'react';
import { Button, ProgressBar } from '@fluentui/react-components';

type Task = {
  id: string;
  type: string;
  status: string;
  progress: number;
  temporaryResult?: string;
  result?: unknown;
  error?: { code: string; message: string };
};

export function TaskPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const statusNames: Record<string, string> = {
    queued: '排队中', running: '执行中', succeeded: '已完成',
    failed: '失败（failed）', partial: '部分成功（partial）', cancelled: '已取消（cancelled）', interrupted: '已中断（interrupted）'
  };
  const typeNames: Record<string, string> = {
    'agent.execute': 'Pi 接力工作',
    'file.write': '写入文件',
    'file.write_batch': '批量写入文件'
  };
  const resultText = (value: unknown) => {
    if (!value || typeof value !== 'object') return value ? String(value) : '—';
    const item = value as { filePath?: string; succeeded?: number; failed?: number };
    return item.filePath ?? (item.succeeded !== undefined ? `成功 ${item.succeeded} 项，失败 ${item.failed ?? 0} 项` : '已有结果');
  };
  const temporaryText = (value?: string) => value?.startsWith('retained:')
    ? `临时产物已保留：${value.slice('retained:'.length)}`
    : value === 'removed' ? '未提交临时产物' : value === 'committed' ? '已提交磁盘产物' : value ?? '—';

  const refresh = async () => {
    const result = await window.terminal.business.dispatch('task.list', { query: '', limit: 25 });
    if (result.ok) setTasks((result.result as { items: Task[] }).items);
  };

  useEffect(() => {
    void window.terminal.business.dispatch('task.list', { query: '', limit: 25 }).then((result) => {
      if (result.ok) setTasks((result.result as { items: Task[] }).items);
    });
  }, []);

  const cancel = async (taskId: string) => {
    await window.terminal.business.dispatch('task.cancel', { taskId });
    await refresh();
  };

  return (
    <section className="task-panel">
      <div className="page-heading">
        <div><h2>任务</h2><p>查看 Pi 接力工作和真实产物；需要时可取消正在运行的任务。</p></div>
        <div><Button onClick={refresh}>刷新</Button></div>
      </div>
      {tasks.length === 0 ? <p>暂无任务。</p> : tasks.map((task) => (
        <div className="task-row" key={task.id}>
          <strong>{typeNames[task.type] ?? task.type}</strong>
          <span>{statusNames[task.status] ?? task.status}</span>
          <ProgressBar value={task.progress / 100} />
          <div className="task-detail">
            <span>{temporaryText(task.temporaryResult)}</span>
            {Boolean(task.result) && <span>{resultText(task.result)}</span>}
            {task.error && <span role="alert">{task.error.code}: {task.error.message}</span>}
          </div>
          {['queued', 'running'].includes(task.status) && <Button onClick={() => cancel(task.id)}>取消</Button>}
        </div>
      ))}
    </section>
  );
}
