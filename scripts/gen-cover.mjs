// 生成项目配图：把 docs/*.svg 光栅化成 PNG
//   docs/cover.svg   -> docs/cover.png（1280×800，介绍型封面）
//   docs/poster.svg  -> docs/poster.png（1200×630，宣传海报 / 社交头图）
// 另外用 macOS 自带的 sips 导出一张 440×280 的商店小宣传图。
// 依赖本机 Chrome 做 SVG 光栅化（仅出图时需要，构建不需要）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = path.join(root, 'docs')

const TARGETS = [
  { svg: 'cover.svg', png: 'cover.png', width: 1280, height: 800, promo: 'promo-440x280.png' },
  { svg: 'poster.svg', png: 'poster.png', width: 1200, height: 630 }
]

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

function findChrome() {
  for (const bin of CHROME_CANDIDATES) {
    if (fs.existsSync(bin)) return bin
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    const res = spawnSync('which', [name], { encoding: 'utf8' })
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim()
  }
  return ''
}

const chrome = findChrome()
if (!chrome) fail('找不到 Chrome / Chromium，无法把 SVG 渲染成 PNG。可手动打开 docs/*.svg 截图。')

/** 把 SVG 内联进尺寸精确的 HTML，避免 file:// 打开 SVG 时的默认边距 */
function render(svgFile, pngFile, width, height) {
  const svgPath = path.join(docsDir, svgFile)
  if (!fs.existsSync(svgPath)) {
    console.warn(`! 跳过 ${svgFile}（文件不存在）`)
    return false
  }

  const svg = fs.readFileSync(svgPath, 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#fff}
    svg{display:block}
  </style></head><body>${svg}</body></html>`

  const tmpHtml = path.join(os.tmpdir(), `fg-cover-${process.pid}-${pngFile}.html`)
  fs.writeFileSync(tmpHtml, html)

  const outPath = path.join(docsDir, pngFile)
  spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      `--screenshot=${outPath}`,
      '--virtual-time-budget=1500',
      `file://${tmpHtml}`
    ],
    { stdio: 'ignore' }
  )
  fs.rmSync(tmpHtml, { force: true })

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 5000) {
    fail(`${pngFile} 渲染失败，请确认 Chrome 可以正常启动（无头模式）`)
  }
  return true
}

const kb = (p) => `${(fs.statSync(p).size / 1024).toFixed(0)} KB`
const hasSips = spawnSync('which', ['sips'], { encoding: 'utf8' }).status === 0
const lines = []

for (const target of TARGETS) {
  console.log(`· 渲染 ${target.svg} → ${target.png}`)
  if (!render(target.svg, target.png, target.width, target.height)) continue

  const outPath = path.join(docsDir, target.png)
  lines.push(`  docs/${target.png}   ${target.width}×${target.height}   ${kb(outPath)}`)

  if (target.promo) {
    const promoPath = path.join(docsDir, target.promo)
    if (hasSips) {
      const r = spawnSync('sips', ['-z', '280', '440', outPath, '--out', promoPath], { stdio: 'ignore' })
      if (r.status === 0) lines.push(`  docs/${target.promo}   440×280    ${kb(promoPath)}`)
      else console.warn('! 小宣传图生成失败，可忽略')
    } else {
      console.log('· 未找到 sips，跳过 440×280 小图')
    }
  }
}

console.log('\n✓ 配图已生成')
console.log(lines.join('\n'))
