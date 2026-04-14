# (My)Portfolio Schema Reference
> Cheat sheet for AI sessions and future-Mike. Describes every database, property, naming convention, and gotcha in the Notion (My)Portfolio template.
>
> Last updated: 2026-04-13

---

## Three Databases

| Database | Collection URL | Title Property | Status Property |
|---|---|---|---|
| **(My)Projects, Areas, & Milestones** | `collection://671b4eed-30a2-8385-b5aa-8738f19e8f20` | `Name` | `status` (lowercase!) |
| **(My)Tasks** | `collection://de9b4eed-30a2-82f8-bca9-07f90ac36f91` | `Task Name` | `Completed` (capitalized!) |
| **(My)Notes** | `collection://2fab4eed-30a2-82e8-aad8-0770b7083562` | `Resource Name` | *(none — uses `Archived` checkbox)* |

---

## DB 1: (My)Projects, Areas, & Milestones

### Status Values (`status` — LOWERCASE)
| Value | Group | Use For |
|---|---|---|
| `Planning` | to_do | Not started yet |
| `In Progress` | in_progress | Active work |
| `Review` | in_progress | Needs review/approval |
| `On Hold` | in_progress | Paused intentionally |
| `Complete` | complete | Done |
| `Archived` | complete | Done and mothballed |
| `Abandoned` | complete | Stopped permanently |

### Type Values (multi-select)
| Value | Use For |
|---|---|
| `🚀 Projects` | Active/planned projects (P- prefix) |
| `💼 Areas` | Ongoing responsibility areas (A- prefix) |
| `🪣 Resources` | Reference material collections (R- prefix) |
| `🗃️ Archive` | Completed/superseded items (X- prefix) |
| `Milestone` | Sub-deliverables of projects |

### All Properties
| Property | Type | Notes |
|---|---|---|
| `Name` | title | The page title |
| `status` | status | **LOWERCASE** — see values above |
| `Type` | multi_select | See values above |
| `Description` | text | Short summary |
| `Success Criteria` | text | What "done" looks like |
| `Dates` | date | Completion date or start date |
| `Target Completion` | date | Expected finish date |
| `Parent item` | relation (self, limit 1) | Single parent — set with page URL string |
| `Sub-PARA` | relation (self, array) | Children — set with JSON array of URLs |
| `Blocking` | relation (self, array) | Items this blocks |
| `Blocked by` | relation (self, array) | Items blocking this |
| `Related Tasks` | relation → Tasks DB | Linked tasks |
| `Related Notes` | relation → Notes DB | Linked notes |
| `Tech Stack` | multi_select | See available tags below |
| `Block Type` | multi_select | Used for vault objects and notes |
| `Block Type 1` | multi_select | Duplicate — same options as Block Type |
| `Services` | relation → external | Service registry link |
| `API Routes` | relation → external | API registry link |
| `Created` | created_time | Auto-set |
| `Last edited time` | last_edited_time | Auto-set |

### Tech Stack Options (multi-select)
`Anthropic API`, `OpenAI`, `Google Calendar`, `Gmail API`, `Google Drive`, `Microsoft Graph`, `iCloud`, `Discord`, `Buffer`, `Pi-hole`, `Router SOAP`, `Playwright`, `Notion API`, `LinkedIn`, `Pexels`, `Apify`, `YouTube`, `Seedbox`, `SQLite`, `TMDB`, `Make.com`, `QuickChart`, `catbox.moe`, `X/Twitter`

### Block Type Options (multi-select)
`📝 Note`, `📆 Daily DTT`, `💭 Reflection`, `📑 Research`, `🔗 MOC`, `🙌 Shout Out`, `💬 Quote`, `⚠️ Issue`, `⚛ Object`, `Weekly Plan`, `Quarter Milestones`, `Annual Plan`

---

## DB 2: (My)Tasks

### Status Values (`Completed` — CAPITALIZED)
| Value | Group |
|---|---|
| `Not started` | to_do |
| `In progress` | in_progress |
| `Done` | complete |
| `Abandoned` | complete |

### All Properties
| Property | Type | Notes |
|---|---|---|
| `Task Name` | title | Verb + Action + Object naming |
| `Completed` | status | **CAPITALIZED** — see values above |
| `Description` | text | What and why |
| `Due Date` | date | Target completion |
| `Related Projects` | relation → Projects DB | Parent project link |
| `Related Notes` | relation → Notes DB | Linked notes (capitalized N) |
| `Related notes` | relation → Notes DB | Linked notes (lowercase n) — **DUPLICATE!** |
| `Parent task` | relation (self, limit 1) | For sub-task hierarchy |
| `Sub-task` | relation (self, array) | Child tasks |
| `Blocking` | relation (self, array) | Tasks this blocks |
| `Blocked by` | relation (self, array) | Tasks blocking this |
| `Assignee` | person | Who's responsible |
| `(My)Tasks` | relation → Tasks DB | Cross-link from Notes |
| `Created` | created_time | Auto-set |
| `Last edited time` | last_edited_time | Auto-set |

---

## DB 3: (My)Notes

### All Properties
| Property | Type | Notes |
|---|---|---|
| `Resource Name` | title | Descriptive name |
| `Block Type` | multi_select | Same options as Projects DB Block Type |
| `File/Link` | url | Filesystem path or URL to source |
| `Archived` | checkbox | `__YES__` / `__NO__` (not true/false) |
| `Related Projects` | relation → Projects DB | Parent project/resource |
| `Related Tasks` | relation → Tasks DB | Linked tasks |
| `(My)Tasks` | relation → Tasks DB | Cross-link (separate from Related Tasks) |
| `Parent item` | relation (self, limit 1) | For sub-note hierarchy |
| `Sub-item` | relation (self, array) | Child notes |
| `Created time` | created_time | Auto-set |
| `Last edited time` | last_edited_time | Auto-set |

---

## Naming Conventions

### Prefix Rules
| Type | Pattern | Example |
|---|---|---|
| Area | `A-CODE: Human Name` | `A-AI: AI & Automation` |
| Project | `P-CODE: Human Name` | `P-BMOUI: BMO UI (Mission Control)` |
| Resource | `R-CODE: Human Name` | `R-VAULT: System Stack Registry` |
| Archived Project | `XP-CODE: Human Name` | `XP-GHPROFILE: GitHub Profile Build` |
| Archived Resource | `XR-CODE: Human Name` | `XR-LMSTUDIO: LM Studio Setup & Guides` |
| Milestone | Plain descriptive name | `Resume A: Implementation-First` |
| Task | Verb + Action + Object | `Match dashboard layout to reference screenshots` |
| Note (Research) | Source document name | `PARA Actionability Framework` |
| Note (Object) | Tool/service + version | `Anthropic API`, `node v25.8.1` |

### Code Rules
- ALL CAPS, no spaces: `BMOUI`, `RESUME26`, `AUTOAPPLY`
- Short (2-10 chars), mnemonic
- Unique across the entire portfolio

---

## Date Property Syntax (Expanded Format)

Notion date properties use expanded keys when setting via API:

```
"date:Dates:start": "2026-04-13"          -- ISO date
"date:Dates:end": null                     -- null for single date
"date:Dates:is_datetime": 0               -- 0=date, 1=datetime

"date:Target Completion:start": "2026-06-30"
"date:Due Date:start": "2026-04-30"
```

**Never** use just `"Dates"` or `"Due Date"` as the property key — it won't work.

---

## Relation Syntax

### Single relation (limit 1) — Parent item
```json
"Parent item": "https://www.notion.so/PAGE_ID"
```
Pass a **string** (single URL), not an array.

### Array relation — Sub-PARA, Related Projects, etc.
```json
"Sub-PARA": "[\"https://www.notion.so/ID1\", \"https://www.notion.so/ID2\"]"
"Related Projects": "[\"https://www.notion.so/PROJECT_ID\"]"
```
Pass a **JSON-encoded array string** of page URLs.

---

## Content Writing Rules

### replace_content
- **WILL FAIL** if child pages exist — must include `<page url="https://www.notion.so/CHILD_ID"></page>` in `new_str`
- Always **fetch the page first** to check for child pages before writing
- Don't include the page title in body content (it's in properties)

### Checkbox values
- Use `"__YES__"` and `"__NO__"`, not `true`/`false`

### Multi-select values
- Pass as JSON array string: `"[\"🚀 Projects\"]"` or `"[\"Anthropic API\", \"OpenAI\"]"`

---

## Hierarchy Model

```
💼 Area (top level)
  └── 🚀 Project (Parent item → Area)
        └── Milestone (Parent item → Project)
              └── Task (Related Projects → Project)

🪣 Resource (top level)
  └── 🪣 Sub-Resource (Parent item → Resource, via Sub-PARA)
        └── ⚛ Object Note (Related Projects → Sub-Resource)

🗃️ Archive (top level, no children)
```

### Relation Wiring Checklist
- [ ] Every Project has `Parent item` → its Area
- [ ] Every Milestone has `Parent item` → its Project
- [ ] Every Task has `Related Projects` → its Project
- [ ] Every Note has `Related Projects` → its Project or Resource
- [ ] Every Resource sub-group has `Parent item` → its parent Resource
- [ ] `Sub-PARA` on parent is the inverse of `Parent item` on children
- [ ] `Blocking`/`Blocked by` are mutual inverses

---

## Current Inventory (as of 2026-04-13)

| Type | Count |
|---|---|
| Areas | 7 |
| Projects | 34 |
| Milestones | 22 |
| Resources | 12 + 7 vault sub-resources |
| Archives | 8 |
| Tasks | 20 |
| Research Notes | 17 |
| Vault Object Notes | 60 (was 63, 3 CLI dupes merged into Runtime entries) |
| **Total** | **~187 active entries** |

Note: 3 placeholder entries ([TRASH] New Project, New Area, New Resource) are flagged as Abandoned — delete manually in Notion UI.

---

## Completed Work Log

### Phase 1 — Skeleton Population ✅
193 entries created across 3 databases with Types, Statuses, Descriptions, Parent item relations, and Related Projects.

### Phase 2 — Metadata Enrichment ✅
~265 updates: dates, page bodies on all projects/milestones/tasks/resources/archives/vault objects, 7 area bodies, 4 status corrections.

### Phase 3 — Final Cleanup & Wiring ✅
- [x] **Tech Stack tags**: Populated on all projects (done by separate session)
- [x] **Success Criteria property**: Populated on all projects (done by separate session)
- [x] **Duplicate vault objects**: 3 CLI+Runtime pairs merged into single entries (Streamlit, Node.js, Python)
- [x] **Placeholder entries**: 3 template artifacts flagged [TRASH]/Abandoned (pending manual delete in Notion UI)
- [x] **Blocking/Blocked by relations**: 4 dependency chains wired bidirectionally
  - P-GMAILLABEL → blocks → P-GMAILWIPE + P-FINLEDGER
  - P-MIGRAGAPS → blocks → P-PHOTOMIG
  - P-PERFFIX → blocks → P-CLAWDRIVE
- [x] **Cross-link Tasks ↔ Notes**: 4 tasks linked to 3 research notes bidirectionally
- [x] **Go module cache**: Confirmed just tooling leftover — skipped
- [x] **Schema Reference Doc**: Created as Notion page + workspace markdown file, added to CLAUDE.md

---

## Next Steps

### Ongoing Maintenance
- [ ] **Delete 3 [TRASH] entries**: Right-click → Delete in Notion UI (New Project, New Area, New Resource)
- [ ] **Quarterly PARA review**: Review all items — archive completed projects, promote planning items, update statuses
- [ ] **New project onboarding**: When adding a project, follow naming conventions above, set Parent item, Type, status, Description, and write a page body
- [ ] **Keep this doc current**: Update inventory counts and next steps after major changes
- [ ] **Add new dependencies**: When projects develop blocking relationships, wire Blocking/Blocked by relations
