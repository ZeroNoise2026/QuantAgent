# Phase 1 — User Account (Supabase Auth) 设计方案

> 分支：`feature/user-accounts-and-files`
> 范围：把现有 ChatbotUI 的"假 user_id (localStorage)"替换为真实 Supabase Auth 账号
> 预估：3–4 天
> 决策已锁定：方案 X (service_role + RLS 兜底) · 清空老数据 · Email/密码 only · Legacy HS256 JWT 验证

---

## 一、系统总架构（鸟瞰）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              用户浏览器                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  React App  (Vite, port 5173 dev)                                    │   │
│  │                                                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ /login      │  │ /signup      │  │  (public)    │                │   │
│  │  └──────┬──────┘  └──────┬───────┘  └──────────────┘                │   │
│  │         │                 │                                          │   │
│  │         ▼                 ▼          ┌──────────────────────┐       │   │
│  │  ┌──────────────────────────────┐    │  ProtectedRoute       │       │   │
│  │  │  AuthContext  (session, user) │───▶│  (gate)              │       │   │
│  │  │  + supabaseClient             │    └─────────┬────────────┘       │   │
│  │  └──────────────────────────────┘              │                    │   │
│  │                                                ▼                    │   │
│  │                          ┌─────────┬──────────┬──────────┬────────┐ │   │
│  │                          │/briefing│/watchlist│ /chat    │ /files │ │   │
│  │                          └─────────┴──────────┴──────────┴────────┘ │   │
│  │                                                          (Phase 2+) │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└────────────┬────────────────────────────────────────────────┬────────────────┘
             │                                                │
             │ ① POST /auth/v1/token  (email+pwd)             │ ② Authorization:
             │    返回 JWT (access_token)                      │    Bearer <JWT>
             ▼                                                ▼
    ┌──────────────────────┐                  ┌──────────────────────────────┐
    │   Supabase Auth      │                  │  FastAPI backend  (port 8000) │
    │  (auth.users table)  │                  │                              │
    │                      │                  │  ┌────────────────────────┐  │
    │  ─ JWT 签发           │                  │  │ auth.py                │  │
    │  ─ 邮箱/密码           │◀──── ④ JWKS or ──│  │  verify_jwt(token)     │  │
    │  ─ JWT secret (HS256) │     HS256 secret │  │   → user_id (UUID)     │  │
    └──────────────────────┘                  │  └────────────┬───────────┘  │
                                              │               │              │
                                              │               ▼              │
                                              │  ┌────────────────────────┐  │
                                              │  │ main.py routes         │  │
                                              │  │  Depends(current_user) │  │
                                              │  └────────────┬───────────┘  │
                                              │               │              │
                                              │               ▼              │
                                              │  ┌────────────────────────┐  │
                                              │  │ db.py (service_role)   │  │
                                              │  │  .eq("user_id", uid)   │  │
                                              │  └────────────┬───────────┘  │
                                              └───────────────┼──────────────┘
                                                              │ ③ SQL (绕 RLS)
                                                              ▼
                                              ┌──────────────────────────────┐
                                              │  Supabase Postgres            │
                                              │                              │
                                              │  auth.users (UUID PK) ◀──┐   │
                                              │                          │   │
                                              │  chat_sessions    ─FK───┤   │
                                              │  chat_messages    ─FK───┤   │
                                              │  user_watchlist   ─FK───┤   │
                                              │  user_preferences ─FK───┤   │
                                              │  daily_briefings  ─FK───┘   │
                                              │                              │
                                              │  ★ RLS enabled (兜底)         │
                                              │    policy: auth.uid()=user_id│
                                              └──────────────────────────────┘
```

---

## 二、关键流程（4 个时序图）

### 流程 ① 注册 / 登录（前端 → Supabase 直连）

```
Browser           SupabaseClient            Supabase Auth          Postgres
  │ "邮箱+密码"      │                          │                      │
  ├───────────────▶│  signUp() / signIn()      │                      │
  │                ├─────────────────────────▶│  验证                  │
  │                │                          ├────────────────────▶│ INSERT auth.users
  │                │                          │◀────────────────────│
  │                │◀─────────────────────────│  {access_token, user}│
  │  ◀─────────────│                          │                      │
  │  存 sessionStorage / Supabase 自动管理       │                      │
```

### 流程 ② 业务请求（带 JWT 调后端）

```
Browser              FastAPI                Supabase
  │ Authorization:    │                       │
  │ Bearer <JWT>      │                       │
  ├─────────────────▶│  auth.verify_jwt()    │
  │                  │   解 token → user_id    │
  │                  │                       │
  │                  │  db.list_sessions(user_id)
  │                  ├──────────────────────▶│  SELECT * WHERE user_id=$1
  │                  │◀──────────────────────│
  │ JSON ◀───────────│                       │
```

### 流程 ③ JWT 过期 / 刷新（前端自动）

```
SupabaseClient 内置 onAuthStateChange + autoRefreshToken
  ├─ 每次 fetch 前 supabase.auth.getSession() 拿当前 token
  └─ token 快过期时自动用 refresh_token 换新 → 业务无感知
```

### 流程 ④ 未登录访问受保护页

```
User 访问 /chat
  │
  ▼
ProtectedRoute 检查 AuthContext.session
  │
  ├── null  ──▶  <Navigate to="/login" replace />
  └── 有 session ──▶ 渲染 <ChatPage/>
```

---

## 三、文件改动总览

```
ChatbotUI/
├── backend/
│   ├── .env                     ✏️ 加 SUPABASE_JWT_SECRET
│   ├── .env.example             ➕ 新建
│   ├── auth.py                  ➕ 新建：verify_jwt + Depends
│   ├── config.py                ✏️ 加 SUPABASE_JWT_SECRET 读取
│   ├── main.py                  ✏️ 所有路由 Depends(get_current_user)
│   ├── db.py                    ✏️ user_id 参数从 str → UUID-str (no-op，已经是 str)
│   ├── requirements.txt         ✏️ +pyjwt[crypto]
│   └── migrations/
│       └── 002_auth_uuid_rls.sql   ➕ 新建：TEXT→UUID + RLS policies
│
└── frontend/
    ├── .env.local               ➕ 新建：VITE_SUPABASE_URL / PUBLISHABLE_KEY
    ├── .env.example             ➕ 新建
    ├── package.json             ✏️ +@supabase/supabase-js
    └── src/
        ├── App.jsx              ✏️ 改用 react-router-dom <Routes>
        ├── api.js               ✏️ Bearer JWT 替换 X-User-Id
        ├── auth/                ➕ 新目录
        │   ├── supabaseClient.js
        │   ├── AuthContext.jsx
        │   └── ProtectedRoute.jsx
        ├── pages/
        │   ├── LoginPage.jsx    ➕ 新建
        │   ├── SignupPage.jsx   ➕ 新建
        │   ├── BriefingPage.jsx  (不动)
        │   ├── WatchlistPage.jsx (不动)
        │   └── ChatPage.jsx      (不动)
        └── components/
            └── Sidebar.jsx       ✏️ 加"登出"按钮
```

---

## 四、数据库 schema 变化（before / after）

```
BEFORE                                    AFTER
─────────────────                         ──────────────────────────
chat_sessions                             chat_sessions
  id           TEXT PK                       id           TEXT PK
  user_id      TEXT          ──────────▶     user_id      UUID FK→auth.users(id)
  title        TEXT                          title        TEXT
  ...                                        ...
  (no RLS)                                   ★ RLS: auth.uid()=user_id

user_watchlist                            user_watchlist
  user_id      TEXT          ──────────▶     user_id      UUID FK→auth.users(id)
  ticker       TEXT                          ticker       TEXT
  (no RLS)                                   ★ RLS

(其他 user_* 表同样改造)

auth.users  ←──────  Supabase 自动管理，我们不动
  id           UUID PK
  email        TEXT
  encrypted_password ...
```

**老数据处理**：迁移脚本开头先 `TRUNCATE` 那 4 张表（已确认清空）。

---

## 五、Phase 1 安全模型 = "双重保险"

```
┌─────────────────────────────────────────────────────────────┐
│  保险 1：FastAPI 层 (主防线)                                  │
│   ─ 每个请求必须带合法 JWT                                     │
│   ─ 从 JWT 解出 user_id，db.py 的 WHERE 条件强制带上            │
│                                                             │
│  保险 2：Postgres RLS (兜底)                                  │
│   ─ 即使后端代码 bug 漏掉 WHERE，RLS 也会拦                     │
│   ─ ⚠️ service_role key 会绕过 RLS，所以这层只对             │
│      "未来用用户 JWT 直连 Supabase" 的场景生效                  │
│   ─ 现在主要价值：万一 service key 泄漏，攻击者用 anon key       │
│      就只能看到自己的数据                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、风险与边界

| 风险 | 缓解 |
|---|---|
| JWT secret 泄漏 → 任意用户被伪造 | `.env` 不入 git；CI/部署用 secrets manager |
| service_role key 泄漏 → 全库可读写 | 同上 + RLS 兜底（限 anon key 路径） |
| 用户切机器 → 历史 chat 没了 | ✅ 已解决：现在按 auth.users.id 关联，跨设备登录即恢复 |
| JWT 过期中途 | supabase-js 自动 refresh，前端无感 |
| 老 X-User-Id 数据 | 迁移时 TRUNCATE（dev 环境，已确认） |
| Supabase Auth 服务挂 | 不可用期间无法登录；已登录用户在 token 有效期内（默认 1h）仍可用 |

---

## 七、Phase 1 不做的事（明确划线）

- ❌ Google / GitHub OAuth（email-only）
- ❌ 邮箱验证 / 找回密码（dev 阶段不需要，后续 1 行配置启用）
- ❌ 用户资料页 / 修改密码 UI（先用 Supabase Dashboard 管理）
- ❌ 把后端从 service_role 切到 user JWT 直连（方案 Y，未来再说）
- ❌ 文件上传 / 文件分析 / 文件生成（Phase 2-4）

---

## 八、任务拆分

| # | 任务 | 文件 |
|---|---|---|
| 1 | 写 migration 002（user_id → UUID + RLS） | `backend/migrations/002_auth_uuid_rls.sql` |
| 2 | 后端 JWT 验证模块 | `backend/auth.py`, `backend/config.py` |
| 3 | 替换 main.py 所有 `_get_user_id` | `backend/main.py` |
| 4 | 后端依赖 | `backend/requirements.txt` (+`pyjwt`) |
| 5 | 前端 Supabase 客户端 + AuthContext | `frontend/src/auth/*` |
| 6 | LoginPage + SignupPage | `frontend/src/pages/*` |
| 7 | ProtectedRoute + react-router 改造 App.jsx | `frontend/src/App.jsx` |
| 8 | api.js 改用 Bearer token | `frontend/src/api.js` |
| 9 | 前端依赖 | `frontend/package.json` (+`@supabase/supabase-js`) |
| 10 | 文档 + .env.example | `README.md`, `.env.example` |

---

## 九、后续 Phase（仅备忘，本阶段不实现）

- **Phase 2** 文件上传 + 预览（Excel/CSV/PDF）— 1 周
- **Phase 3** Agent 分析（pandas 沙箱）— 1.5 周
- **Phase 4** Agent 生成（Level 3 多步规划 + Excel/图表/报告）— 1.5 周
