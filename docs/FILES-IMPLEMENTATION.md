# Files implementation record

## Preserved request

Kanban task: Build frontend file and folder management for approved workspaces
Goal: Manage workspace files and folders directly in the Jarvis 2.0 frontend on desktop and phone.
Scope: Add a Files page with folder navigation, breadcrumbs, search and sorting. Support file/folder creation, renaming, moving, copying, uploads, downloads and bounded text preview/editing. Confirm overwrites and destructive operations; delete to recoverable trash.
Security: Restrict access to explicitly approved roots; block protected credentials, traversal, unsafe symlinks and special files. Keep authentication, private storage and sanitized errors. Do not execute file contents or expose secrets.
Acceptance: Verify CRUD, uploads/downloads, empty/error states, permission denial, traversal and symlink protection, stale edits and responsive keyboard/touch behavior using isolated fixtures. Build and inspect the frontend.
Completion notes: Preserve this description and append changes, actual test results, blockers and remaining limitations after implementation.
Planning result: Frontend file/folder management is the highest-priority requested feature. The earlier explorer attempt was blocked by edit approval; its Done label is not evidence of implementation. Inspect source before starting. This card is a specification, not implemented functionality.

Source planning task: e593202e-da26-4b40-b66d-5be0a666c3c4. Keep this card as a proposal until implementation is explicitly started. Do not manage your own running task lifecycle.

## Implementation — 2026-11-20

Implementation was explicitly started by this request. The checkout already
contained unfinished Files source and unrelated Kanban/report edits. Those edits
were preserved. No running task lifecycle was changed.

Completed the Files page, sidebar/portal routing, authenticated API and workspace
storage. Includes current-folder filtering and sorting, breadcrumbs, file/folder
creation, rename/move/copy, binary upload/download, bounded UTF-8 editor, explicit
overwrite/delete confirmation, version conflicts and recoverable Trash/restore.
Added root identity checks, atomic no-clobber file creation, stale destination
checks and unsaved editor guards for page navigation and browser unload.

Access requires explicit approval of configured workDir. Private approval state,
root IDs, descriptor-pinned directories, no-follow opens, protected name/content
checks and sanitized failures preserve the bridge boundary. Files are plain text
or attachment bytes; their contents are never executed or injected as HTML.

### Actual verification

- `npm run build:frontend` — passed; generated JS/CSS and asset hashes updated.
- `JARVIS_FILES_BROWSER=1 node tests/files.mjs` — passed storage, real HTTP bridge
  and Chromium browser checks against disposable fixtures. Includes CRUD,
  recursive copy/move, recoverable overwrite/delete, restore, stale edit rejection,
  binary and empty transfers, limits, protected paths/content, traversal, symlinks,
  hardlinks, FIFO, permission denial, private approval persistence and auth rejection
  for all three endpoints. HTTP uploads/downloads and response headers verified.
- Browser: real frontend at 1280, 390 and 320px; no horizontal overflow, 44px button
  targets, Tab/Escape, actual touch folder navigation, breadcrumbs, filtering,
  empty/error states, creation form, preview, unsaved navigation cancellation and
  stale-save draft retention passed. Desktop and mobile screenshots inspected.
- `node tests/theme-browser.mjs` — passed desktop/mobile layout, shared Kanban,
  onboarding, camera, theme and sudo dialog regressions at all three widths.
- Server syntax checks and `git diff --check` — passed.
- Screenshots contain only synthetic fixture data and are written under `/tmp`.

### Blockers and limitations

No implementation blocker remains. No deployment or live bridge restart performed.
Additional existing project folders can now be explicitly reviewed and approved.
Cross-root transfers, recursive search, batch operations, directory
uploads and binary editing are outside this version. Folder overwrite is refused.
Trash restore requires a free original destination and existing parent directory;
there is no purge UI or automatic expiry. Overwrites and deletes consume disk space.

This implementation targets Linux and uses `/proc/self/fd`. Filesystem operations
are bounded and synchronous. Approval is not a sandbox for hostile local processes:
concurrent changes by other processes can still interrupt multi-file operations;
there is no transactional filesystem snapshot or adversarial rename-race guarantee.
Known credential paths and recognizable credential strings are blocked, but arbitrary
secrets embedded in otherwise ordinary files cannot be identified reliably. Approve
only dedicated project roots whose ordinary content is appropriate to expose to
authenticated clients. Version checks preserve stale drafts; conflicts require refresh
and review. Automated phone verification uses Chromium emulation, not physical iOS
or Android devices.


### Approval visibility fix

Canonicalize configured ancestor aliases before approval (the dev runtime uses
one), while refusing a workspace root that is itself a symlink. Show the canonical
workspace path beside the approval button. Unavailable or unsuitable workspaces
now show a sanitized explanation instead of silently hiding approval. Added alias
and unavailable-workspace regression fixtures.


### Pasted workspace approvals

Added an always-visible workspace path field with separate Review and Approve
steps. The server canonicalizes and validates the folder, then checks its reviewed
identity again before saving approval. New roots are selected after approval; root
choices show full paths. Protected/system locations, traversal, root symlinks and
unavailable folders are refused. Existing approved roots remain available.


### Copy file and folder paths

Added Copy path to each file/folder and Copy folder path for the current directory.
Copies the absolute host path from the approved root. Clipboard failures open a
selectable path dialog for manual copying on desktop and phone. Isolated browser
checks verify file/folder/current-directory values and denied-clipboard fallback.
