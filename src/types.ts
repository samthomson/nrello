// Organization types
export interface Organization {
  id: string;
  dTag: string;
  name: string;
  members: string[];
  createdAt: number;
  updatedAt: number;
  isOwner: boolean;
  pubkey: string;
}

// Board types
export interface BoardMember {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

export interface CardItem {
  id: string;
  dTag: string;
  title: string;
  description: string;
  assignees: string[];
  listId: string;
  archived?: boolean;
  deleted?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface ListItem {
  id: string;
  dTag: string;
  title: string;
  cards: CardItem[];
  boardId: string;
}

export interface Board {
  id: string;
  dTag: string;
  name: string;
  description: string;
  isPublic: boolean;
  members: BoardMember[];
  lists: ListItem[];
}

export interface BoardSummary {
  id: string;
  dTag: string;
  name: string;
  description: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
  listCount: number;
  cardCount: number;
  assignedMembers: number;
}

// Layout type for board ordering
export type BoardLayout = Array<{
  listId: string;
  cardIds: string[];
}>;

// Comment type for NIP-22 comments
export interface Comment {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
}

