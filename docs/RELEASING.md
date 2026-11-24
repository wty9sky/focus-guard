# 发布流程（GitHub Releases + Packages）

本项目的发布完全由 GitHub Actions 承担：**打一个 tag，剩下的自动完成**。

| 工作流 | 文件 | 触发 | 产出 |
| --- | --- | --- | --- |
| Release | `.github/workflows/release.yml` | 推送 `v*` tag / 手动 | GitHub Release + 两个 zip 产物 |
| Package | `.github/workflows/package.yml` | Release 发布后 / 手动 | 把源码发布到 GitHub Packages（npm） |

---

## 一、发一次版本的完整步骤

```bash
# 1. 改版本号（语义化：修复 1.0.1 / 新增功能 1.1.0 / 破坏性变更 2.0.0）
npm version 1.1.0 --no-git-tag-version

# 2. 把 tag 之后的提交归档进 CHANGELOG 的自动区间（人工再润色）
npm run changelog -- --write

# 3. 本地自检：版本 / tag / CHANGELOG 三者是否一致
npm run changelog -- --check

# 4. 提交并打 tag
git add -A && git commit -m "chore(release): 1.1.0"
git tag v1.1.0
git push origin master --tags
```

推送 tag 之后，Release 工作流会自动：

1. `npm ci` 安装依赖
2. `npm run changelog -- --check` 校验一致性（不一致直接失败，避免发出错误版本）
3. `npm run pack` 构建并打出两个包
4. 从 `CHANGELOG.md` 提取本版本段落（找不到则回退到 `docs/release-<version>.md`），作为 Release 说明正文
5. `gh release create` 创建 Release 并上传产物；已存在则改为覆盖产物 + 更新说明（可重复执行）

产物命名固定：

```
focus-guard-<version>-chrome.zip   插件包，解压后直接「加载已解压的扩展程序」
focus-guard-<version>-code.zip     纯源码包，不含 docs / scripts，解压后 npm ci && npm run build
```

---

## 二、GitHub Packages（可选的源码分发渠道）

Release 发布成功后，Package 工作流会把源码发布到 npm registry：

```
npm.pkg.github.com/@<owner>/focus-guard
```

发布前会由 `scripts/prepare-package.mjs` 改写 `package.json`，因为 GitHub Packages 有硬性要求：

| 要求 | 处理 |
| --- | --- |
| 包名必须带 scope 且等于仓库 owner | 动态改成 `@<owner>/focus-guard`（强制小写） |
| 不能是 `private: true` | 删除该字段 |
| 需要 `publishConfig.registry` | 指向 `https://npm.pkg.github.com` |
| 只发布需要的文件 | `files: ["src", "public", "vite.config.js", "README.md"]` |
| 发布后的包能自己构建 | `scripts` 精简为 `vite build`（`scripts/` 目录不发布） |

这些改写只发生在 CI 的临时工作区，不会改动仓库里的 `package.json`。

### 安装（含私有仓库）

```bash
# 1. 建一个只勾 read:packages 的 Personal Access Token（classic）
# 2. 写 .npmrc
cat > ~/.npmrc <<'EOF'
@<owner>:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<YOUR_TOKEN>
EOF

# 3. 安装
npm install @<owner>/focus-guard
```

> 只想要插件的话，直接用 Release 里的 `-chrome.zip` 就行，不必装 Packages。
> Packages 的意义在于：源码可以像普通 npm 依赖一样被引用/版本化（比如自己开个脚本仓库装它）。

---

## 三、手动重跑

两个工作流都支持 `workflow_dispatch`，在 Actions 页面点「Run workflow」并填一个已存在的 tag 即可：

- Release 已存在时，会覆盖同名产物并更新说明，不会报错
- Package 重复发布同一个版本会被 npm 拒绝（版本号必须唯一）——需要重发就先升版本号

---

## 四、仓库设置检查

| 项目 | 说明 |
| --- | --- |
| Actions 权限 | 仓库 Settings → Actions → General → Workflow permissions 选 **Read and write**（Release 上传产物需要 `contents: write`） |
| Packages 权限 | `package.yml` 已声明 `packages: write`，使用内置 `GITHUB_TOKEN` 即可，无需额外 secret |
| 私有仓库的 Packages | 包默认继承仓库可见性；对外分享需要在包设置里单独调整 |
| fork 的仓库 | 无需改动，`GITHUB_REPOSITORY_OWNER` 会自动指向 fork 的 owner |

---

## 五、可选：加个状态徽章

把下面片段里的 `OWNER` 换成你的 GitHub 用户名，贴进 `README.md` 顶部：

```markdown
[![Release](https://github.com/OWNER/focus-guard/actions/workflows/release.yml/badge.svg)](https://github.com/OWNER/focus-guard/actions/workflows/release.yml)
[![Package](https://github.com/OWNER/focus-guard/actions/workflows/package.yml/badge.svg)](https://github.com/OWNER/focus-guard/actions/workflows/package.yml)
```
