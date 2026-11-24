#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 里提取指定版本的段落，生成 GitHub Release 的说明正文。
 *
 * 用法：
 *   node scripts/release-notes.mjs --tag v1.0.0
 *   node scripts/release-notes.mjs --tag v1.0.0 --out release-notes.md
 *
 * 取值优先级：
 *   1. CHANGELOG.md 里 ## [<version>] 开头的段落
 *   2. docs/release-<version>.md（分点版说明）
 *   3. 都没有则报错退出（避免发出一个空白 Release）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = path.join(root, 'CHANGELOG.md')

const argv = process.argv.slice(2)
const getArg = (name, fallback = '') => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const tag = getArg('--tag', process.env.TAG || '')
if (!tag) {
  console.error('✗ 缺少 --tag，例如 --tag v1.0.0')
  process.exit(1)
}

const version = tag.replace(/^v/, '')
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 从 CHANGELOG 里截取某个版本段落 */
function fromChangelog() {
  if (!fs.existsSync(changelogPath)) return ''
  const text = fs.readFileSync(changelogPath, 'utf8')
  const startRe = new RegExp(`^##\\s*\\[${escape(version)}\\][^\\n]*\\n`, 'm')
  const match = startRe.exec(text)
  if (!match) return ''

  const start = match.index + match[0].length
  const rest = text.slice(start)
  // 遇到下一个二级标题（下一个版本 / Unreleased / 版本规划）就截断
  const next = rest.search(/^##\s/m)
  const body = (next >= 0 ? rest.slice(0, next) : rest).trim()
  return body.replace(/^-{3,}\s*$/gm, '').trim()
}

/** 兜底：分点版说明 */
function fromReleaseFile() {
  const file = path.join(root, 'docs', `release-${version}.md`)
  if (!fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf8')
  // 去掉自带的一级标题，Release 页已经有标题了
  return text.replace(/^#\s+.*\n+/, '').trim()
}

const body = fromChangelog() || fromReleaseFile()
if (!body) {
  console.error(`✗ CHANGELOG.md 与 docs/release-${version}.md 里都找不到 ${version} 的内容`)
  process.exit(1)
}

const assets = [
  `## 下载`,
  ``,
  `- \`focus-guard-${version}-chrome.zip\` — 插件包，解压后到 \`chrome://extensions\` 用「加载已解压的扩展程序」选中该目录`,
  `- \`focus-guard-${version}-code.zip\` — 纯源码包，解压后 \`npm ci && npm run build\``,
  ``
].join('\n')

const notes = `${body}\n\n---\n\n${assets}`
const out = getArg('--out', '')

if (out) {
  fs.writeFileSync(out, notes)
  console.log(`generated ${out}（${version}，${notes.length} 字符）`)
} else {
  process.stdout.write(notes)
}
