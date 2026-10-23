/**
 * Guard against the classic bundle mistake: renaming the package (e.g. to a
 * scope such as `@you/dsh-api-cost`) while the patch row still names the old
 * package. The result installs fine but the row cannot resolve, so the plugin
 * never activates.
 *
 * Runs on `npm publish` via `prepublishOnly`; exits non-zero on mismatch.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')

const name = String(pkg.name || '')
const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const row = new RegExp(`^\\s*name:\\s*['"]?${escaped}['"]?\\s*$`, 'm')

if (!name || !row.test(patch)) {
  console.error(
    `[dsh-api-cost] cordis.patch.yml must insert a row named "${name}" (the package name).\n` +
      'When you rename the package (for example to @you/dsh-api-cost), change the row name in cordis.patch.yml too.\n' +
      'Otherwise the bundle installs but never activates.',
  )
  process.exit(1)
}

console.log(`[dsh-api-cost] bundle row name matches package name: ${name}`)
