# 更新日志

## [Unreleased]

### 修复（复查轮）
- 首屏偶现「没有找到与『』相关的笔记」：搜索状态初始化错误导致首次加载误入搜索分支
- 自动保存草稿此前未生效：编辑器漏接 onChange 回调
- 批量多选无法进入：复选框仅在已有选中项时显示（死锁）；现改为「多选」导航开关模式
- 公开分享链接打开是裸 JSON：新增 `/s/<token>` 只读 HTML 页（服务端渲染、零 JS、内容全转义、带完整安全头）；`.json` 保留给 API
- 分享页补齐 CSP 等安全响应头
- 冷启动首请求可能撞上建表竞态返回 500：schema 等待上限 3 秒
- 清理导入接口遗留死代码、修正 PWA meta 标签拼写

### 新增
- FTS5(tr分词器)全文搜索，支持中文模糊匹配与命中片段高亮
- 公开分享链接：单条笔记可生成一次性 token，公开 `/s/<token>.json` 只读访问
- 客户端图片压缩：超过 1MB 或长边 > 1600px 自动压缩为 JPEG / PNG
- 上传进度条：上传过程中实时显示百分比
- 编辑器自动保存草稿（localStorage），意外刷新可恢复
- 撤销删除：删除笔记进入回收站，toast 提供 5 秒撤销按钮
- 回收站视图：30 天内可恢复或永久删除
- 多选与批量操作：收藏 / 取消收藏 / 批量打标签 / 批量删除
- 标签管理：搜索过滤 + 三种排序（频率/名称/最近使用）+ 重命名 / 合并 / 删除
- 标签右键菜单：在侧栏标签上长按或右键调出
- 公开分享提示：已分享的笔记在卡片右上角显示 🔗
- 24 小时活跃柱状图、热门标签云、本周 vs 上周对比
- 历史最大连续记录天数
- 管理员面板：邮箱搜索、分页、最近登录 / 最近笔记
- PWA：manifest + Service Worker，离线可读、静态资源 stale-while-revalidate
- 国际化：中文 / 英文（侧栏一键切换）
- 会话管理：`GET /api/sessions` 列出当前账号所有活跃设备，单条 / 全部其它设备一键登出
- 导入：从 .md / .markdown / .json 恢复笔记
- 导出增强：支持按标签 / 时间范围 / 收藏过滤，文件名带邮箱 slug
- 结构化日志：每次请求打印 JSON 行（Cloudflare Dashboard 免费看）
- CSP / X-Content-Type-Options / Referrer-Policy / Permissions-Policy 等安全响应头

### 优化
- 数据库迁移改为版本化（migrations 表），新增列不会再因"重复列"报错
- D1 索引：复合索引 `(user_id, pinned, pinned_order, id DESC)` 等支撑收藏排序、回收站筛选
- `memos.word_count` / `random_bucket` 字段，前者加速字数计算、后者让"随机回顾"避免全表 `ORDER BY RANDOM()`
- PBKDF2 迭代从 30000 降到 20000（新写入），仍远超 OWASP 推荐（1000+），登录路径 CPU 时间更可控；旧哈希仍可校验
- 软删除取代物理删除，30 天后由 `/api/trash/purge` 清理
- 删除改为 JOIN 子查询，SQLite 优化器可走索引
- 图片上传限速：每用户每小时最多 100 张
- `X-Forwarded-Proto` 支持（Cloudflare 反向代理后正确识别 HTTPS）

### 修复
- `parseCookies` 跳过空名段（避免空字符串 key 入对象）
- 跨域 X-Forwarded-Proto 场景下 Secure Cookie 标记更准确
- 修复 `select_text` / `appendChild` 边界处的 DOM 节点误替换

### 不做的（守住"100% 免费"）
- Workers AI（每天 10000 neurons ≈ 5 次推理，不够用）
- Cloudflare Images 存储（付费）
- Cloudflare Stream（无免费档）
- Vectorize 语义搜索（D1 trigram 已够）
- Durable Objects / Tail Workers（需 Workers Paid）
- 第三方付费服务

## [1.0.0] - 2026-08

- 邮箱注册 + 验证码 + 找回密码
- 第一个注册用户自动成为管理员
- 多用户隔离：笔记、标签、图片完全按用户隔离
- 收藏、标签、全文搜索（LIKE）、随机回顾、统计面板、热力图
- 图片上传（可选 R2）
- Markdown 导出 / JSON 导出
- 管理员：用户列表、封禁、解封、删除（连带清理）
- 零框架前端：原生 ESM + 设计令牌化的 CSS 变量