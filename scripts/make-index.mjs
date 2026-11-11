#!/usr/bin/env node
/**
 * Regenerate `docs/index.json` — a plugin market index (format 1) describing the
 * version currently checked out, so the file can be published as-is:
 *
 *   - submit the `plugins[0]` entry to an official index, or
 *   - serve this file and add its URL under Discover → index sources.
 *
 * Usage:  node scripts/make-index.mjs
 * Env:    COMMIT=<sha>            pin a commit other than HEAD
 *         PUBLISH_TIMESTAMP=<sec> override the publish time (Unix seconds)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const pkg = JSON.parse(read('package.json'))
const meta = {
  en: JSON.parse(read('locale/en.json')).meta,
  zh: JSON.parse(read('locale/zh.json')).meta,
}

const repositoryUrl = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
if (!repositoryUrl.startsWith('https://github.com/')) {
  throw new Error(`repository.url must be a GitHub https URL, got ${JSON.stringify(pkg.repository?.url)}`)
}

const commit = (process.env.COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString()).trim()
if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`not a full commit SHA: ${JSON.stringify(commit)}`)
const publishTimestamp = Number(process.env.PUBLISH_TIMESTAMP ?? Math.floor(Date.now() / 1000))

const index = {
  format: 1,
  title: { en: 'DeepSeek Harness — community index', zh: 'DeepSeek Harness — 社区插件索引' },
  description: {
    en: 'Self-published entries for plugins that follow the format-1 market index.',
    zh: '按市场价格索引格式 1 自发布的插件条目。',
  },
  metadata: {
    categories: { ui: { title: { en: 'Interface', zh: '界面' } } },
    labels: {
      web: { title: { en: 'Web UI', zh: '网页界面' } },
      sessions: { title: { en: 'Sessions', zh: '会话' } },
      notifications: { title: { en: 'Notifications', zh: '提醒' } },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: meta.en.title, zh: meta.zh.title },
      description: { en: meta.en.description, zh: meta.zh.description },
      icon: `data:image/svg+xml;base64,${readFileSync(join(root, 'icon.svg')).toString('base64')}`,
      author: pkg.author,
      homepage: pkg.homepage,
      repository: { url: repositoryUrl },
      metadata: {
        category: 'ui',
        keywords: pkg.keywords ?? [],
        labels: ['web', 'sessions', 'notifications'],
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'git', url: repositoryUrl, commit },
          engines: pkg.engines?.dsh === undefined ? {} : { dsh: pkg.engines.dsh },
        },
      ],
    },
  ],
}

mkdirSync(join(root, 'docs'), { recursive: true })
writeFileSync(join(root, 'docs/index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`docs/index.json → ${pkg.name}@${pkg.version} @ ${commit.slice(0, 7)}`)
