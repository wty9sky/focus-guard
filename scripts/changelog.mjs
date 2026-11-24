#!/usr/bin/env node
/**
 * 让 CHANGELOG 跟着 git 进度走（零依赖）
 *
 * 读取「上一个版本 tag .. HEAD」的提交记录，按 Conventional Commits 分组生成 Markdown，
 * 只填写 CHANGELOG.md 里 <!-- auto:start --> 与 <!-- auto:end --> 之间的自动区间，
 * 人工撰写的版本条目、设计取舍、已知限制等不会被覆盖。
 *
 * 用法：
 *   npm run changelog              # 预览（同时写出 CHANGELOG.next.md 草稿）
 *   npm run changelog -- --write   # 写入 CHANGELOG.md 的自动区间
 *   npm run changelog -- --check   # 发版前校验：版本条目 / tag / 未归档提交
 *   npm run changelog -- --all     # 连带显示 docs/chore/style 等次要提交
 *
 * 提交信息规范：<type>(<scope>): <subject>
 *   feat(popup): 增加严格模式开关
 *   fix(reward): 修复积分锚点未持久化
 *   feat!: 重写状态结构            ← 或正文含 BREAKING CHANGE: 会自动归入破坏性变更
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = path.join(root, 'CHANGELOG.md')
const draftPath = path.join(root, 'CHANGELOG.next.md')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)

const AUTO_START = '<!-- auto:start -->'
const AUTO_END = '<!-- auto:end -->'

const SECTIONS = [
  { type: 'feat', title: '新增' },
  { type: 'fix', title: '修复' },
  { type: 'perf', title: '性能' },
  { type: 'refactor', title: '重构' },
  { type: 'style', title: '样式', minor: true },
  { type: 'docs', title: '文档', minor: true },
  { type: 'build', title: '构建', minor: true },
  { type: 'ci', title: '流水线', minor: true },
  { type: 'test', title: '测试', minor: true },
  { type: 'chore', title: '杂项', minor: true }
]

const c = {
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`
}

/* ---------------- git ---------------- */
function git(args, { allowFail = false } = {}) {
  const res = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (res.status !== 0) {
    if (allowFail) return ''
    console.error(c.red('✗ git 执行失败：git ' + args.join(' ')))
    console.error(c.gray((res.stderr || '').trim()))
    process.exit(1)
  }
  return res.stdout.trim()
}

function readPkg() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
}

/** 最近一个版本 tag（按创建时间），没有则返回空串 */
function latestTag() {
  const tags = git(['tag', '--sort=-creatordate'], { allowFail: true })
  return tags ? tags.split('\n')[0].trim() : ''
}

function commitCount() {
  const out = git(['rev-list', '--count', 'HEAD'], { allowFail: true })
  return Number(out) || 0
}

/* ---------------- 解析提交 ---------------- */
const TYPE_RE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/

function readCommits(range) {
  const fmt = ['%H', '%s', '%b'].join('%x1f') + '%x1e'
  const raw = git(['log', range, `--pretty=format:${fmt}`, '--no-merges'], { allowFail: true })
  if (!raw) return []

  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, subject, body = ''] = chunk.split('\x1f')
      const match = TYPE_RE.exec(subject || '')
      const breaking = /BREAKING[ -]CHANGE/i.test(body) || (match && match[3] === '!')
      return {
        hash,
        short: (hash || '').slice(0, 7),
        subject: subject || '',
        body: body || '',
        type: match ? match[1].toLowerCase() : '',
        scope: match ? (match[2] || '').trim() : '',
        text: match ? match[4].trim() : subject || '',
        breaking: !!breaking
      }
    })
}

/* ---------------- 生成 Markdown ---------------- */
function render(commits, { includeMinor = false } = {}) {
  const breaking = commits.filter((x) => x.breaking)
  const groups = new Map()

  for (const commit of commits) {
    const section = SECTIONS.find((s) => s.type === commit.type)
    if (!section) continue
    if (section.minor && !includeMinor) continue
    if (!groups.has(section.title)) groups.set(section.title, [])
    groups.get(section.title).push(commit)
  }

  const line = (commit) => {
    const scope = commit.scope ? `**${commit.scope}** ` : ''
    return `- ${scope}${commit.text} (${commit.short})`
  }

  const blocks = []
  if (breaking.length) {
    blocks.push(`#### 破坏性变更\n\n${breaking.map((x) => `- ${x.text} (${x.short})`).join('\n')}`)
  }
  for (const section of SECTIONS) {
    const list = groups.get(section.title)
    if (!list || !list.length) continue
    blocks.push(`#### ${section.title}\n\n${list.map(line).join('\n')}`)
  }

  return blocks.join('\n\n')
}

/* ---------------- 自动区间 ---------------- */
function readChangelog() {
  if (!fs.existsSync(changelogPath)) return ''
  return fs.readFileSync(changelogPath, 'utf8')
}

function writeAutoBlock(content) {
  const text = readChangelog()
  const start = text.indexOf(AUTO_START)
  const end = text.indexOf(AUTO_END)
  if (start < 0 || end < 0 || end < start) {
    console.error(c.red('✗ CHANGELOG.md 里找不到自动区间标记'))
    console.error(c.gray(`  需要在文件里保留 ${AUTO_START} 与 ${AUTO_END} 两行`))
    process.exit(1)
  }
  const next =
    text.slice(0, start + AUTO_START.length) +
    '\n' +
    (content || '> 暂无新提交。') +
    '\n' +
    text.slice(end)
  fs.writeFileSync(changelogPath, next)
}

/** 版本条目是否存在于 CHANGELOG */
function hasVersionEntry(version) {
  const text = readChangelog()
  return new RegExp(`^##\\s*\\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text)
}

/* ---------------- 主流程 ---------------- */
const pkg = readPkg()
const total = commitCount()

if (total === 0) {
  console.log(c.yellow('! 仓库还没有任何提交，先完成首次提交再运行本脚本'))
  console.log(c.gray('  git add -A && git commit -m "feat: 首个可用版本" && git tag v' + pkg.version))
  process.exit(flag('--check') ? 1 : 0)
}

const tag = latestTag()
const range = tag ? `${tag}..HEAD` : 'HEAD'
const commits = readCommits(range)
const body = render(commits, { includeMinor: flag('--all') })

/* --check：发版前体检 */
if (flag('--check')) {
  const problems = []
  if (!tag) problems.push('仓库还没有任何版本 tag')
  else if (tag !== `v${pkg.version}`) problems.push(`最新 tag 是 ${tag}，但 package.json 版本是 ${pkg.version}`)
  if (!hasVersionEntry(pkg.version)) problems.push(`CHANGELOG.md 缺少 [${pkg.version}] 版本条目`)

  const text = readChangelog()
  const start = text.indexOf(AUTO_START)
  const end = text.indexOf(AUTO_END)
  const autoText = start >= 0 && end > start ? text.slice(start, end) : ''

  // 只看「本该出现在 CHANGELOG 里」的提交，逐个核对短 hash 是否已归档
  const pending = commits.filter((x) => x.type === 'feat' || x.type === 'fix' || x.breaking)
  const missing = pending.filter((x) => !autoText.includes(x.short))
  if (missing.length) {
    problems.push(
      `有 ${missing.length} 条提交未归档进 CHANGELOG：${missing.map((x) => x.short).join(', ')}（运行 npm run changelog -- --write）`
    )
  }

  if (!problems.length) {
    console.log(c.green(`✓ 版本 ${pkg.version} / tag ${tag} / CHANGELOG 三者一致`))
    process.exit(0)
  }
  console.log(c.red('✗ 发现不一致：'))
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}

/* 预览 / 写入 */
const header = tag
  ? `> 统计区间：${tag}..HEAD（${commits.length} 条提交）`
  : `> 统计区间：仓库全部历史（${commits.length} 条提交，尚未打 tag）`

console.log(c.gray(header))
console.log(body || c.gray('（没有可归档的提交）'))

fs.writeFileSync(
  draftPath,
  `# CHANGELOG 草稿（自动生成，勿手改）\n\n${header}\n\n${body || '（没有可归档的提交）'}\n`
)

if (flag('--write')) {
  writeAutoBlock(body)
  fs.rmSync(draftPath, { force: true })
  console.log(c.green(`\n✓ 已写入 CHANGELOG.md${tag ? ` 的 ${tag}..HEAD 区间` : ' 的自动区间'}`))
} else {
  console.log(c.gray(`\n草稿：CHANGELOG.next.md；确认后运行 npm run changelog -- --write 写入正稿`))
}
