import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './home.css';

function Home() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  return <>
    <a className="skip-link" href="#tools">跳到工具列表</a>
    <header className="site-header">
      <a className="brand" href="./"><img src="./favicon.svg" width="34" height="34" alt="" />梁的工具间</a>
      <nav aria-label="主导航"><a href="#tools">在线工具</a><a href="#about">关于</a><a href="https://github.com/liang-quique" target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a></nav>
    </header>
    <main id="main-content">
      <section className="intro">
        <div><p className="intro-label">liang-quique 的个人空间</p><h1>顺手的工具，<br />留给重要的事。</h1><p className="intro-copy">把学习和工作中用到的小工具放在一起。<br />打开浏览器，从今天的计划开始。</p></div>
        <div className="today"><span>今天</span><time dateTime={now.toISOString()}>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</time><span>{now.toLocaleDateString('zh-CN', { weekday: 'long' })}</span></div>
      </section>
      <section id="tools" aria-labelledby="tools-title">
        <div className="section-heading"><h2 id="tools-title">在线工具</h2><span>从日常需要出发</span></div>
        <article className="featured-tool">
          <div className="feature-info"><span className="available"><i />现在可用</span><h3>日序 <span>Dayline</span></h3><p>写下今天要做的事，<br />一次专注于一项。</p><div className="feature-tags"><span>每日计划</span><span>专注倒计时</span><span>自动安排休息</span></div><a className="open-tool" href="./dayline/">打开日序 <span aria-hidden="true">↗</span></a></div>
          <div className="feature-clock"><span>此刻，刚好开始。</span><div aria-label="当前时间">{now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}</div><p>无需安装 · 无需登录<br />计划保存在当前浏览器</p></div>
        </article>
        <div className="upcoming-tools">
          <article><div className="tool-title"><h3>智析台</h3><span className="coming">网页版筹备中</span></div><p>把 PDF 和图片资料整理成便于阅读、复习的报告。</p><span className="tool-kind">资料整理</span></article>
          <article><div className="tool-title"><h3>AI 标记清理器</h3><span className="coming">网页版筹备中</span></div><p>检查文件中的 AI 来源标记与元数据，清理后复检并另存。</p><span className="tool-kind">文件处理</span></article>
        </div>
      </section>
      <section className="about" id="about"><h2>关于这个工具间</h2><div><p>这里收集我为学习和日常工作制作的小工具，逐步做成随时能打开的网页版。</p><p>目前日序可以直接使用。计划仅保存在当前设备的浏览器中，不会上传；换设备或清除浏览器数据后，计划不会自动同步。</p><a href="https://github.com/liang-quique" target="_blank" rel="noreferrer">在 GitHub 找到我</a></div></section>
    </main>
    <footer className="site-footer"><span>梁的工具间</span><span>把时间留给想做的事。</span></footer>
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Home /></React.StrictMode>);
