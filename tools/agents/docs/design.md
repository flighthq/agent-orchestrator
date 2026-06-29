# Quimby — Design

This is the authoritative design document.

## Overview

Quimby is a CLI tool for orchestrating multiple AI agents working on a single project. Each agent operates in an isolated **worker** — a local clone of the source repo inside a sandbox. Workers can't see each other; Quimby is the **courier** that hand-carries work between them, and across the boundary into the user's real repository.

Named after Chief Quimby from Inspector Gadget — the user dispatches the work, agents deliver, and Quimby hand-delivers the briefings in between. The unit it carries is a **handoff**: a parcel of work moved from one place to another and then done with. Quimby is a courier, not a post office — it carries parcels, it does not run a mailroom. There is no standing archive of past work; durable history lives in git.

This is infrastructure for multi-agent orchestration, not a thin wrapper around scripts. Networking, a local server, persistent state, and subscription management are all in scope.

## Core Concepts

**Worker** — An isolated agent environment. Each worker gets its own clone of the source repo, can commit locally, and produces handoffs. Workers run inside sandboxes (Docker Sandbox, OpenShell, etc.) that prevent them from seeing each other — all cross-worker communication is mediated by the host. Workers can run locally or on a remote machine over SSH.

**Handoff** — A _parcel_ Quimby hand-carries from one worker to another (or out to the user's repo). It is always a folder with one uniform shape, and it carries whichever of these it has:

- a **note** — `README.md`, the human-readable message
- a **diff** — the worker's code as `squashed.diff` plus `commits/` patches
- any other **files** the sender chose to include

A `meta.yaml` manifest (sender, recipient, `createdAt`, code source) is written **last**, which signals the parcel is complete. A handoff with code and no note, a note and no code, or both, are all the same kind of thing — "pack vs instruction" is not a type distinction, just different contents. A handoff is named `<from>-<contentHash>` (the packed tip's short sha when it carries code, otherwise a hash of its contents) — content-derived, so it needs no counter, dedupes identical sends, and reads back as "from whom, carrying what". The diff is also the wire format that lets work cross the membrane at all: a worker in a sandbox or over SSH is not a reachable git remote, so the host cannot `git fetch` it — Quimby carries the diff instead.

**Seed** — The `quimby/seed` git tag in each worker's repo marking the baseline. A handoff's diff is computed against this tag (`git diff quimby/seed`).

**Membrane** — The boundary between the workspace (where agents work) and the user's real repository. Work only crosses the membrane through explicit user action (`quimby apply`), landing in git — the durable side of the boundary.

**Server** — The host-side process that enables cross-worker visibility. Workers in sandboxes are isolated from each other — the server is the only entity that can see all workers. It polls for status changes and routes updates to subscribing workers.

**Transport** — The abstraction layer over local filesystem vs SSH. `LocalTransport` operates on local paths; `SSHTransport` wraps all operations via `ssh` and `rsync`. Commands and core modules interact with workers through this abstraction without knowing where the worker lives.

## Three Modes of Worker Interaction

These are distinct concepts that coexist, not alternatives:

### 1. Interactive Worker (`quimby run`)

Takes over a terminal. The user is in a live CLI session with the agent (like running `claude` directly). This is the onramp and never goes away — sometimes you want to pair with the agent. For SSH workers, this attaches to (or creates) a named tmux session on the remote host. Implemented.

### 2. Headless Worker (`quimby start`)

Launches an agent in the background. The user interacts via `quimby assign`, reads results via `quimby status` and `quimby diff`. The agent runs to completion or waits for new assignments. Not yet implemented — depends on sandbox ecosystem support for headless operation.

### 3. Server (`quimby serve`)

The host-side process that enables everything requiring cross-worker visibility:

- Polls worker `status.md` files for changes (local and SSH workers)
- Routes status updates to subscribing workers' `inbox/status/` directories
- Exposes an HTTP API on localhost for status aggregation and subscription management

The server doesn't replace `run` or `start` — it enables the connections between workers that sandbox isolation otherwise prevents. Implemented.

```
quimby serve                        # start the server
quimby add backend                  # create a worker
quimby run backend                  # interactive session (server optional)
quimby subscribe reviewer backend   # reviewer gets backend's status
quimby assign backend -m "..."      # works with or without server
```

## Directory Layout

### Local Layout

A worker has two staging areas for parcels: an **outbox** (parcels it wants Quimby to carry, addressed by recipient) and an **inbox** (parcels delivered to it, named by sender + contents). Quimby picks up from the outbox and hand-delivers to the inbox.

```
my-project/
  .quimby/
    state.yaml              # workspace state (workers, subscriptions, stable IDs)
    server.json             # server pidfile (when running)
    staging/                # host loading dock: a parcel mid-apply (kept only on conflict)
    workers/
      backend/
        repo/               # cloned source tree, tagged quimby/seed
        assignment.md       # current task (set by `quimby assign`)
        status.md           # agent-written status (mirrored to subscribers)
        CLAUDE.md           # generated agent instructions
        outbox/             # parcels staged for pickup, addressed by recipient
          reviewer/         # a parcel bound for the `reviewer` worker
            README.md       #   the note (optional; may carry `attach:` in frontmatter)
            ...             #   any extra files (optional)
          .sent/            # delivery receipts — parcels already carried (the progress ledger)
            reviewer/
        inbox/
          frontend-a1b2c3d4/   # a parcel delivered from `frontend`
            meta.yaml          #   manifest: from, to, createdAt, codeSource — written LAST
            README.md          #   the note (optional)
            squashed.diff      #   the diff (optional)
            commits/           #   the diff as patches (optional)
          status/              # live status mirrors from subscribed workers
            frontend.md
          .done/               # parcels this worker has processed
      frontend/
        ...
  src/
  package.json
  ...
```

Two naming schemes, deliberately, because the two staging areas answer different questions:

- The **outbox** is addressed by recipient (`outbox/<recipient>/`) — when authoring, the question is "who is this for".
- The **inbox** is named by origin + contents (`inbox/<from>-<hash>/`) — when receiving, the question is "what did I get, and from whom".

`status/` is **not** a parcel — it is a live mirror the server overwrites each poll, pulled by subscribers. Parcels are immutable, discrete deliveries; status is a continuously-updated reflection. They stay separate.

### Remote Layout (SSH Workers)

SSH workers use a stable project ID to namespace the remote layout. The project ID is a UUID stored in `state.yaml` and never changes.

```
~/.quimby/workspaces/<projectId>/       # remote project root (rsync target)
  src/                                  # project source files (rsynced from host)
  package.json
  .quimby/
    workers/
      backend/
        repo/               # cloned from the rsynced project root
        assignment.md
        status.md
        CLAUDE.md
        outbox/             # picked up and carried back to the host by Quimby
        inbox/              # parcels delivered here over transport
          status/
```

## SSH Workers

SSH workers allow an agent to run on a remote machine, with the source repo synced via rsync.

### Adding an SSH worker

```
quimby add researcher --host user@gpu-box
quimby add researcher --host user@gpu-box:/custom/base/path
quimby add researcher --host user@gpu-box --port 2222
```

The worker is recorded in `state.yaml` immediately. No SSH connection is made at `add` time — the remote environment is initialized lazily on first `quimby run`.

### Running an SSH worker

```
quimby run researcher
```

1. Rsyncs the local project to `~/.quimby/workspaces/<projectId>/` on the remote
2. If first run: clones the rsynced source, tags `quimby/seed`, writes scaffolding files
3. Attaches to (or creates) a tmux session named `qb-<projectId[:8]>-<workerId[:8]>`
4. The agent runs in the worker directory (parent of `repo/`) on the remote

The tmux session name is stable across renames because it is based on the worker's UUID, not its name.

### Explicit sync

```
quimby sync researcher    # rsync project to remote without launching the agent
```

Useful to pre-stage the project before a run, or to push local commits without starting a session.

### Updating SSH config

```
quimby set researcher --host user@new-box
quimby set researcher --port 2222
quimby set researcher --host user@box:/different/path
```

### Removing an unreachable SSH worker

```
quimby remove researcher --force
```

`--force` skips the remote `rm -rf` and removes only the local state entry. Use this when the SSH host is unreachable and you want to clean up state.

## CLI Surface

All commands follow `verb target [qualifiers]`. The first positional is the target — almost always a worker. Work moves along three axes, one verb each:

- **sideways**, peer → peer: `handoff`
- **out**, worker → your repo (across the membrane): `apply`
- **in**, you → a worker's task: `assign`

```
quimby add <worker> [-H <host>] [--port <n>] [-s <ref>]   Create a worker; flag-less runs the interactive walkthrough (flags skip it, staying scriptable)
quimby config <worker>                                Interactively (re)configure a worker (runtime, agent, local/remote, tmux, sync, check)
quimby run <worker> [-a <agent>] [-r <runtime>]      Launch agent interactively (default: claude; local tmux workers attach to a named session)
quimby sync <worker>                                  Rsync project to SSH worker host
quimby set <worker> [-r <rt>] [-a <agent>] [-H <host>] [--port <n>] [-c <cmd>] [-s <ref>]   Update worker config
quimby help [command]                                 Root help (grouped, with banner) or usage for a single command
quimby list                                           Show workers and subscriptions
quimby status [worker]                                Show agent-written status
quimby assign <worker> -m "..." | @file               Set a worker's current task (writes assignment.md)
quimby diff <worker> [worker2]                         Show a worker's live diff against its seed
quimby handoff <from> [<to>] [-m "..."] [--attach <w>] [--out <dir>]   Carry <from>'s parcel to <to>; no <to> enacts <from>'s whole outbox; --out exports to a directory
quimby apply <worker> [--commits|--patch] [--3way] [-b] [-t]   Apply the worker's work to your repo (the membrane)
quimby reset <worker> --force                         Nuclear reset worker to current HEAD
quimby rename <worker> <new-name>                     Rename worker
quimby remove <worker> [--force]                      Remove worker (--force: skip remote cleanup)
quimby serve [-p <port>] [--poll <secs>]              Start the server
quimby subscribe <worker> <target>                    Worker receives target's status
quimby unsubscribe <worker> <target>                  Remove subscription
```

### Planned (not yet implemented)

```
quimby start <worker>                       Launch agent headless
quimby assign <worker> --status <worker>    Embed another worker's status in assignment
```

### Flag conventions

All flags support `-x` short and `--xxx` long forms:

- `-m` / `--message` (assign, handoff, apply)
- `--attach` (handoff — carry a different worker's diff than `<from>`)
- `--out` (handoff — export the parcel to a directory instead of a worker)
- `-p` / `--port` (serve, add, set)
- `-a` / `--agent` (run, set)
- `-r` / `--runtime` (run, set)
- `-H` / `--host` (add, set)
- `-c` / `--check` (set)
- `-b` / `--branch` (apply)
- `-t` / `--target` (apply)
- `-s` / `--sync` (add, set)
- `-f` / `--force` (reset, remove)
- `--stat` (diff)
- `--commits`, `--patch`, `--3way` (apply)
- `--rebase`, `--skip-check` (handoff, apply)
- `--poll` (serve)

## No Config File (For Now)

Quimby works without a config file. `quimby add <name>` implicitly creates `.quimby/` and initializes the workspace. A `quimby.config.ts` with `defineWorkspace()` may be added in the future for declaring roles, routing rules, and runtime overrides — populated via `quimby up`.

### Configuration is per-worker

There are deliberately **no workspace-level defaults**. A worker's configuration (runtime, agent, location, tmux, sync ref, verification command) lives only on that worker's entry in `state.yaml` — a single source of truth, avoiding a second "defaults vs per-worker" config to reconcile.

`quimby config <worker>` is an interactive walkthrough (arrow-key selects via `@clack/prompts`) over exactly those fields — effectively an interactive `set`. A flag-less `quimby add <worker>` runs the same walkthrough to configure the new worker; passing config flags skips the prompts so `add` stays scriptable for unattended use. See build-and-tooling.md for the implementation.

## No Init Command

There is no `quimby init`. The first `quimby add` creates the workspace. The `.quimby/` directory is added to `.gitignore` automatically.

## Communication Model

Workers run in sandboxes and cannot see each other. All cross-worker communication is mediated by the host through two mechanisms:

### Manual (Quimby as courier)

`handoff` is the universal peer-to-peer channel — Quimby picks up a parcel from one worker and hand-delivers it to another's inbox. A parcel carries whichever halves exist: the sender's diff, a note, or both.

```
quimby handoff builder review -m "review this"   # builder's code (+ note) → review's inbox
quimby handoff review builder -m "fix the null case in Y"   # review's note → builder's inbox
```

The diff comes from `<from>` (or from `--attach <other>`); the note comes from `-m`, or from a queued outbox draft. A handoff **delivers to the inbox** — it never overwrites the recipient's `assignment.md`. Setting a worker's standing task is `assign`'s job; a handoff is a delivery to consider, not a new marching order.

When an agent has authored its own outbox (see Handoff Lifecycle), `quimby handoff <from>` with no recipient enacts the whole outbox — Quimby carries every queued parcel to its addressee in one run. This is how a reviewer routes work without the human relaying it: review fills its outbox with "fix Y" → builder and "promote this" (with `attach: builder`) → integration, and one `quimby handoff review` delivers the lot.

### Automatic (Server)

`quimby serve` polls worker directories and routes based on subscriptions:

```
quimby subscribe reviewer backend   # reviewer gets backend's status changes
```

When backend's `status.md` changes, the server pushes a snapshot to `reviewer/inbox/status/backend.md`. For SSH workers, the server writes to the remote inbox via transport. This happens continuously without user intervention.

Subscriptions are the "to whom it may concern" channel: a worker publishes status, and anyone who subscribed pulls it. The discernment is the subscription, set once — so broadcasts don't pile copies into every inbox or make every agent read-and-filter. Subscriptions are stored in `state.yaml` and can be added/removed whether or not the server is running. The server reloads state on each poll cycle.

## Server Architecture

The server (`quimby serve`) runs two components:

### HTTP API (localhost, default port 7749)

```
GET  /api/status                              Server health + overview
GET  /api/workers                             All workers with cached status
GET  /api/workers/:name                       Single worker detail
GET  /api/subscriptions                       All subscriptions
POST /api/subscriptions {subscriber, target}  Add subscription
DELETE /api/subscriptions/:subscriber/:target Remove subscription
```

### Status Poller (default 5s interval)

1. Check `state.yaml` mtime — reload if changed (picks up new workers/subscriptions)
2. For each worker, check `status.md` (local: mtime; SSH: content comparison)
3. If changed, read content, update cache, route to subscribers
4. Route = write to subscriber's `inbox/status/<target>.md` (local or remote)

The server writes `.quimby/server.json` (pid, port, startedAt) on startup and removes it on shutdown. CLI commands use this file to detect a running server and display its status.

## Handoff Lifecycle

A handoff is assembled on demand and carried; it is not deposited in any archive. The lifecycle is non-destructive — nothing an agent authored is lost to a failed delivery.

**Authoring (the agent).** Inside its sandbox a worker stages parcels in its outbox, addressed by recipient: `outbox/<recipient>/README.md` (the note) plus any files. Frontmatter `attach: <worker>` in the note tells Quimby to carry that worker's diff instead of the sender's own. A worker leaving instructions for what to carry is exactly this — the agent decides the routing, the host enacts it.

**Pickup and carry (`quimby handoff`).** Quimby:

1. Resolves the diff — `git diff quimby/seed` from `<from>` (or the `--attach`/`attach:` source); committing a dirty tree first, optionally `--rebase`-ing onto host HEAD, and running the worker's check (`--skip-check` opts out). The check runs every time, so a parcel always verifies before it is carried.
2. Validates the recipient against the worker roster. An unknown recipient (a typo'd address) is **reported and the outbox draft is left in place** — it bounces, it is never silently dropped, and becomes its own fix-it signal.
3. Assembles the parcel — note, diff, files — and writes `meta.yaml` **last**. Delivers it to `<to>/inbox/<from>-<hash>/` (local copy or rsync over transport).

**Receipt (on success only).** A delivered outbox draft is **moved** to `outbox/.sent/<recipient>/` (timestamped), not deleted. This is the progress ledger: active `outbox/*` = queued, `.sent/*` = carried and when. A failed carry leaves the draft active for a clean retry. The human-driven form (`handoff <from> <to> -m`, no outbox draft) assembles and carries a fresh parcel directly, with nothing to drain.

**Consumption (the recipient).** Parcels sit in `inbox/` until the worker processes them and moves them to `inbox/.done/`. Identity is content-derived, so a re-carried identical parcel overwrites in place rather than piling up.

**Garbage collection.** `.sent/` and `.done/` are caches, not the hot path — bounded by worker lifetime (everything dies with the worker) and pruned by an explicit step (a cleanup, or folded into `advance`/`reset`). GC is archiving-then-pruning, never silent deletion on carry.

**Out-of-band export.** `quimby handoff <from> --out <dir>` writes the assembled parcel to a directory instead of a worker inbox — the escape hatch for sharing work outside the workspace.

## Apply (crossing the membrane)

`quimby apply <worker>` is the one verb that moves work **out** to the user's real repository. It assembles the worker's diff in the host loading dock (`.quimby/staging/`), applies it to the target repo, and discards the staging copy on success.

- Squashed by default; `--commits` replays individual patches, `--patch` leaves working-tree changes uncommitted, `--3way` merges (leaving conflict markers) instead of aborting.
- `-b` lands it on a fresh branch; `-t` targets a repo path other than the cwd.
- On conflict the staged parcel is **kept** and its path reported, so the apply can be finished by hand.

Persisting a worker's work is git's job, reached through apply: `quimby apply <worker> -b feature/x` lands it on a branch you keep. There is no separate "save this work" store.

## Sync Targets (advance vs retarget)

A worker is a _synchronization relationship_, not a checkout. It records two things:

- **`seedCommit`** (mirrored by the `quimby/seed` tag) — the base the worker's work is measured from. A handoff's diff is `git diff quimby/seed`.
- **`syncRef`** — the ref the worker synchronizes against (e.g. `main`, `refs/heads/release`). Defaults to the host branch at `quimby add` time; an explicit `--sync` wins.

These map to two distinct, deliberately separated operations:

- **Refresh** (`quimby advance <worker>`) — resolve the worker's recorded `syncRef` to its tip _in the host repo_, rebase the worker's commits onto it, and retag `quimby/seed`. Because the target is the recorded ref and not the host's live `HEAD`, advancing is deterministic: checking the host repo out to a different branch does not silently change what a worker syncs against.
- **Retarget** (`quimby set <worker> --sync <ref>`) — change the worker's `syncRef`. This is the only way to move a worker onto a different branch. Keeping it explicit lets `advance` stay simple and predictable.

Workers created before sync targets existed are migrated on state load: a missing `syncRef` is backfilled from the workspace `sourceRef`.

The apply target is independent of `syncRef` — `quimby apply <worker> -t <branch>` lands the work wherever you choose, regardless of where its seed was derived from.

## Reset

`quimby reset <worker> --force` is nuclear — deletes the worker's repo and re-clones from the source at current HEAD. `--force` is required to prevent accidental data loss. Assignment and status are reset to empty/idle. (There is no archive to preserve; apply or export anything worth keeping before resetting.)

For SSH workers, reset: rsyncs the latest source to the remote, deletes and re-clones the remote repo, retags `quimby/seed`.

## diff Semantics

- `quimby diff <worker>` — live diff of the worker's commits against its seed (a preview of what a handoff or apply would carry)
- `quimby diff <a> <b>` — show two workers' diffs side-by-side
- `--stat` — diffstat summary only

Diff operates on workers only. Handoffs are carried, not stored, so there is nothing frozen to diff — preview the live worker instead.

## Key Design Decisions

- **Quimby is a courier, not a post office**: It hand-carries parcels between workers and across the membrane; it does not run a mailroom. There is no standing archive of past work — a handoff is assembled, carried, and dropped. This deletes a whole class of maintenance overhead: no sequence counter, no orphaned artifacts outliving removed workers, no unbounded store to curate. Durable history is git's job.
- **A handoff is one shape, carrying whichever halves exist**: Always a folder — note and/or diff and/or files, with a `meta.yaml` written last as the completion signal. "Pack vs instruction" is not a type distinction, just different contents, so there is one object and one set of verbs to learn.
- **Content-derived names, time in the manifest**: A parcel is `<from>-<contentHash>` — no counter, dedupes identical carries, self-describing. `createdAt` lives in `meta.yaml`, not the name, so identical re-sends stay idempotent instead of piling up; chronology comes from the manifest and the `.sent/` ledger.
- **Addressed outbox, content-named inbox**: The two staging areas answer different questions — "who is this for" when authoring, "what did I get and from whom" when receiving — so they name parcels differently on purpose.
- **Non-destructive delivery**: Carry drains a draft only on success, and to a `.sent/` receipt rather than a delete; a bad address bounces and stays put. An agent never has to rewrite a parcel because a delivery failed.
- **Three axes, three verbs**: `handoff` moves sideways (peer → peer), `apply` moves out (across the membrane), `assign` sets a worker's task. Handoffs land in the inbox and never clobber `assignment.md`.
- **Directed handoff vs broadcast**: Directed work uses `handoff` (addressed, validated); "to whom it may concern" uses `status` + `subscribe` (pull, set once). Broadcast is deliberately not a handoff mode — it would copy into every inbox and make every agent filter, the token cost we are avoiding.
- **The diff is the wire format across the membrane**: A sandboxed/SSH worker is not a reachable git remote, so the host cannot `git fetch` it. Carrying the diff is what makes cross-worker and worker→host movement possible at all.
- **Squashed apply by default**: Agent commit history is useful context but shouldn't leak into the real repo. The membrane ensures the user curates what enters.
- **Server is infrastructure, not convenience**: Workers in sandboxes can't see each other. The server is the only entity with cross-worker visibility. It's architecturally necessary, not a nice-to-have.
- **Three interaction modes coexist**: Interactive (run), headless (start), and server (serve) are separate concerns. run/start manage individual workers; serve manages the connections between them.
- **Stable IDs, not names**: `QuimbyState.id` and `WorkerState.id` are UUIDs generated at creation and never change. tmux session names are derived from IDs, so renaming a worker doesn't orphan a running session.
- **SSH lazy init**: SSH workers are not set up remotely at `quimby add` time. The remote clone, tagging, and scaffolding happen on first `quimby run`. This allows adding SSH workers without an active SSH connection.
- **rsync as transport**: SSH workers sync the project source via rsync before each run. The remote clone is a local clone of the rsynced source tree — no direct git remote needed on the agent side.
- **tmux for SSH persistence**: SSH workers run in named tmux sessions. Disconnecting from a session doesn't kill the agent. `quimby run` reattaches to an existing session if one exists. Local workers can opt into the same behavior via the `tmux` field on `WorkerState` — `quimby run` then wraps the local agent in `tmux new-session -A` against the stable-ID session name.
- **Transport abstraction**: All worker I/O goes through `LocalTransport` or `SSHTransport`. Commands don't need to know where a worker lives — they call `transport.exec`, `transport.writeFile`, `transport.rsyncTo`, etc.
- **reset requires --force**: Nuclear operations require explicit opt-in. `quimby reset` without `--force` warns and exits.
- **remove --force for unreachable hosts**: When an SSH host is gone, `quimby remove --force` removes the local state entry without attempting remote cleanup.
- **No artificial simplicity**: This is infrastructure for multi-agent orchestration. Networking, servers, persistent state, SSH transport, and subscription management are all in scope.
