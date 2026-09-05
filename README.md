# 梁的工具间

liang-quique 的个人工具网站，第一阶段包含首页和日序网页版。

预定地址：`https://liang-quique.github.io/`。这是目标地址，不代表已经发布。

## 本地预览

需要 Node.js 22.18 或更高版本。

```powershell
npm ci
npm run dev
```

打开终端显示的 `http://127.0.0.1:4173/`。双击 `启动预览.cmd` 也可启动；关闭终端会停止预览。

## 验证与构建

```powershell
npm run test:planner
npm run build
npm run preview -- --host 127.0.0.1 --port 4174
```

构建产物在 `dist/`，首页为 `index.html`，日序为 `dayline/index.html`。使用相对资源路径，同时兼容账号首页和仓库子目录部署。

## 发布到 GitHub Pages

1. 在 GitHub 登录 `liang-quique`，创建公开仓库 `liang-quique.github.io`。若同名仓库已存在，先检查现有内容，不要直接覆盖。
2. 只提交本目录的网站源码及配置，不要提交父目录中的清理器项目、输入文件、缓存、模型或凭据。`node_modules/`、`dist/`、`.env*` 已排除。
3. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
4. 推送到 `main`，或在 Actions 中手动运行 **Deploy personal website**。
5. 工作流依次安装依赖、运行 12 个日程算法场景、构建，并发布。Actions 成功后访问 Pages 显示的网址。

工作流使用标准 Ubuntu runner，部署产物保留 1 天；不配置付费 runner。

## 功能与边界

- 首页：日序入口、后续工具状态、关于本站、GitHub 主页。
- 日序：创建和编辑任务、安排顺序、开始时间、暂停/继续、完成、延时，以及原有休息和饭点逻辑。
- 状态仅保存到当前来源的浏览器 localStorage，不发往服务器，无账号与跨设备同步。
- 网站域名、端口或浏览器改变后使用不同存储；桌面版的数据不会自动迁移。
- 同一天内刷新页面会继续之前状态；新的一天按原有逻辑创建新计划。
- 网页休眠可能延迟提示；关闭网页后不发通知。运行中的计时在重开时按实际经过时间恢复。
- 桌面置顶、贴边悬浮窗在网页版隐藏。
- 智析台和清理器尚未接入处理后端。

日序核心源自原本地 `dayline` 项目。原项目保持不变，网站是独立副本；后续修改日程算法时需同步两个版本。

## 修改网站

- 首页内容：`src/home.tsx`；首页样式：`src/home.css`。
- 日序界面：`src/App.tsx`；算法：`src/planner.ts`。
- 日序浏览器包装和使用说明：`src/main.tsx`。
- 日序原样式：`src/App.css`；网页版覆盖样式：`src/web.css`。
- 发布：`.github/workflows/pages.yml`。

费用说明见 `费用说明.md`。
