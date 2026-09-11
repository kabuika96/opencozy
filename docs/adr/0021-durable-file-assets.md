# ADR 0021: Durable File Assets Shared by the Harness

## Status

Accepted

## Decision

A File Asset is an explicit outgoing deliverable, separate from an incoming Message Attachment. `files.publish` copies a regular local file into a Device-owned library and persists an `asset.shared` Timeline Event containing public metadata. `files.show` presents the same asset in another chat. Closing or deleting the source Thread does not remove the snapshot or search index. Uploads are not automatically promoted into this library; the Harness can publish an uploaded file when asked to share or keep it there.

Store immutable snapshots under `backend/data/assets/files`, with metadata and an FTS5 index in a separate `assets.sqlite` beside the primary database. Scope all metadata, search, and tool operations to the Thread's Device owner. This follows the existing Device trust boundary; it is not a new account or authentication system. Copy from an opened regular-file descriptor, bound writes to 250 MiB, and hash the copied bytes. File retention is indefinite initially; deletion, quotas, deduplication, and automatic cleanup are deferred. Backups must include both the asset database and file directories.

Search uses names, titles, descriptions, and extracted content. Text, code, and HTML index at most 500,000 characters from the first 4 MiB. PDF extraction runs `pdftotext` in a separate process with a 15-second deadline, covering up to 200 pages and 500,000 characters. Extraction failure does not prevent publication: results report metadata-only or partial search. Images, audio, video, and scanned PDFs have no OCR or transcription in this version. Keyword search is not semantic search; the Harness chooses concise keywords and can refine or paginate them.

New Codex Threads receive `files.publish`, `files.search`, `files.show`, and `files.read` as native dynamic tools. The backend adapter handles their protocol. Existing Codex histories cannot acquire new dynamic tool definitions with the pinned runtime, so stable developer instructions also describe `scripts/file-assets.mjs`. That helper reads a private per-Thread context file and calls the same backend operations through a loopback-only endpoint with an opaque, active-Run capability. The capability expires when the Run finishes, and its rotating token never enters the model's stable request prefix. No history reset is required. Native calls are restricted to the active main turn.

File cards are standalone Timeline Entries. Tapping opens a native dialog with plain text/code, isolated static HTML, PDF.js page rendering, images, or native video/audio controls. Browser codec support determines playable media formats. Text previews are bounded to 4 MiB; every format remains downloadable. The lazy PDF worker avoids loading the PDF engine for ordinary chats.

The Device-authorized access endpoint creates an in-memory 12-hour grant for one asset. Content requests use that grant because native media elements cannot supply the Device header. Grant URLs are private capabilities, expire on backend replacement, are not persisted in chat history, and are refreshed when opening a preview. Responses support byte ranges for seeking and PDF loading and disable caching and referrer leakage. HTML is served as inert text and displayed in a unique-origin iframe with scripts, forms, navigation, and remote resource loading disabled. HTML scripts are never executed in the app origin.

## Verification

Backend tests cover immutable copies, index persistence after reopening, retrieval after Thread closure/deletion, Device ownership, expired Run capabilities, CLI fallback, byte ranges, and file classification. Adapter tests cover dynamic-tool dispatch and historical Thread instructions. Frontend tests cover card projection and HTML isolation. The browser scenario exercises publication, each supported preview category, downloads, reading-position restoration, reload, and retrieval from a later chat using an isolated backend.

`npm run test:file-tools` runs the pinned Codex process against an isolated Responses stub and checks all four native file tools on a new Thread and cold resume. `npm run test:prompt-cache -- --attachments` includes stable file-tool instructions and verifies the request prefix survives warm follow-up and cold recovery. Neither probe calls a live model or restarts Opencozy.

The required workspace check passed (141 backend and 116 frontend tests plus both builds), as did the targeted asset/adapter/reliability suite (71 tests). All 12 affected Chromium mobile scenarios passed, including real HTTP downloads, six preview categories, blocked remote HTML resources, PDF content search, and cross-chat retrieval. The installed WebKit engine previously crashed at launch with a bus error; real iOS validation remains outstanding.

## Browser compatibility correction

The PDF viewer and worker both use PDF.js's `legacy` distribution, which supplies missing JavaScript built-ins. The modern build failed on the owner's browser with `Map.prototype.getOrInsertComputed` undefined. The asset browser regression removes the newer Map/WeakMap methods in both page and worker before PDF.js loads, then checks actual painted PDF content, page navigation, and OpenWrite record previews. Vite prebundles the lazy compatibility module to avoid a first-open dependency optimization reload.

## Mobile viewing

PDFs and images share a touch surface with bounded 1–4× pinch/double-tap zoom, drag panning, explicit zoom/fit controls, and keyboard/wheel support. PDF horizontal swipes change pages only at fit width; pinch/pan sequences and canceled gestures cannot turn pages. Viewport changes refit content. The PDF uses compositor transforms during gestures, then renders a sharper replacement into a temporary canvas before swapping visible pixels; the bitmap is bounded to eight million pixels.

Swipe down on the title area to dismiss any viewer. Document gestures never cover native audio/video controls or text selection. Text has readable default sizing and adjustable font size; sandboxed HTML has explicit zoom controls with native inner scrolling. Record provenance is collapsed behind a touch-sized disclosure, while its status remains visible. Chromium browser tests send real multi-touch input and cover zoom, panning, page swipes, cancellation, a 320-pixel viewport, header dismissal, and text/HTML controls. Actual iOS gesture validation remains a device check.

## File stacks and native sharing

The Timeline projects multiple distinct File Assets in one response into a compact stack at the first card's position, retaining interleaved assistant commentary. Groups stay within a Run and agent branch and split at user messages, including steering. Repeated shows of the same asset collapse only within that response; later responses still show their own card. Stored Events are unchanged, so existing Threads gain stacks on reload. A stack opens a full-screen, scrollable list with individual previews. Closing a preview or share dialog restores the underlying list and focus without scrolling the chat. The stack adds eight pixels of layering to a 104-pixel card.

Individual cards, viewers, stack cards, and list headers expose the same share action. The user first opens a preparation sheet, which retrieves the complete original bytes through fresh Device-authorized grants and creates browser Files preserving names and media types. Its enabled Share button calls `navigator.share({files})` directly during a new user gesture. This follows [WebKit's user activation guidance](https://webkit.org/blog/13862/the-user-activation-api/) and [the Web Share specification](https://www.w3.org/TR/web-share/): downloading inside the final tap can expire transient activation. No grant URL is passed to another app. OpenWrite sharing sends the selected immutable original snapshot, not an editable record or an updated status claim.

Preparation is explicit and sequential, supports cancellation, rejects incomplete downloads, and never offers a partial batch after a failure. The selection is fixed when sharing starts, even if more assets stream into the response. A 250 MiB aggregate limit bounds retained file data on mobile; larger stacks can be shared individually or downloaded. Files are released when the sharing sheet closes. `navigator.canShare({files})` checks the actual batch; unsupported browsers or file combinations explain how to download or share individually. Native cancellation is silent and other native failures allow retry. The browser and receiving app determine available sharing targets and accepted file types.

Presenter regressions cover streaming stability, commentary, deduplication, steering, Runs, and agent branches. The mobile browser test substitutes only the native OS share boundary and verifies six real stored originals by checksum, filename, media type, and size, plus fresh user activation, individual and batch sharing, cancellation, unsupported combinations, failure/retry, reload reconstruction, and nested viewers. Native iOS share-sheet rendering and third-party app handoff still require a physical-device check.

The sharing update passed `npm run check` (146 backend tests, 120 frontend tests, both typechecks and builds) and all 12 affected mobile Chromium scenarios. A focused regression keeps an individual sharing sheet open as streaming converts its card into a stack. Another regression ensures an open native dialog owns Escape even after an asynchronous focus change, so dismissal cannot reach the Run cancellation shortcut. The WebKit test was retried and still failed before loading the app with a launcher bus error; no native iOS handoff success is claimed.
