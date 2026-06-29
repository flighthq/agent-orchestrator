import { createHash } from 'node:crypto'
import { readdir, readFile, rename, rm } from 'node:fs/promises'

import { ConflictError, HandoffError, QuimbyError } from '@quimbyhq/errors'
import * as git from '@quimbyhq/git'
import {
  getStagingHandoffDir,
  getWorkerDir,
  getWorkerInboxParcelDir,
  getWorkerOutboxDir,
  getWorkerOutboxDraftDir,
  getWorkerOutboxSentDir,
  getWorkerOutboxSentDraftDir,
  getWorkerRepoDir,
  remoteWorkerDir,
  remoteWorkerRepoDir,
} from '@quimbyhq/paths'
import { getSSHTransport } from '@quimbyhq/transport'
import type { CommitMeta, HandoffMeta, SSHLocation, WorkerLocation } from '@quimbyhq/types'
import { isSSH } from '@quimbyhq/types'
import { cp, ensureDir, exists, readYaml, writeText, writeYaml } from '@quimbyhq/utils'
import { join } from 'pathe'

export type ApplyMode = 'squashed' | 'commits' | 'patch'

export async function applyHandoff(opts: {
  repoRoot: string
  name: string
  targetRepoPath: string
  mode: ApplyMode
  branch?: boolean | string
  threeWay?: boolean
}): Promise<void> {
  const { repoRoot, name, targetRepoPath, mode, branch, threeWay } = opts
  const dir = getStagingHandoffDir(repoRoot, name)
  const { meta } = await readHandoff(repoRoot, name)

  if (!(await git.isClean(targetRepoPath))) {
    throw new QuimbyError('Target repo has uncommitted changes. Commit or stash first.')
  }

  const previousRef = await git.getCurrentRef(targetRepoPath)
  let branchName: string | undefined

  if (branch !== undefined && branch !== false) {
    branchName = typeof branch === 'string' ? branch : `quimby/${meta.name}`
    if (await git.branchExists(targetRepoPath, branchName)) {
      await git.deleteBranch(targetRepoPath, branchName)
    }
    await git.createBranch(targetRepoPath, branchName)
  }

  try {
    switch (mode) {
      case 'squashed': {
        const diffPath = join(dir, 'squashed.diff')
        if (threeWay) {
          const conflicts = await git.applyThreeWay(targetRepoPath, diffPath)
          if (conflicts.length > 0) {
            throw new ConflictError(
              `Handoff "${name}" applied with ${conflicts.length} conflict(s) — resolve then commit`,
              conflicts,
            )
          }
        } else {
          await git.apply(targetRepoPath, diffPath, { check: true })
          await git.apply(targetRepoPath, diffPath)
        }
        await git.addAll(targetRepoPath)
        await git.commit(targetRepoPath, meta.suggestedMessage)
        break
      }
      case 'commits': {
        const commitsDir = join(dir, 'commits')
        const patches = await readdir(commitsDir)
        const sortedPatches = patches
          .filter((f) => f.endsWith('.patch'))
          .sort()
          .map((f) => join(commitsDir, f))
        try {
          await git.am(targetRepoPath, sortedPatches)
        } catch (amErr) {
          // git am --3way stops at the first conflicting patch and leaves the am
          // session in progress. Surface the conflicts so the user can resolve
          // them and `git am --continue`, rather than aborting their work.
          const conflicts = await git.getConflicts(targetRepoPath)
          if (conflicts.length > 0) {
            throw new ConflictError(
              `Handoff "${name}" stopped with ${conflicts.length} conflict(s) — resolve then "git am --continue"`,
              conflicts,
            )
          }
          throw amErr
        }
        break
      }
      case 'patch': {
        const diffPath = join(dir, 'squashed.diff')
        await git.apply(targetRepoPath, diffPath)
        break
      }
    }
  } catch (err) {
    if (err instanceof ConflictError) throw err
    try {
      await git.amAbort(targetRepoPath)
    } catch {}
    if (branchName) {
      await git.checkout(targetRepoPath, previousRef)
      try {
        await git.deleteBranch(targetRepoPath, branchName)
      } catch {}
    }
    throw new QuimbyError(
      `Failed to apply handoff "${name}" in ${mode} mode: ${err instanceof Error ? err.message : err}`,
    )
  }
}

/**
 * Assemble a parcel in the host staging area from a local code source's diff and/or a
 * note. Carries whichever halves exist — code-only, note-only, or both — and writes
 * `meta.yaml` last so a complete parcel is unambiguous. Throws when neither half exists.
 */
export async function assembleHandoff(opts: {
  repoRoot: string
  from: string
  codeSource?: string
  to?: string
  note?: string
  description?: string
  suggestedMessage?: string
  name?: string
}): Promise<HandoffMeta> {
  const { repoRoot, from } = opts
  const codeSource = opts.codeSource ?? from
  const repoDir = getWorkerRepoDir(repoRoot, codeSource)

  const subjects = (await git.log(repoDir, 'quimby/seed..HEAD', '%s')).split('\n').filter(Boolean)
  const hasCode = subjects.length > 0
  if (!hasCode && !opts.note) {
    throw new HandoffError(`Nothing to hand off from "${from}" — no commits since seed and no note`)
  }

  const head = hasCode ? await git.revParse(repoDir, 'HEAD') : hashNote(opts.note ?? '')
  const name = opts.name ?? parcelName(from, head)
  const dir = getStagingHandoffDir(repoRoot, name)
  await rm(dir, { recursive: true, force: true })
  await ensureDir(dir)

  let commits: CommitMeta[] = []
  if (hasCode) {
    const commitsDir = join(dir, 'commits')
    await ensureDir(commitsDir)
    const patchFiles = await git.formatPatch(repoDir, 'quimby/seed', commitsDir)
    await writeText(join(dir, 'squashed.diff'), await git.diff(repoDir, 'quimby/seed'))
    commits = parseCommits(
      await git.log(repoDir, 'quimby/seed..HEAD'),
      patchFiles.map((p) => p.split('/').pop() ?? ''),
    )
  }
  if (opts.note) await writeText(join(dir, 'README.md'), opts.note)

  const meta = buildMeta({ ...opts, codeSource, name, subjects, hasCode, commits })
  await writeYaml(join(dir, 'meta.yaml'), meta)
  return meta
}

/** SSH counterpart of {@link assembleHandoff}: the code source is a remote worker. */
export async function assembleRemoteHandoff(opts: {
  repoRoot: string
  from: string
  codeSource?: string
  codeSourceLocation: Readonly<SSHLocation>
  projectId: string
  to?: string
  note?: string
  description?: string
  suggestedMessage?: string
  name?: string
}): Promise<HandoffMeta> {
  const { repoRoot, from, codeSourceLocation, projectId } = opts
  const codeSource = opts.codeSource ?? from
  const transport = getSSHTransport(codeSourceLocation)
  const rRepoDir = remoteWorkerRepoDir(projectId, codeSource, codeSourceLocation.base)

  const subjects = (
    await transport.exec(`git log quimby/seed..HEAD --format=%s`, { cwd: rRepoDir })
  )
    .split('\n')
    .filter(Boolean)
  const hasCode = subjects.length > 0
  if (!hasCode && !opts.note) {
    throw new HandoffError(`Nothing to hand off from "${from}" — no commits since seed and no note`)
  }

  const head = hasCode
    ? (await transport.exec(`git rev-parse HEAD`, { cwd: rRepoDir })).trim()
    : hashNote(opts.note ?? '')
  const name = opts.name ?? parcelName(from, head)
  const dir = getStagingHandoffDir(repoRoot, name)
  await rm(dir, { recursive: true, force: true })
  await ensureDir(dir)

  let commits: CommitMeta[] = []
  if (hasCode) {
    const commitsDir = join(dir, 'commits')
    await ensureDir(commitsDir)
    const rTmpDir = `/tmp/quimby-handoff-${name}`
    await transport.exec(`mkdir -p ${rTmpDir}`, { cwd: rRepoDir })
    await transport.exec(`git format-patch quimby/seed -o ${rTmpDir}`, { cwd: rRepoDir })
    await transport.rsyncFrom(rTmpDir, commitsDir)
    await transport.exec(`rm -rf ${rTmpDir}`)
    await writeText(
      join(dir, 'squashed.diff'),
      await transport.exec(`git diff quimby/seed`, { cwd: rRepoDir }),
    )
    const fullLog = await transport.exec(`git log quimby/seed..HEAD --format='%H|%s|%an|%aI'`, {
      cwd: rRepoDir,
    })
    const patchFiles = (await readdir(commitsDir)).filter((f) => f.endsWith('.patch')).sort()
    commits = parseCommits(fullLog, patchFiles)
  }
  if (opts.note) await writeText(join(dir, 'README.md'), opts.note)

  const meta = buildMeta({ ...opts, codeSource, name, subjects, hasCode, commits })
  await writeYaml(join(dir, 'meta.yaml'), meta)
  return meta
}

/** Carry a staged parcel into a recipient worker's inbox (local copy or rsync). */
export async function deliverHandoff(opts: {
  repoRoot: string
  name: string
  to: string
  toLocation: Readonly<WorkerLocation> | undefined
  projectId: string
}): Promise<void> {
  const { repoRoot, name, to, toLocation, projectId } = opts

  const stagingDir = getStagingHandoffDir(repoRoot, name)
  if (!(await exists(stagingDir))) {
    throw new HandoffError(`Handoff "${name}" not found`, name)
  }

  if (isSSH(toLocation)) {
    const transport = getSSHTransport(toLocation)
    const rInboxDir = `${remoteWorkerDir(projectId, to, toLocation.base)}/inbox/${name}`
    await transport.ensureDir(rInboxDir)
    await transport.rsyncTo(stagingDir, rInboxDir)
    return
  }

  if (!(await exists(getWorkerDir(repoRoot, to)))) {
    throw new QuimbyError(`Worker "${to}" not found`)
  }
  const inboxDir = getWorkerInboxParcelDir(repoRoot, to, name)
  await ensureDir(inboxDir)
  await cp(stagingDir, inboxDir, { recursive: true })
}

/** Remove a staged parcel once it has been consumed (applied, delivered, exported). */
export async function discardHandoff(repoRoot: string, name: string): Promise<void> {
  await rm(getStagingHandoffDir(repoRoot, name), { recursive: true, force: true })
}

/** Move a delivered outbox draft into the `.sent/` ledger (the progress record). */
export async function markHandoffSent(
  repoRoot: string,
  from: string,
  recipient: string,
): Promise<void> {
  const draft = getWorkerOutboxDraftDir(repoRoot, from, recipient)
  if (!(await exists(draft))) return
  await ensureDir(getWorkerOutboxSentDir(repoRoot, from))
  const sent = getWorkerOutboxSentDraftDir(repoRoot, from, recipient)
  await rm(sent, { recursive: true, force: true })
  await rename(draft, sent)
}

export async function readHandoff(
  repoRoot: string,
  name: string,
): Promise<{ meta: HandoffMeta; squashedDiff: string; note: string }> {
  const dir = getStagingHandoffDir(repoRoot, name)
  const metaPath = join(dir, 'meta.yaml')
  if (!(await exists(metaPath))) {
    throw new HandoffError(`Handoff "${name}" not found`, name)
  }
  const meta = await readYaml<HandoffMeta>(metaPath)
  const squashedDiff = (await exists(join(dir, 'squashed.diff')))
    ? await readFile(join(dir, 'squashed.diff'), 'utf-8')
    : ''
  const note = (await exists(join(dir, 'README.md')))
    ? await readFile(join(dir, 'README.md'), 'utf-8')
    : ''
  return { meta, squashedDiff, note }
}

/** Read a recipient's queued outbox draft: its note and optional `attach:` code source. */
export async function readOutboxDraft(
  repoRoot: string,
  from: string,
  recipient: string,
): Promise<{ note: string; attach?: string }> {
  const readmePath = join(getWorkerOutboxDraftDir(repoRoot, from, recipient), 'README.md')
  if (!(await exists(readmePath))) return { note: '' }
  return parseDraft(await readFile(readmePath, 'utf-8'))
}

/** List recipients with a queued outbox draft (local workers; ignores the `.sent/` ledger). */
export async function readOutboxRecipients(repoRoot: string, from: string): Promise<string[]> {
  const outboxDir = getWorkerOutboxDir(repoRoot, from)
  if (!(await exists(outboxDir))) return []
  const entries = await readdir(outboxDir, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

// A parcel's name is its origin and contents: <from>-<short-hash>. The hash is the
// packed tip's sha when it carries code, else a hash of the note — content-derived,
// so it needs no counter, dedupes identical sends, and reads back as "from whom".
function parcelName(from: string, hash: string): string {
  return `${from}-${hash.slice(0, 8)}`
}

function hashNote(note: string): string {
  return createHash('sha256').update(note).digest('hex')
}

function parseCommits(fullLog: string, patchFiles: readonly string[]): CommitMeta[] {
  return fullLog
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      const [hash, message, author, date] = line.split('|')
      return { hash, message, author, date, patchFile: patchFiles[i] ?? '' }
    })
}

function parseDraft(content: string): { note: string; attach?: string } {
  if (!content.startsWith('---')) return { note: content }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { note: content }
  const frontmatter = content.slice(3, end)
  const note = content.slice(end + 4).replace(/^\r?\n/, '')
  const match = frontmatter.match(/^\s*attach:\s*(\S+)\s*$/m)
  return match ? { note, attach: match[1] } : { note }
}

function buildMeta(opts: {
  from: string
  codeSource: string
  to?: string
  note?: string
  name: string
  subjects: readonly string[]
  hasCode: boolean
  commits: CommitMeta[]
  description?: string
  suggestedMessage?: string
}): HandoffMeta {
  const { from, codeSource, subjects, hasCode, note } = opts
  const firstLine = (note ?? '').split('\n').find(Boolean) ?? `Note from ${from}`
  const description = opts.description ?? (hasCode ? subjects.join('; ') : firstLine)
  const suggestedMessage =
    opts.suggestedMessage ??
    (hasCode ? (subjects.length === 1 ? subjects[0] : subjects[subjects.length - 1]) : firstLine)
  return {
    name: opts.name,
    from,
    to: opts.to,
    codeSource: codeSource !== from ? codeSource : undefined,
    note,
    description,
    suggestedMessage,
    createdAt: new Date().toISOString(),
    commits: opts.commits,
  }
}
