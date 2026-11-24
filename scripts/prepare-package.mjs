#!/usr/bin/env node
/**
 * 把仓库里的 package.json 改写成「可以发布到 GitHub Packages」的形态（仅 CI 使用，本地不会跑）。
 *
 * GitHub Packages 的 npm registry 要求：
 *   - 包名必须带 scope，且 scope 等于仓库 owner：@owner/focus-guard
 *   - 不能是 private: true
 *   - 需要 publishConfig.registry 指向 https://npm.pkg.github.com
 *
 * 同时把 scripts 精简到只依赖 vite（scripts/ 目录不会发布），
 * 让 `npm pack` 出来的 tarball 装下来还能自己 build。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')

const owner = (
  process.env.GITHUB_REPOSITORY_OWNER ||
  (process.env.GITHUB_REPOSITORY || '').split('/')[0] ||
  ''
).toLowerCase()

if (!owner) {
  console.error('✗ 拿不到仓库 owner（需要 GITHUB_REPOSITORY_OWNER 环境变量）')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const bare = String(pkg.name || 'focus-guard').split('/').pop()

pkg.name = `@${owner}/${bare}`
delete pkg.private
pkg.files = ['src', 'public', 'vite.config.js', 'README.md']
pkg.publishConfig = { registry: 'https://npm.pkg.github.com' }
pkg.repository = {
  type: 'git',
  url: `https://github.com/${process.env.GITHUB_REPOSITORY || `${owner}/${bare}`}.git`
}
pkg.scripts = {
  build: 'vite build',
  dev: 'vite build --watch'
}

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`· 待发布：${pkg.name}@${pkg.version}`)
console.log(`· 包含文件：${pkg.files.join(', ')}`)
