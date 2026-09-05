import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './web.css';

function DaylineWeb() {
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const failed = () => setStorageError(true);
    window.addEventListener('dayline-storage-error', failed);
    try { localStorage.setItem('dayline-storage-probe', '1'); localStorage.removeItem('dayline-storage-probe'); } catch { failed(); }
    return () => window.removeEventListener('dayline-storage-error', failed);
  }, []);
  return <>
    <header className="web-header"><a href="../">‹ 梁的工具间</a><div><strong>日序</strong><span>Dayline</span></div><details className="web-help"><summary>使用说明</summary><div><p>任务和计时状态自动保存在当前浏览器，刷新后可继续。同一天内关闭页面后，运行中的计时仍按实际经过时间计算。</p><p>请保持页面打开以看到到时提示。浏览器休眠时，提示可能延后。网页版不提供桌面置顶悬浮窗。</p><p>数据不上传，也不跨设备同步。清除浏览器数据会删除计划；新的一天会自动开始新计划。</p></div></details></header>
    {storageError && <div className="storage-error" role="alert">浏览器无法保存计划。当前仍可使用，但刷新或关闭后可能丢失，请开启此网站的本地存储权限。</div>}
    <App />
  </>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><DaylineWeb /></React.StrictMode>);
