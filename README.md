# Kanban Board - Nostr Event Structure

This application implements a collaborative kanban board system using custom Nostr events. All data is stored on the Nostr network using the following event kinds and structures.

## Event Kinds Summary

| Kind | Type | Purpose | Storage |
|------|------|---------|---------|
| **36963** | Addressable | Organizations | Groups users, contains boards |
| **36173** | Addressable | Boards | Contains lists and cards, belongs to org |
| **36174** | Addressable | Lists | Columns within boards, contains cards |
| **36175** | Addressable | Cards | Tasks within lists |
| **1111** | Regular | Comments | NIP-22 comments on cards |
| **0** | Replaceable | Profiles | Standard Nostr user profiles |

**Note**: All events use `event.created_at` for timestamps. Addressable events (30000-39999) use `d` tag for identification and are replaceable per pubkey+kind+d combination.

## Organizations (Kind 36963)

Organizations group users together and contain boards. Users can be either owners (creators) or members.

**Event Structure:**
```json
{
  "kind": 36963,
  "content": "",
  "created_at": 1234567890,
  "tags": [
    ["d", "org-unique-id"],
    ["name", "Organization Name"],
    ["p", "member1_pubkey"],
    ["p", "member2_pubkey"],
    ["p", "member3_pubkey"]
  ]
}
```

**Discovery:**
- **Owned orgs**: `{"kinds": [36963], "authors": [user_pubkey]}`
- **Member orgs**: `{"kinds": [36963], "#p": [user_pubkey]}`

## Boards (Kind 36173)

Boards belong to organizations and contain lists. All organization members can see all organization boards.

**Event Structure:**
```json
{
  "kind": 36173,
  "content": "{\"layout\": [{\"listId\": \"list1\", \"cardIds\": [\"card1\", \"card2\"]}]}",
  "created_at": 1234567890,
  "tags": [
    ["d", "board-unique-id"],
    ["title", "Board Name"],
    ["description", "Board description"],
    ["visibility", "public"],
    ["a", "36963:org_owner_pubkey:org_id"]
  ]
}
```

**Layout Structure:**
The `layout` array in content defines list and card ordering. Only the layout is stored in content JSON; all other metadata uses tags:
```json
{
  "layout": [
    {"listId": "list1", "cardIds": ["card1", "card2", "card3"]},
    {"listId": "list2", "cardIds": ["card4", "card5"]}
  ]
}
```

**Discovery:**
- Find org owner: `{"kinds": [36963], "#d": [org_id]}`
- Find boards: `{"kinds": [36173], "#a": ["36963:org_owner_pubkey:org_id"]}`

## Lists (Kind 36174)

Lists belong to boards and contain cards in a specific order.

**Event Structure:**
```json
{
  "kind": 36174,
  "content": "",
  "created_at": 1234567890,
  "tags": [
    ["d", "list-unique-id"],
    ["title", "List Name"],
    ["a", "36173:board_author_pubkey:board_id"]
  ]
}
```

**Discovery:**
- `{"kinds": [36174], "#a": ["36173:board_author_pubkey:board_id"]}`

## Cards (Kind 36175)

Cards belong to lists and can have assignees, descriptions, and comments.

**Event Structure:**
```json
{
  "kind": 36175,
  "content": "",
  "created_at": 1234567890,
  "tags": [
    ["d", "card-unique-id"],
    ["title", "Card Title"],
    ["description", "Card description"],
    ["list", "list_id"],
    ["a", "36173:board_author_pubkey:board_id"],
    ["p", "assignee1_pubkey"],
    ["p", "assignee2_pubkey"],
    ["archived", "true"],
    ["deleted", "true"]
  ]
}
```

**Card States:**
- **Active**: No `archived` or `deleted` tags
- **Archived**: `["archived", "true"]` tag present
- **Deleted**: `["deleted", "true"]` tag present

**Discovery:**
- `{"kinds": [36175], "#a": ["36173:board_author_pubkey:board_id"]}`

## Comments (Kind 1111) - NIP-22

Comments reference cards using NIP-22 comment standard.

**Event Structure:**
```json
{
  "kind": 1111,
  "content": "Comment text content",
  "tags": [
    ["E", "card_event_id"],
    ["K", "36175"],
    ["P", "card_creator_pubkey"],
    ["e", "card_event_id"],
    ["k", "36175"],
    ["p", "card_creator_pubkey"],
    ["alt", "Comment on card: Card Title"]
  ]
}
```

**NIP-22 Tag Explanation:**
- **Uppercase tags** (E, K, P): Root scope (the card being commented on)
- **Lowercase tags** (e, k, p): Parent scope (same as root for top-level comments)
- **P/p tags**: Reference card creator for notifications
- **Commenter**: Identified by event `pubkey` field

**Discovery:**
- Card comments: `{"kinds": [1111], "#e": [card_event_id]}`
- Board comments: `{"kinds": [1111], "#e": [all_card_event_ids]}`

## User Profiles (Kind 0) - Standard Nostr

User information comes from standard Nostr profile events.

**Discovery:**
- `{"kinds": [0], "authors": [user_pubkey]}`

**Profile Fields Used:**
- `name`: Display name
- `picture`: Avatar URL
- `about`: Bio/description

## Data Relationships

```
Organization (36963)
├── Members (p tags)
└── Boards (36173)
    ├── Layout (content.layout)
    └── Lists (36174)
        └── Cards (36175)
            ├── Assignees (p tags)
            └── Comments (1111)
```

## Permission Model

- **Organization Owner**: Can manage org members and settings
- **Organization Members**: Can see all org boards, lists, and cards
- **Board Creator**: Typically the organization owner
- **Card Assignees**: Tagged users who can see card activity
- **Commenters**: Any org member can comment on cards

## Comparison with Kanbanstr

**Kanbanstr** is another Nostr-based kanban application that uses different event kinds:

| Aspect | This App | Kanbanstr |
|--------|----------|-----------|
| **Board Kind** | 36173 | 30301 |
| **Card Kind** | 36175 | 30302 (public) or 30301 (encrypted) |
| **List Kind** | 36174 (separate events) | Embedded in board via `col` tags |
| **Organizations** | ✅ 36963 (full org system) | ❌ None |
| **Card Encryption** | ❌ Public only | ✅ Optional (30301 encrypted, 30302 public) |
| **Card Assignees** | ✅ `p` tags | ❌ None |
| **Card Description** | `description` tag | `description` tag (30302) or encrypted (30301) |
| **Card Ordering** | Board `layout` JSON | `rank` tag on card |
| **Card Status** | `archived`/`deleted` tags | `status` tag (`open`/`done`/`deleted`) |
| **List Reference** | `list` tag (list ID) | `s` tag (column name) or `col` tag (column ID) |

**Why Incompatible:**
- Different kind numbers prevent direct interoperability
- Kanbanstr lacks organizations, making multi-user collaboration incompatible
- Different data models (separate list events vs embedded columns)
- Different privacy models (public-only vs optional encryption)

These are fundamentally different approaches: this app focuses on **team collaboration** with organizations, while Kanbanstr focuses on **individual use** with optional privacy.