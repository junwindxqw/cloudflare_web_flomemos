<div align="center">

# 📝 Flomemos

**轻记录 · 云端便签 —— 像发消息一样记录想法**

基于 Cloudflare 免费服务构建的 flomo 风格单用户笔记应用
Workers + D1 + R2 · 零服务器运维 · 一键部署 · 完全属于你自己的数据

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/junwindxqw/cloudflare_web_flomemos)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)
[![D1](https://img.shields.io/badge/Storage-D1%20·%20R2-brightgreen.svg)](https://developers.cloudflare.com/d1/)

</div>

---

## ✨ 项目简介

**Flomemos** 是一个借鉴 [flomo](https://flomoapp.com/)（浮墨笔记）交互风格的私有化笔记应用。传统的 flomo 是云端服务，数据存在别人的服务器上；Flomemos 把整套体验搬到你自己名下的 **Cloudflare 免费套餐**上——不需要一台服务器，不需要付一分钱，数据 100% 归你所有。

它支持**多用户**：开放注册，**第一个注册的用户自动成为全站唯一管理员**，可以封禁或删除其他用户；每个用户的笔记完全隔离、互不可见。适合个人知识库、家庭/小团队的轻量共享部署。

> 💡 **为什么选择 Workers 而不是 Pages？**
> Cloudflare 官方已推荐新项目使用 Workers 静态资产（Static Assets）替代 Pages。Flomemos 用**一个 Worker** 同时承载前端页面与 API，配置更简单，免费额度也更充裕。

## 🎯 功能特性

### 🖊 增强型 Markdown 编辑器

- **完整工具栏**：加粗、斜体、删除线、H1/H2/H3、引用、无序/有序/任务列表、行内代码、代码块、链接、图片、表格、分割线
- **实时预览**：一键在「编辑」与「预览」之间切换，渲染效果与列表一致
- **智能续写**：回车自动延续列表（`- `、`1. `、`- [ ] `）与引用，空列表项回车自动退出
- **快捷键**：`Ctrl+B` 加粗 · `Ctrl+I` 斜体 · `Ctrl+K` 插入链接 · `Ctrl+Enter` 发送 · `Tab` 缩进
- **图片上传**：直接 **粘贴** 或 **拖拽** 图片到编辑框，> 1MB 自动压缩后上传至 R2 并插入 `![](url)`
- **上传进度**：上传时显示百分比
- **自动保存草稿**：写到一半刷新不丢，提交后自动清除
- **标签补全**：输入 `#` 自动弹出已有标签候选（`startsWith` 优先），↑↓ 选择、Enter 确认

### 🗒 笔记管理

- ⏱ **时间流**：按「今天 / 昨天 / 日期」分组展示，无限滚动加载
- 🏷 **标签系统**：`#标签` 即写即建，支持中文与 `#项目/子项目` 嵌套标签，侧栏搜索过滤 + 三种排序（频率/名称/最近使用）+ 右键重命名 / 合并 / 删除
- 🔍 **全文搜索**：FTS5 + trigram 分词器，中文模糊匹配 + 命中片段高亮
- ⭐ **收藏**：重要笔记一键收藏，独立视图查看
- 🎲 **随机回顾**：随机抽取历史笔记（5 / 10 条切换），像 flomo 一样「每日回顾」
- 🗑 **回收站**：删除笔记 30 天内可一键恢复
- ☑️ **批量操作**：多选笔记后可批量收藏 / 取消收藏 / 打标签 / 删除
- 🔗 **公开分享**：单条笔记可生成公开只读链接
- ✏️ **就地编辑**：点击笔记卡片直接进入编辑态
- 📊 **统计面板**：累计 / 今日 / 7 天 / 当前连续 / **最长连续** / 标签数 + GitHub 风格半年热力图 + **24 小时活跃分布** + **热门标签云** + **本周 vs 上周对比**

### 👥 多用户与管理员

- **邮箱注册**：输入邮箱获取 **4 位数字验证码**（10 分钟有效），验证通过才能设置密码完成注册；之后用**邮箱 + 密码**登录
- **第一个注册的用户自动成为全站唯一管理员**
- **邮箱找回密码**：忘记密码可自助通过邮箱验证码重置（重置后所有旧会话失效）
- 管理员可**封禁 / 解封**用户：被封用户立即退出登录且无法再登录
- 管理员可**删除**用户：连同其全部笔记、标签与图片一并清除（不可恢复）
- 管理员可**搜索 / 分页**查看用户，并看到最近登录与最近笔记时间
- 笔记、标签、统计、导出**完全按用户隔离**，互不可见；图片仅上传者本人可见
- 管理员账号受保护：无法被封禁或删除
- **设备管理**：查看所有活跃会话，一键踢掉其他设备

- **邮箱注册**：输入邮箱获取 **4 位数字验证码**（10 分钟有效），验证通过才能设置密码完成注册；之后用**邮箱 + 密码**登录
- **第一个注册的用户自动成为全站唯一管理员**
- **邮箱找回密码**：忘记密码可自助通过邮箱验证码重置（重置后所有旧会话失效）
- 管理员可**封禁 / 解封**用户：被封用户立即退出登录且无法再登录
- 管理员可**删除**用户：连同其全部笔记、标签与图片一并清除（不可恢复）
- 笔记、标签、统计、导出**完全按用户隔离**，互不可见；图片仅上传者本人可见
- 管理员账号受保护：无法被封禁或删除

### 🔐 账号与数据安全

- 密码以 **PBKDF2 20000 迭代** 散列存储（旧 30000 哈希仍可校验），登录接口带失败限速与常数时间比较
- 会话采用 `HttpOnly + SameSite=Lax` Cookie，登录态 30 天有效
- 所有写操作做同源（Origin）校验；Markdown 渲染经 **DOMPurify** 消毒，杜绝 XSS
- CSP / X-Content-Type-Options / Referrer-Policy / Permissions-Policy 等响应头由 Worker 统一加

### 🧰 数据自主

- 一键导出全部笔记为 **Markdown** 或 **JSON** 文件，可按标签 / 时间范围 / 收藏过滤
- 支持从 `.md` / `.markdown` / `.json` 文件导入
- 数据库结构版本化迁移，部署即用，无需手动初始化

### 🌍 国际化

- 中文（默认）/ 英文，侧栏按钮一键切换，浏览器首次访问按语言自动选

## 🚀 快速开始

### 方式一：一键部署（推荐）

1. 点击上方 **Deploy to Cloudflare** 按钮（或访问 `https://deploy.workers.cloudflare.com/?url=<你的仓库地址>`）
2. 授权 GitHub 并选择账号，Cloudflare 会自动：
   - 复刻仓库到你的 GitHub
   - 创建并绑定 **D1 数据库** 与 **R2 存储桶**
   - 构建并部署 Worker
3. 部署完成后打开分配的 `*.workers.dev` 域名，**首次访问会提示创建账号**，设置用户名密码即可使用 🎉

> 想在部署时就指定账号密码？在 Worker 的 **Settings → Variables** 中添加 `AUTH_USERNAME` 与 `AUTH_PASSWORD`（推荐用加密的 Secret 类型），之后页面初始化流程会自动关闭，以环境变量为准。

### 方式二：命令行部署（Wrangler CLI）

```bash
# 1. 克隆项目并安装依赖
git clone https://github.com/junwindxqw/cloudflare_web_flomemos.git flomemos && cd flomemos
npm install

# 2. 登录 Cloudflare（浏览器授权）
npx wrangler login

# 3. 部署（wrangler 会自动创建并绑定 D1 数据库与 R2 存储桶；
#    若提示确认创建资源，直接确认即可）
npm run deploy

# 4. 打开输出的 https://flomemos.<你的子域>.workers.dev，创建账号，开始记录！
```

<details>
<summary>🔧 手动创建资源（可选，适合精细管控）</summary>

```bash
# 创建 D1 数据库，把输出的 id 填入 wrangler.jsonc 的 d1_databases.database_id
npx wrangler d1 create flomemos

# 创建 R2 存储桶（仅图片上传需要；R2 开通需在控制台绑定付款方式，免费额度内不扣费）
npx wrangler r2 bucket create flomemos-files

# 手动初始化数据库结构（应用也会在首次请求时自动建表，此步可跳过）
npm run db:init-remote
```

</details>

### 本地开发

```bash
npm install
npm run dev        # 启动 wrangler dev，访问 http://localhost:8787
```

本地开发同样使用本地模拟的 D1 / R2，无需 Cloudflare 账号。可选复制 `.dev.vars.example` 为 `.dev.vars` 配置本地测试账号。

## ⚙️ 配置说明

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `RESEND_API_KEY` | **是** | [Resend](https://resend.com) 的 API Key（免费 100 封/天），用于发送注册/找回密码验证码。用 `npx wrangler secret put RESEND_API_KEY` 写入 |
| `MAIL_FROM` | 否 | 发件人，如 `Flomemos <noreply@yourdomain.com>`（域名需在 Resend 完成验证）。未配置时使用 Resend 沙箱发件人，只能发给自己 Resend 账号的邮箱 |
| `DEV_EXPOSE_CODE` | 否 | ⚠️ 仅限本地开发：设为 `1` 时跳过真实发信、把验证码直接返回在接口响应里。生产环境绝对不要开启 |

> **配置邮箱服务的步骤**：① 注册 [resend.com](https://resend.com)（免费）；② Domains 里添加你的域名，按提示在 Cloudflare DNS 加几条记录完成验证；③ API Keys 里创建密钥；④ 执行 `npx wrangler secret put RESEND_API_KEY` 粘贴密钥；⑤ 控制台给 Worker 添加变量 `MAIL_FROM`。不配置时注册/找回密码功能会明确提示"邮件服务未配置"。

| 绑定资源 | 用途 | 免费额度（每日/每月） |
| --- | --- | --- |
| **Workers** | 承载前端静态资源 + API | 10 万次请求/天 |
| **D1** | 笔记、标签、会话、账号 | 500 万行读取/天 · 10 万行写入/天 · 5 GB 存储 |
| **R2**（可选） | 图片附件存储 | 10 GB 存储 · 100 万次 A 类操作/月 |

> 不需要图片上传？不创建 R2 存储桶即可，其余功能完全不受影响（上传按钮会友好提示未启用）。

## 💸 100% Cloudflare 免费档

Flomemos 严格使用 Cloudflare 免费档服务，**不引入任何付费档能力**：

| 服务 | 用途 | 免费档额度 |
| --- | --- | --- |
| **Workers** | 承载前端 + API | 10 万次请求/天，10ms CPU/次 |
| **D1** | 笔记、标签、会话、账号 | 500 万行读/天，10 万行写/天，5 GB 存储 |
| **R2**（可选） | 图片附件 | 10 GB 存储，100 万 Class A / 月，免费出口流量 |
| **Resend**（可选） | 验证码邮件 | 100 封/天 |

明确**不**使用的服务（会越界到付费）：Workers Paid、Workers AI、Cloudflare Images、Cloudflare Stream、Vectorize、Tail Workers、Durable Objects。

R2 提示：开通 R2 必须在 Cloudflare 控制台绑定付款方式（即便免费档内不扣费，这是 Cloudflare 的要求），其它服务零门槛。

## 🧪 本地测试

```bash
npm install
npm test          # 跑 vitest 单测（标签提取、密码哈希兼容、同源校验）
npm run dev       # wrangler dev 启动本地预览 http://localhost:8787
```

## ⌨️ 快捷键

| 按键 | 功能 |
| --- | --- |
| `Ctrl + Enter` | 发送 / 保存笔记 |
| `Ctrl + B` | 加粗选中文本 |
| `Ctrl + I` | 斜体选中文本 |
| `Ctrl + K` | 插入链接 |
| `Enter` | 列表 / 引用自动续写 |
| `Tab` | 缩进两格 |
| `#` | 触发标签自动补全 |
| 粘贴 / 拖拽图片 | 自动上传并插入 |

## 📁 项目结构

```
flomemos/
├── src/                  # Cloudflare Worker 后端
│   ├── index.js          # 路由与全部 API（笔记 / 标签 / 分享 / 搜索 / 上传 / 导出 / 导入 / 管理员）
│   ├── search.js         # FTS5 全文搜索 + 高亮
│   ├── auth.js           # PBKDF2 密码散列 + D1 会话 / 设备管理
│   ├── mail.js           # Resend 验证码邮件
│   ├── tags.js           # #标签 提取规则（支持中文与嵌套）
│   └── migrate.js        # 数据库结构版本化迁移
├── public/               # 前端（零构建，原生 ES Module）
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── assets/
│   │   ├── app.js        # 应用主体（列表 / 弹窗 / 主题 / 路由 / 统计）
│   │   ├── editor.js     # Markdown 编辑器（压缩 / 续写 / 标签补全 / 草稿）
│   │   ├── md.js         # Markdown 渲染 + 标签链接化
│   │   ├── api.js        # 请求封装（含 XHR 进度回调）
│   │   ├── i18n.js       # 中文 / 英文文案
│   │   ├── sw.js         # Service Worker（离线缓存）
│   │   └── style.css     # flomo 风格样式（亮 / 暗 / 自动 主题）
│   └── vendor/           # 本地化的 marked 与 DOMPurify
├── tests/                # vitest 单测
├── schema.sql            # 数据库结构（参考 / 手动初始化）
├── .github/workflows/     # CI：push/PR 跑 vitest
├── wrangler.jsonc        # Cloudflare 部署配置
└── package.json
```

## ❓ 常见问题

<details>
<summary><b>如何修改 / 找回密码？</b></summary>

登录页的「找回密码」标签页即可自助完成：输入注册邮箱 → 接收 4 位验证码 → 设置新密码。重置成功后所有已登录的会话会立即失效，需要用新密码重新登录。
</details>

<details>
<summary><b>忘记管理员密码怎么办？</b></summary>

与普通用户相同，用「找回密码」自助重置即可。管理员账号本身无法被他人封禁或删除。
</details>

<details>
<summary><b>收不到验证码？</b></summary>

依次检查：① Worker 是否已配置 `RESEND_API_KEY`（未配置时页面会提示"邮件服务未配置"）；② `MAIL_FROM` 的域名是否已在 Resend 完成验证；③ 检查垃圾邮件箱；④ 同一邮箱 60 秒内只能发一次，验证码 10 分钟有效、最多试 5 次。
</details>

<details>
<summary><b>从旧版（用户名制）升级会丢数据吗？</b></summary>

邮箱制改版与旧用户名结构不兼容，本次升级按要求**清空了全部旧数据**（用户、笔记、图片记录）。如需保留旧数据再升级，需要自行编写数据迁移脚本。
</details>

<details>
<summary><b>如何备份数据？</b></summary>

侧栏底部的「导出 Markdown / 导出 JSON」随时可下载全部笔记。如需完整备份 D1，可用 `npx wrangler d1 export flomemos --remote --output=backup.sql`。
</details>

<details>
<summary><b>免费额度够用吗？</b></summary>

对个人单用户绰绰有余：免费 Workers 每天十万次请求，D1 每天百万级读取。按一天记录 50 条、刷新 200 次估算，连额度的 1% 都用不到。
</details>

<details>
<summary><b>图片上传不可用？</b></summary>

检查是否已创建 R2 存储桶并绑定（`wrangler.jsonc` 中的 `r2_buckets`）。R2 开通需要在 Cloudflare 控制台添加付款方式（免费额度内不产生费用），这是 Cloudflare 的要求而非本项目。
</details>

<details>
<summary><b>标签的规则是什么？</b></summary>

`#` 后紧跟任意字母/数字/中文/`-`/`/` 即为标签（如 `#读书`、`#工作/项目A`），`#` 需出现在行首或空格后；Markdown 标题（`# ` 后带空格）不会被误判为标签。
</details>

## 🛠 技术栈

![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla%20JS%20·%20ESM-yellow)
![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-orange)
![D1](https://img.shields.io/badge/Database-Cloudflare%20D1%20(SQLite)-green)
![R2](https://img.shields.io/badge/Files-Cloudflare%20R2-blue)
![marked](https://img.shields.io/badge/Markdown-marked%2015-black)
![DOMPurify](https://img.shields.io/badge/Security-DOMPurify%203-9cf)

前端刻意保持**零框架、零构建**：原生 ES Module + 设计令牌化的 CSS 变量，整个前端没有一行需要编译的代码，`git clone` 即是完整产物，十年后依然能跑。Markdown 渲染使用 [marked](https://github.com/markedjs/marked)（GFM）+ [DOMPurify](https://github.com/cure53/DOMPurify)，均已本地化打包，无任何 CDN 依赖。

## 📄 许可证

[MIT](LICENSE) © 2026 junwindxqw

<div align="center">

**如果这个项目对你有帮助，欢迎点个 Star ⭐**

*记录，是为了更好地思考。*

</div>
