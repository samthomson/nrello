# Custom Nostr Event Kinds for Kanban Board Application

This document describes the custom event kinds used by the Kanban Board Application built on Nostr.

## Design Principles

- **Tags for queryable data**: All metadata that needs relay-level filtering goes in tags
- **Empty content by default**: Most events have empty content (`""`)
- **JSON content only for complex structures**: Only the board's `layout` (ordering) uses JSON content since it's a nested structure that doesn't need relay querying
- **Timestamps from event**: Use `event.created_at` for timestamps instead of storing in content

## Event Kinds

### Kind 36963: Organization

An addressable event that represents an organization in the application.

#### Structure

- **Kind**: `36963`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: Empty string (`""`)
- **Tags**:
  - `d` (required): Unique identifier for the organization
  - `name` (required): Name of the organization
  - `p` (optional, repeatable): Public key of organization members

#### Example Event

```json
{
  "kind": 36963,
  "content": "",
  "tags": [
    ["d", "org-12345"],
    ["name", "Acme Corporation"],
    ["p", "pubkey1"],
    ["p", "pubkey2"]
  ],
  "pubkey": "owner-pubkey",
  "created_at": 1675642635,
  "id": "..."
}
```

### Kind 36173: Kanban Board

An addressable event that represents a Kanban board (project) in the application.

#### Structure

- **Kind**: `36173`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: Empty string (`""`)
- **Tags**:
  - `d` (required): Unique identifier for the board
  - `title` (required): Name/title of the board
  - `description` (optional): Description of the board
  - `visibility` (required): Either `"public"` or `"private"`
  - `a` (optional): Reference to the parent organization (`36963:<pubkey>:<org-d-tag>`)
  - `layout` (optional, repeatable): List and card ordering - format: `["layout", "<list-d-tag>", "<card-d-tag-1>", "<card-d-tag-2>", ...]`

#### Layout Tags

The `layout` tags define the ordering of lists and cards:
- Each `layout` tag represents one list
- The order of `layout` tags defines the order of lists
- First value after "layout" is the list's `d` tag
- Subsequent values are the card `d` tags in order

#### Example Event

```json
{
  "kind": 36173,
  "content": "",
  "tags": [
    ["d", "board-12345"],
    ["title", "Project Alpha"],
    ["description", "A sample project board"],
    ["visibility", "public"],
    ["a", "36963:owner-pubkey:org-12345"],
    ["layout", "list-67890", "card-1", "card-2"],
    ["layout", "list-67891", "card-3"]
  ],
  "pubkey": "creator-pubkey",
  "created_at": 1675642635,
  "id": "..."
}
```

### Kind 36174: Kanban List

An addressable event that represents a list/column within a Kanban board.

#### Structure

- **Kind**: `36174`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: Empty string (`""`)
- **Tags**:
  - `d` (required): Unique identifier for the list
  - `title` (required): Title of the list
  - `a` (required): Reference to the parent board (`36173:<pubkey>:<board-d-tag>`)

Note: List ordering is stored in the parent board's `layout` content, not on the list event itself.

#### Example Event

```json
{
  "kind": 36174,
  "content": "",
  "tags": [
    ["d", "list-67890"],
    ["title", "To Do"],
    ["a", "36173:creator-pubkey:board-12345"]
  ],
  "pubkey": "creator-pubkey",
  "created_at": 1675642635,
  "id": "..."
}
```

### Kind 36175: Kanban Card

An addressable event that represents a card/task within a Kanban list.

#### Structure

- **Kind**: `36175`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: Empty string (`""`)
- **Tags**:
  - `d` (required): Unique identifier for the card
  - `title` (required): Title of the card
  - `description` (optional): Description/details of the card
  - `list` (required): The `d` tag value of the parent list
  - `a` (required): Reference to the parent board (`36173:<pubkey>:<board-d-tag>`)
  - `p` (optional, repeatable): Public keys of assigned users
  - `archived` (optional): Set to `"true"` if the card is archived
  - `deleted` (optional): Set to `"true"` if the card is deleted

Note: Card ordering within a list is stored in the parent board's `layout` content, not on the card event itself.

#### Example Event

```json
{
  "kind": 36175,
  "content": "",
  "tags": [
    ["d", "card-54321"],
    ["title", "Implement login"],
    ["description", "Implement the login functionality with OAuth support"],
    ["list", "list-67890"],
    ["a", "36173:creator-pubkey:board-12345"],
    ["p", "assignee-pubkey-1"],
    ["p", "assignee-pubkey-2"]
  ],
  "pubkey": "creator-pubkey",
  "created_at": 1675642635,
  "id": "..."
}
```

### Kind 1111: Comments (NIP-22)

Comments on cards use the standard NIP-22 comment format.

#### Structure

- **Kind**: `1111`
- **Type**: Regular event
- **Content**: The comment text
- **Tags**:
  - `E` (required): Root event ID (the card being commented on)
  - `K` (required): Kind of root event (`"36175"`)
  - `P` (required): Author of the root event (card creator)
  - `e` (required): Parent event ID (same as `E` for top-level comments)
  - `k` (required): Kind of parent event (`"36175"`)
  - `p` (required): Author of parent event
  - `alt` (optional): Human-readable description

#### Example Event

```json
{
  "kind": 1111,
  "content": "This looks good, let's move forward with this approach.",
  "tags": [
    ["E", "card-event-id"],
    ["K", "36175"],
    ["P", "card-creator-pubkey"],
    ["e", "card-event-id"],
    ["k", "36175"],
    ["p", "card-creator-pubkey"],
    ["alt", "Comment on card: Implement login"]
  ],
  "pubkey": "commenter-pubkey",
  "created_at": 1675642700,
  "id": "..."
}
```

## Data Relationships

```
Organization (36963)
    └── Board (36173) [via 'a' tag]
            ├── List (36174) [via 'a' tag]
            │       └── Card (36175) [via 'list' tag + 'a' tag]
            │               └── Comment (1111) [via 'E'/'e' tags]
            └── layout tags [defines list + card ordering]
```

## Querying

### Get all boards for an organization
```json
{ "kinds": [36173], "#a": ["36963:<org-owner-pubkey>:<org-d-tag>"] }
```

### Get all lists for a board
```json
{ "kinds": [36174], "#a": ["36173:<board-creator-pubkey>:<board-d-tag>"] }
```

### Get all cards for a board
```json
{ "kinds": [36175], "#a": ["36173:<board-creator-pubkey>:<board-d-tag>"] }
```

### Get comments for a card
```json
{ "kinds": [1111], "#e": ["<card-event-id>"] }
```
