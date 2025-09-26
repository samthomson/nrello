# Custom Nostr Event Kinds for Kanban Board Application

This document describes the custom event kinds used by the Kanban Board Application built on Nostr.

## Event Kinds

### Kind 36963: Organization

An addressable event that represents an organization in the application.

#### Structure

- **Kind**: `36963`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: JSON string containing organization metadata
- **Tags**:
  - `d` (required): Unique identifier for the organization
  - `name` (required): Name of the organization
  - `p` (optional): Public key of organization members (repeated for each member)

#### Content Format

The content field contains a JSON object with the following properties:

```json
{
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

#### Example Event

```json
{
  "kind": 36963,
  "content": "{\"createdAt\":1675642635,\"updatedAt\":1675642635}",
  "tags": [
    ["d", "org-12345"],
    ["name", "Acme Corporation"],
    ["p", "pubkey1"],
    ["p", "pubkey2"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

#### Example Event

```json
{
  "kind": 36963,
  "content": "{\"createdAt\":1675642635,\"updatedAt\":1675642635}",
  "tags": [
    ["d", "org-12345"],
    ["name", "Acme Corporation"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

### Kind 36173: Kanban Board

An addressable event that represents a Kanban board (project) in the application.

#### Structure

- **Kind**: `36173`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: JSON string containing board metadata
- **Tags**:
  - `d` (required): Unique identifier for the board
  - `name` (required): Name/title of the board
  - `description` (optional): Description of the board
  - `visibility` (required): Either "public" or "private"
  - `t` (optional): Tags for categorization (e.g., "work", "personal")
  - `a` (optional): Reference to the organization this board belongs to (uses `a` tag format)

#### Content Format

The content field contains a JSON object with the following properties:

```json
{
  "description": "Description of the board",
  "createdAt": 1234567890,
  "updatedAt": 1234567890,
  "listOrder": ["list-event-id-1", "list-event-id-2"],
  "cardOrders": {
    "list-event-id-1": ["card-event-id-1", "card-event-id-2"],
    "list-event-id-2": ["card-event-id-3", "card-event-id-4"]
  }
}
```

The `listOrder` array contains the ordered list of list event IDs. The `cardOrders` object contains the ordered list of card event IDs for each list.

#### Example Event

```json
{
  "kind": 36173,
  "content": "{\"description\":\"A sample project board\",\"createdAt\":1675642635,\"updatedAt\":1675642635,\"listOrder\":[\"list-event-id-1\",\"list-event-id-2\"],\"cardOrders\":{\"list-event-id-1\":[\"card-event-id-1\",\"card-event-id-2\"],\"list-event-id-2\":[\"card-event-id-3\"]}}",
  "tags": [
    ["d", "board-12345"],
    ["name", "Project Alpha"],
    ["description", "A sample project board"],
    ["visibility", "public"],
    ["t", "project"],
    ["t", "software"],
    ["a", "36963:<pubkey>:org-12345"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

### Kind 36174: Kanban List

An addressable event that represents a list/column within a Kanban board.

#### Structure

- **Kind**: `36174`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: JSON string containing list metadata
- **Tags**:
  - `d` (required): Unique identifier for the list
  - `a` (required): Reference to the parent board (uses `a` tag format)
  - `title` (required): Title of the list
  - `order` (required): Position/order of the list within the board

#### Content Format

The content field contains a JSON object with the following properties:

```json
{
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

#### Example Event

```json
{
  "kind": 36174,
  "content": "{\"createdAt\":1675642635,\"updatedAt\":1675642635}",
  "tags": [
    ["d", "list-67890"],
    ["a", "36173:<pubkey>:board-12345"],
    ["title", "To Do"],
    ["order", "0"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

### Kind 36175: Kanban Card

An addressable event that represents a card/task within a Kanban list.

#### Structure

- **Kind**: `36175`
- **Type**: Addressable event (uses `d` tag for identification)
- **Content**: JSON string containing card details
- **Tags**:
  - `d` (required): Unique identifier for the card
  - `list` (required): Identifier of the parent list (corresponds to the `d` tag of the list event)
  - `a` (required): Reference to the parent board (uses `a` tag format)
  - `title` (required): Title of the card
  - `order` (required): Position/order of the card within the list

#### Content Format

The content field contains a JSON object with the following properties:

```json
{
  "description": "Description of the task",
  "createdAt": 1234567890,
  "updatedAt": 1234567890
}
```

#### Example Event

```json
{
  "kind": 36175,
  "content": "{\"description\":\"Implement the login functionality\",\"createdAt\":1675642635,\"updatedAt\":1675642635}",
  "tags": [
    ["d", "card-54321"],
    ["list", "list-67890"],
    ["a", "36173:<pubkey>:board-12345"],
    ["title", "Implement login"],
    ["order", "0"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

