// Claude Code PostToolUse hook: formats the one file an Edit or Write just changed with the project's prettier.
// It reads the hook payload from stdin and always exits 0, so formatting problems never fail the tool call.
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.md',
])
const SKIPPED_DIRS = new Set(['node_modules', '.output', 'drizzle'])
const SKIPPED_FILES = new Set(['src/routeTree.gen.ts'])

const projectDir = path.resolve(
  process.env.CLAUDE_PROJECT_DIR ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
)

try {
  await main()
} catch (error) {
  console.error(
    `[format-edited-file] Skipped formatting: ${error instanceof Error ? error.message : String(error)}`,
  )
}
process.exit(0)

async function main() {
  const input = await readStdin()
  if (!input.trim()) return
  const filePath = JSON.parse(input)?.tool_input?.file_path
  if (typeof filePath !== 'string' || !filePath) return

  const absolute = path.resolve(projectDir, filePath)
  const relative = path.relative(projectDir, absolute)
  // Only format files inside this project.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return
  }
  const posixRelative = relative.split(path.sep).join('/')
  if (!EXTENSIONS.has(path.extname(absolute).toLowerCase())) return
  if (SKIPPED_FILES.has(posixRelative)) return
  if (posixRelative.split('/').some((part) => SKIPPED_DIRS.has(part))) return

  // Use the project's own prettier so the version and config match `npm run` checks.
  const require = createRequire(path.join(projectDir, 'package.json'))
  const prettierModule = await import(
    pathToFileURL(require.resolve('prettier')).href
  )
  // require.resolve picks prettier's CommonJS entry, whose API sits on the default export.
  const prettier = prettierModule.default ?? prettierModule

  const info = await prettier.getFileInfo(absolute, {
    ignorePath: path.join(projectDir, '.prettierignore'),
  })
  if (info.ignored || !info.inferredParser) return

  const source = await readFile(absolute, 'utf8')
  // Formatting a half-resolved merge rewrites the conflict markers into ordinary text.
  if (/^(<{7}|={7}|>{7})( |$)/m.test(source)) return
  const options = (await prettier.resolveConfig(absolute)) ?? {}
  const formatted = await prettier.format(source, {
    ...options,
    filepath: absolute,
  })
  // Skip unchanged files so watchers (the dev server) are not triggered for nothing.
  if (formatted !== source) await writeFile(absolute, formatted, 'utf8')
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
