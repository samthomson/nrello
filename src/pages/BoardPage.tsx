import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus,
  Users,
  Archive,
  Trash2,
  Clock,
  ChevronRight,
  ChevronLeft,
  UserPlus,
  X,
  Filter,
  MessageSquare
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useOrganization } from '@/hooks/useOrganization';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import type { Board, CardItem, ListItem, BoardLayout, Comment } from '@/types';

// Helper: Convert layout to tags format
// Each layout tag: ['layout', listId, cardId1, cardId2, ...]
const layoutToTags = (layout: BoardLayout): string[][] => {
  return layout.map(item => ['layout', item.listId, ...item.cardIds]);
};

// Helper: Parse layout from tags
const tagsToLayout = (tags: string[][]): BoardLayout => {
  return tags
    .filter(tag => tag[0] === 'layout')
    .map(tag => ({
      listId: tag[1],
      cardIds: tag.slice(2)
    }));
};

const BoardPage = () => {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { nostr } = useNostr();
  const { user, metadata } = useCurrentUser();
  const { currentOrganization } = useOrganization();
  const { mutate: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const [newCardTitle, setNewCardTitle] = useState('');
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [, setIsAddingCard] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [showAddListInput, setShowAddListInput] = useState(false);
  const [selectedCard, setSelectedCard] = useState<{card: CardItem, list: ListItem} | null>(null);
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editedListTitle, setEditedListTitle] = useState('');

  // State for board name editing
  const [isEditingBoardName, setIsEditingBoardName] = useState(false);
  const [editedBoardName, setEditedBoardName] = useState('');

  // Activity panel state
  const [isActivityPanelOpen, setIsActivityPanelOpen] = useState(false);

  // Activity state (archived and deleted cards, and recent comments)
  const [archivedCards, setArchivedCards] = useState<CardItem[]>([]);
  const [deletedCards, setDeletedCards] = useState<CardItem[]>([]);
  const [recentComments, setRecentComments] = useState<Comment[]>([]);

  // Assignee filtering
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [organizationMembers, setOrganizationMembers] = useState<Array<{pubkey: string, name?: string, picture?: string}>>([]);

  // SINGLE SOURCE OF TRUTH for board layout - unified structure with no repetition
  const [boardLayout, setBoardLayout] = useState<BoardLayout>([]);

  // Saving states for visual feedback
  const [savingCards, setSavingCards] = useState<Set<string>>(new Set());
  const [savingLists, setSavingLists] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Subscription status tracking
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  // Helper functions to manage overall board saving state
  const startSavingOperation = () => {
    setIsSaving(true);
  };

  const completeSavingOperation = () => {
    setIsSaving(false);
  };

  // Comment state
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  // Initialize edited description when selected card changes
  useEffect(() => {
    if (selectedCard) {
      console.log('Setting edited description:', selectedCard.card.description);
      setEditedDescription(selectedCard.card.description || '');
      setEditedTitle(selectedCard.card.title);
    }
  }, [selectedCard]);

  // Fetch comments for the selected card
  const { data: cardComments = [] } = useQuery({
    queryKey: ['card-comments', selectedCard?.card.id],
    queryFn: async () => {
      if (!selectedCard || !user) return [];

      try {
        const commentEvents = await nostr.query([
          {
            kinds: [1111], // NIP-22 comments
            '#e': [selectedCard.card.id], // Comments referencing this card
            limit: 50
          }
        ], {
          signal: AbortSignal.any([
            AbortSignal.timeout(3000)
          ])
        });

        // Sort comments by creation time (oldest first)
        return commentEvents.sort((a, b) => a.created_at - b.created_at);
      } catch (error) {
        console.error('Failed to fetch comments:', error);
        return [];
      }
    },
    enabled: !!selectedCard?.card.id && !!user
  });

  // Helper functions to manage saving states
  const startCardSaving = (cardId: string) => {
    setSavingCards(prev => new Set([...prev, cardId]));
    startSavingOperation();
  };

  const stopCardSaving = (cardId: string) => {
    setSavingCards(prev => {
      const newSet = new Set(prev);
      newSet.delete(cardId);

      // Check if we should stop board saving immediately after removing this card
      setSavingLists(currentSavingLists => {
        if (newSet.size === 0 && currentSavingLists.size === 0) {
          completeSavingOperation();
        }
        return currentSavingLists;
      });

      return newSet;
    });
  };

  const startListSaving = (listId: string) => {
    setSavingLists(prev => new Set([...prev, listId]));
    startSavingOperation();
  };

  const stopListSaving = (listId: string) => {
    setSavingLists(prev => {
      const newSet = new Set(prev);
      newSet.delete(listId);

      // Check if we should stop board saving immediately after removing this list
      setSavingCards(currentSavingCards => {
        if (currentSavingCards.size === 0 && newSet.size === 0) {
          completeSavingOperation();
        }
        return currentSavingCards;
      });

      return newSet;
    });
  };

  // Filter cards based on assignee
  const filterCardsByAssignee = (cards: CardItem[]) => {
    if (!assigneeFilter || assigneeFilter === 'all') return cards;

    if (assigneeFilter === 'unassigned') {
      return cards.filter(card => card.assignees.length === 0);
    }

    return cards.filter(card => card.assignees.includes(assigneeFilter));
  };

  // Fetch board data from Nostr
  const { data: board, isLoading, isError } = useQuery({
    queryKey: ['board', boardId],
    queryFn: async () => {
      if (!boardId || !user) throw new Error('Missing board ID or user');

      try {
        // Fetch the board event
        const boardEvents = await nostr.query([
          {
            kinds: [36173],
            '#d': [boardId],
            limit: 1
          }
        ], {
          signal: AbortSignal.any([
            AbortSignal.timeout(5000)
          ])
        });

        if (boardEvents.length === 0) {
          throw new Error('Board not found');
        }

        const boardEvent = boardEvents[0];

        // Parse board name from title tag
        const boardName = boardEvent.tags.find(([name]) => name === 'title')?.[1] || 'Untitled Board';

        // Extract board metadata
        const descriptionTag = boardEvent.tags.find(tag => tag[0] === 'description');
        const visibilityTag = boardEvent.tags.find(tag => tag[0] === 'visibility');

        // Parse board layout from tags
        let layout: BoardLayout = tagsToLayout(boardEvent.tags);

        const boardData: Board = {
          id: boardEvent.id,
          dTag: boardId,
          name: boardName,
          description: descriptionTag?.[1] || '',
          isPublic: visibilityTag?.[1] === 'public',
          members: [
            { id: boardEvent.pubkey, name: 'You', role: 'admin' }
          ],
          lists: []
        };

        // Fetch lists for this board
        const listEvents = await nostr.query([
          {
            kinds: [36174],
            '#a': [`36173:${boardEvent.pubkey}:${boardId}`],
            limit: 100
          }
        ], {
          signal: AbortSignal.any([
            AbortSignal.timeout(5000)
          ])
        });

        // Parse lists
        const listsMap = new Map<string, ListItem>();
        listEvents.forEach(event => {
          const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || event.id;
          const titleTag = event.tags.find(tag => tag[0] === 'title');

          listsMap.set(dTag, {
            id: event.id,
            dTag,
            title: titleTag?.[1] || 'Untitled List',
            boardId: boardId,
            cards: []
          });
        });

        // Fetch cards for all lists in this board
        const cardEvents = await nostr.query([
          {
            kinds: [36175],
            '#a': [`36173:${boardEvent.pubkey}:${boardId}`],
            limit: 1000
          }
        ], {
          signal: AbortSignal.any([
            AbortSignal.timeout(5000)
          ])
        });

        // Group cards by list and collect archived/deleted cards
        const cardsByList = new Map<string, CardItem[]>();
        const archivedCardsList: CardItem[] = [];
        const deletedCardsList: CardItem[] = [];

        cardEvents.forEach(event => {
          const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || event.id;
          const listTag = event.tags.find(tag => tag[0] === 'list');
          const titleTag = event.tags.find(tag => tag[0] === 'title');
          const descriptionTag = event.tags.find(tag => tag[0] === 'description');
          const archivedTag = event.tags.find(tag => tag[0] === 'archived');
          const deletedTag = event.tags.find(tag => tag[0] === 'deleted');

          // Use event.created_at for timestamps, description from tag
          const createdAt = event.created_at;
          const updatedAt = event.created_at;
          const description = descriptionTag?.[1] || '';

          // Parse assignees from 'p' tags
          const assigneeTags = event.tags.filter(tag => tag[0] === 'p');
          const assignees = assigneeTags.map(tag => tag[1]);

          const cardItem = {
            id: event.id,
            dTag,
            title: titleTag?.[1] || 'Untitled Card',
            description,
            assignees,
            listId: listTag?.[1] || 'unknown',
            archived: archivedTag?.[1] === 'true',
            deleted: deletedTag?.[1] === 'true',
            createdAt,
            updatedAt
          };

          // Collect deleted cards for activity panel
          if (deletedTag?.[1] === 'true') {
            deletedCardsList.push(cardItem);
            return;
          }

          // Collect archived cards for activity panel
          if (archivedTag?.[1] === 'true') {
            archivedCardsList.push(cardItem);
            return;
          }

          // For active cards
          if (listTag) {
            const listDtag = listTag[1];
            if (!cardsByList.has(listDtag)) {
              cardsByList.set(listDtag, []);
            }

            cardsByList.get(listDtag)!.push(cardItem);
          }
        });

        // Set activity cards after loading - sort by updatedAt descending (newest first)
        setBoardLayout(prev => [...prev]);
        setArchivedCards(archivedCardsList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        setDeletedCards(deletedCardsList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));

        // Fetch organization members if we have an organization
        if (currentOrganization) {
          // Fetch organization event to get members
          nostr.query([
            {
              kinds: [36963],
              '#d': [currentOrganization],
              authors: [user.pubkey],
              limit: 1
            }
          ]).then(orgEvents => {
            if (orgEvents.length > 0) {
              const orgEvent = orgEvents[0];
                  const memberPubkeys = orgEvent.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);

              // Fetch member profiles
              if (memberPubkeys.length > 0) {
                nostr.query([
                  {
                    kinds: [0],
                    authors: memberPubkeys,
                    limit: 50
                  }
                ]).then(profileEvents => {
                  const members = memberPubkeys.map(pubkey => {
                    const profileEvent = profileEvents.find(e => e.pubkey === pubkey);
                    let profile: NostrMetadata = {};
                    if (profileEvent) {
                      try {
                        profile = JSON.parse(profileEvent.content) as NostrMetadata;
                      } catch {
                        // Ignore parse errors
                      }
                    }
                    return {
                      pubkey,
                      name: profile.name || profile.display_name || `User ${pubkey.slice(0, 8)}...`,
                      picture: profile.picture
                    };
                  });
                  setOrganizationMembers(members);
                });
              }
            }
          });
        }

        // Ensure layout includes all existing lists and cards
        const existingListIds = new Set(listsMap.keys());
        const layoutListIds = new Set(layout.map(item => item.listId));

        // Add missing lists to layout
        listsMap.forEach((list, listId) => {
          if (!layoutListIds.has(listId)) {
            layout.push({
              listId,
              cardIds: cardsByList.get(listId)?.map(c => c.dTag) || []
            });
          }
        });

        // Filter out deleted lists and ensure all cards are included
        layout = layout.filter(item => existingListIds.has(item.listId))
          .map(item => {
            const cards = cardsByList.get(item.listId) || [];
            const cardDtags = cards.map(c => c.dTag);
            const existingCardIds = new Set(cardDtags);

            // Filter out deleted cards and add missing ones
            const filteredCardIds = item.cardIds.filter(id => existingCardIds.has(id));
            const missingCardIds = cardDtags.filter(id => !item.cardIds.includes(id));

            return {
              listId: item.listId,
              cardIds: [...filteredCardIds, ...missingCardIds]
            };
          });

        // Build the board lists array according to layout
        const sortedLists: ListItem[] = layout.map(layoutItem => {
          const list = listsMap.get(layoutItem.listId)!;
          const cards = cardsByList.get(layoutItem.listId) || [];

          // Sort cards according to layout
          list.cards = layoutItem.cardIds
            .map(cardId => cards.find(c => c.dTag === cardId))
            .filter(Boolean) as CardItem[];

          return list;
        });

        boardData.lists = sortedLists;

        // Set the layout state when board loads
        setBoardLayout(layout);

        return boardData;
      } catch (error) {
        console.error('Failed to fetch board:', error);
        throw error;
      }
    },
    enabled: !!boardId && !!user
  });

  // Fetch recent comments for activity panel
  const { data: boardComments = [] } = useQuery({
    queryKey: ['board-comments', boardId],
    queryFn: async () => {
      if (!board || !user) return [];

      try {
        // Get all card IDs from the board
        const allCardIds = board.lists.flatMap(list => list.cards.map(card => card.id));

        if (allCardIds.length === 0) return [];

        // Fetch recent comments for all cards in this board
        const commentEvents = await nostr.query([
          {
            kinds: [1111], // NIP-22 comments
            '#e': allCardIds, // Comments referencing any card in this board
            limit: 50
          }
        ], {
          signal: AbortSignal.any([
            AbortSignal.timeout(3000)
          ])
        });

        // Sort comments by creation time (newest first for activity panel)
        const sortedComments = commentEvents.sort((a, b) => b.created_at - a.created_at);
        console.log('Board comments fetched:', sortedComments.length, 'comments');
        console.log('Recent board comments:', sortedComments.slice(0, 3).map(c => ({
          id: c.id,
          pubkey: c.pubkey,
          content: c.content.slice(0, 50),
          created_at: c.created_at
        })));
        return sortedComments;
      } catch (error) {
        console.error('Failed to fetch board comments:', error);
        return [];
      }
    },
    enabled: !!board && !!user && board.lists.length > 0
  });

  // Update recent comments state when data changes
  useEffect(() => {
    if (boardComments.length > 0) {
      setRecentComments(boardComments.slice(0, 20)); // Keep last 20 comments for activity
    }
  }, [boardComments]);

  // Real-time event handlers
  const handleBoardUpdate = useCallback((event: NostrEvent) => {
    console.log('Board updated:', event);

    // Parse board tags
    const titleTag = event.tags.find((tag) => tag[0] === 'title');
    const descriptionTag = event.tags.find((tag) => tag[0] === 'description');
    const visibilityTag = event.tags.find((tag) => tag[0] === 'visibility');

    // Parse layout from tags
    const layout = tagsToLayout(event.tags);

    // Update board data in cache
    queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
      if (!oldBoard) return oldBoard;

      const updatedBoard = {
        ...oldBoard,
        name: titleTag?.[1] || oldBoard.name,
        description: descriptionTag?.[1] || oldBoard.description,
        isPublic: visibilityTag?.[1] === 'public'
      };

      // Update layout if present
      if (layout.length > 0) {
        setBoardLayout(layout);
      }

      return updatedBoard;
    });
  }, [boardId, queryClient, setBoardLayout]);

  const handleListUpdate = useCallback((event: NostrEvent) => {
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
    const titleTag = event.tags.find((tag) => tag[0] === 'title');
    const aTag = event.tags.find((tag) => tag[0] === 'a')?.[1];

    console.log('📋 HANDLING LIST UPDATE:', {
      id: event.id,
      dTag,
      title: titleTag?.[1],
      aTag,
      belongsToThisBoard: aTag?.includes(boardId!)
    });

    if (!dTag) {
      console.warn('List event missing d tag');
      return;
    }

    // Only process lists that belong to this board
    if (!aTag || !aTag.includes(boardId!)) {
      console.log('List does not belong to this board, ignoring');
      return;
    }

    queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
      if (!oldBoard) return oldBoard;

      const existingListIndex = oldBoard.lists.findIndex((list) => list.dTag === dTag);

      if (existingListIndex >= 0) {
        // Update existing list
        const updatedLists = [...oldBoard.lists];
        updatedLists[existingListIndex] = {
          ...updatedLists[existingListIndex],
          id: event.id,
          title: titleTag?.[1] || updatedLists[existingListIndex].title
        };

        return {
          ...oldBoard,
          lists: updatedLists
        };
      } else {
        // Add new list
        const newList = {
          id: event.id,
          dTag,
          title: titleTag?.[1] || 'Untitled List',
          cards: [],
          boardId: boardId
        };

        // Add to layout if not present
        setBoardLayout(prev => {
          const existsInLayout = prev.some(item => item.listId === dTag);
          if (!existsInLayout) {
            return [...prev, { listId: dTag, cardIds: [] }];
          }
          return prev;
        });

        return {
          ...oldBoard,
          lists: [...oldBoard.lists, newList]
        };
      }
    });
  }, [boardId, queryClient, setBoardLayout]);

  const handleCardUpdate = useCallback((event: NostrEvent) => {
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];
    const listTag = event.tags.find((tag) => tag[0] === 'list');
    const titleTag = event.tags.find((tag) => tag[0] === 'title');
    const archivedTag = event.tags.find((tag) => tag[0] === 'archived');
    const deletedTag = event.tags.find((tag) => tag[0] === 'deleted');
    const aTag = event.tags.find((tag) => tag[0] === 'a')?.[1];

    console.log('🃏 HANDLING CARD UPDATE:', {
      id: event.id,
      dTag,
      title: titleTag?.[1],
      list: listTag?.[1],
      aTag,
      archived: archivedTag?.[1],
      deleted: deletedTag?.[1],
      belongsToThisBoard: aTag?.includes(boardId!)
    });

    if (!dTag || !listTag) {
      console.warn('Card event missing required tags');
      return;
    }

    // Only process cards that belong to this board
    if (!aTag || !aTag.includes(boardId!)) {
      console.log('Card does not belong to this board, ignoring');
      return;
    }

    const listDTag = listTag[1];
    const assigneeTags = event.tags.filter((tag) => tag[0] === 'p');
    const assignees = assigneeTags.map((tag) => tag[1]);
    const descriptionTag = event.tags.find((tag) => tag[0] === 'description');

    // Get description from tag
    const description = descriptionTag?.[1] || '';

    const cardItem = {
      id: event.id,
      dTag,
      title: titleTag?.[1] || 'Untitled Card',
      description,
      assignees,
      listId: listDTag,
      archived: archivedTag?.[1] === 'true',
      deleted: deletedTag?.[1] === 'true',
      createdAt: event.created_at,
      updatedAt: event.created_at
    };

    // Handle archived/deleted cards
    if (deletedTag?.[1] === 'true') {
      setDeletedCards(prev => {
        const filtered = prev.filter(c => c.dTag !== dTag);
        return [cardItem, ...filtered].slice(0, 20);
      });

      // Remove from board
      queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
        if (!oldBoard) return oldBoard;
        return {
          ...oldBoard,
          lists: oldBoard.lists.map((list) => ({
            ...list,
            cards: list.cards.filter((c) => c.dTag !== dTag)
          }))
        };
      });

      // Remove from layout
      setBoardLayout(prev => prev.map(item => ({
        ...item,
        cardIds: item.cardIds.filter(id => id !== dTag)
      })));

      return;
    }

    if (archivedTag?.[1] === 'true') {
      setArchivedCards(prev => {
        const filtered = prev.filter(c => c.dTag !== dTag);
        return [cardItem, ...filtered].slice(0, 20);
      });

      // Remove from board
      queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
        if (!oldBoard) return oldBoard;
        return {
          ...oldBoard,
          lists: oldBoard.lists.map((list) => ({
            ...list,
            cards: list.cards.filter((c) => c.dTag !== dTag)
          }))
        };
      });

      // Remove from layout
      setBoardLayout(prev => prev.map(item => ({
        ...item,
        cardIds: item.cardIds.filter(id => id !== dTag)
      })));

      return;
    }

    // Handle active cards
    queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
      if (!oldBoard) return oldBoard;

      const updatedLists = oldBoard.lists.map((list) => {
        if (list.dTag === listDTag) {
          const existingCardIndex = list.cards.findIndex((c) => c.dTag === dTag);

          if (existingCardIndex >= 0) {
            // Update existing card
            const updatedCards = [...list.cards];
            updatedCards[existingCardIndex] = cardItem;
            return {
              ...list,
              cards: updatedCards
            };
          } else {
            // Add new card
            const updatedCards = [...list.cards, cardItem];

            // Add to layout if not present
            setBoardLayout(prev => prev.map(item => {
              if (item.listId === listDTag) {
                const cardExists = item.cardIds.includes(dTag);
                if (!cardExists) {
                  return {
                    ...item,
                    cardIds: [...item.cardIds, dTag]
                  };
                }
              }
              return item;
            }));

            return {
              ...list,
              cards: updatedCards
            };
          }
        }

        // Remove card from other lists if it moved
        return {
          ...list,
          cards: list.cards.filter((c) => c.dTag !== dTag)
        };
      });

      return {
        ...oldBoard,
        lists: updatedLists
      };
    });
  }, [boardId, queryClient, setBoardLayout, setDeletedCards, setArchivedCards]);

  const handleCommentUpdate = useCallback((event: NostrEvent) => {
    console.log('Comment updated:', event);

    // Refresh board comments for activity panel
    queryClient.invalidateQueries({ queryKey: ['board-comments', boardId!] });

    // If this comment is for the currently selected card, refresh card comments
    if (selectedCard) {
      const cardId = event.tags.find((tag) => tag[0] === 'e')?.[1];
      if (cardId === selectedCard.card.id) {
        queryClient.invalidateQueries({ queryKey: ['card-comments', selectedCard.card.id] });
      }
    }
  }, [boardId, queryClient, selectedCard]);

  // Real-time subscription system - subscribe to all relevant data
  useEffect(() => {
    if (!user || !boardId) return;

    const abortController = new AbortController();

    console.log('🔌 Setting up comprehensive real-time subscription for board:', boardId);

    // Ultra-aggressive subscription - get ALL recent events and filter manually
    const subscriptionFilters = [
      // 1. ALL recent card events (we'll filter manually)
      {
        kinds: [36175],
        since: Math.floor(Date.now() / 1000) - 3600, // Last hour
        limit: 1000
      },
      // 2. ALL recent list events (we'll filter manually)
      {
        kinds: [36174],
        since: Math.floor(Date.now() / 1000) - 3600, // Last hour
        limit: 200
      },
      // 3. Board events for this board
      {
        kinds: [36173],
        '#d': [boardId],
        limit: 10
      }
      // Note: Comments handled separately since they use different filtering
    ];

    console.log('📋 Subscription filters:', JSON.stringify(subscriptionFilters, null, 2));

    const runSubscription = async () => {
      try {
        setIsSubscribed(true);
        setSubscriptionError(null);

        for await (const msg of nostr.req(subscriptionFilters, { signal: abortController.signal })) {
          if (msg[0] === 'EVENT') {
            const event = msg[2];
            console.log('🔥 REAL-TIME EVENT RECEIVED:', {
              kind: event.kind,
              id: event.id,
              pubkey: event.pubkey,
              created_at: event.created_at,
              tags: event.tags.map(t => `${t[0]}:${t[1]}`),
              content_preview: event.content.slice(0, 50)
            });

            // Handle different event types
            const aTag = event.tags.find((tag) => tag[0] === 'a')?.[1];
            const belongsToBoard = aTag && aTag.includes(boardId);

            switch (event.kind) {
              case 36173:
                handleBoardUpdate(event);
                break;
              case 36174:
                if (belongsToBoard) {
                  handleListUpdate(event);
                }
                break;
              case 36175:
                if (belongsToBoard) {
                  handleCardUpdate(event);
                }
                break;
              case 1111:
                if (belongsToBoard) {
                  handleCommentUpdate(event);
                }
                break;
              default:
                console.log('Unhandled event kind:', event.kind);
            }
          } else if (msg[0] === 'EOSE') {
            console.log('✅ Real-time subscription established for board:', boardId);
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('❌ Subscription error:', error);
          setIsSubscribed(false);
          setSubscriptionError(error instanceof Error ? error.message : 'Subscription failed');
        }
      }
    };

    runSubscription();

    // Cleanup subscription on unmount
    return () => {
      console.log('🧹 Cleaning up real-time subscription for board:', boardId);
      abortController.abort();
      setIsSubscribed(false);
      setSubscriptionError(null);
      // Note: nostrify subscriptions don't have a close method
      // The subscription will be automatically cleaned up when the component unmounts
    };
  }, [user, boardId, currentOrganization, nostr, queryClient, handleBoardUpdate, handleCardUpdate, handleCommentUpdate, handleListUpdate]);

  useSeoMeta({
    title: board ? "'" + board.name + "' board - nrello" : 'loading board...',
    description: board ? `Manage tasks for ${board.name}` : 'Loading board...',
  });

  // Helper function to update board with new layout
  const updateBoardWithLayout = (newLayout: BoardLayout, cardIdBeingMoved?: string) => {
    if (!board || !user || !boardId) return;

    // Start saving operation
    startSavingOperation();

    // Layout stored in tags, content is empty
    const boardEvent = {
      kind: 36173,
      content: '',
      tags: [
        ['d', boardId],
        ['title', board.name],
        ['description', board.description],
        ['visibility', board.isPublic ? 'public' : 'private'],
        ...layoutToTags(newLayout)
      ]
    };

    if (currentOrganization) {
      boardEvent.tags.push(['a', `36963:${user.pubkey}:${currentOrganization}`]);
    }

    publishEvent(boardEvent, {
      onSuccess: () => {
        console.log('Board layout updated successfully');
        // Complete saving operation
        completeSavingOperation();

        // If we have a card being moved (within same list), stop its saving state
        if (cardIdBeingMoved) {
          stopCardSaving(cardIdBeingMoved);
        }

        // Only stop board saving if no individual cards or lists are saving
        setSavingCards(currentSavingCards => {
          setSavingLists(currentSavingLists => {
            if (currentSavingCards.size === 0 && currentSavingLists.size === 0) {
              // Board saving is handled by completeSavingOperation()
            }
            return currentSavingLists;
          });
          return currentSavingCards;
        });
      },
      onError: (error) => {
        console.error('Failed to update board layout:', error);
        // Complete saving operation even on error
        completeSavingOperation();

        // If we have a card being moved (within same list), stop its saving state
        if (cardIdBeingMoved) {
          stopCardSaving(cardIdBeingMoved);
        }

        // Only stop board saving if no individual cards or lists are saving
        setSavingCards(currentSavingCards => {
          setSavingLists(currentSavingLists => {
            if (currentSavingCards.size === 0 && currentSavingLists.size === 0) {
              // Board saving is handled by completeSavingOperation()
            }
            return currentSavingLists;
          });
          return currentSavingCards;
        });
      }
    });
  };

  const handleAddCard = (listId: string) => {
    if (newCardTitle.trim() && board && user) {
      const list = board.lists.find(l => l.dTag === listId);
      if (!list) return;

      const cardId = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const now = Math.floor(Date.now() / 1000);

      // Create the new card object
      const newCard: CardItem = {
        id: cardId, // Temporary ID
        dTag: cardId,
        title: newCardTitle,
        description: '',
        assignees: [],
        listId,
        createdAt: now,
        updatedAt: now
      };

      // Update UI immediately (optimistic update)
      queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
        if (!oldBoard) return oldBoard;

        const updatedLists = oldBoard.lists.map(list => {
          if (list.dTag === listId) {
            return {
              ...list,
              cards: [...list.cards, newCard]
            };
          }
          return list;
        });

        return {
          ...oldBoard,
          lists: updatedLists
        };
      });

      // Update layout immediately
      setBoardLayout(prev => {
        const newLayout = prev.map(item => {
          if (item.listId === listId) {
            return {
              ...item,
              cardIds: [...item.cardIds, cardId]
            };
          }
          return item;
        });

        // Trigger board update with new layout
        updateBoardWithLayout(newLayout);
        return newLayout;
      });

      // Clear input immediately
      setNewCardTitle('');

      // Start saving operation
      startSavingOperation();

      // Now publish the event (empty content, description in tag)
      const cardEvent = {
        kind: 36175,
        content: '',
        tags: [
          ['d', cardId],
          ['title', newCardTitle],
          ['description', ''],
          ['list', listId],
          ['a', `36173:${user.pubkey}:${boardId}`]
        ]
      };

      publishEvent(cardEvent, {
        onSuccess: (data) => {
          console.log('Card created successfully:', data);
          // Clear add card UI
          setActiveListId(null);
          setIsAddingCard(false);
          setNewCardTitle('');
          // Complete saving operation
          completeSavingOperation();
          // Update the card ID with the real event ID
          queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
            if (!oldBoard) return oldBoard;

            const updatedLists = oldBoard.lists.map(list => {
              if (list.dTag === listId) {
                return {
                  ...list,
                  cards: list.cards.map(card => {
                    if (card.dTag === cardId) {
                      return {
                        ...card,
                        id: data.id
                      };
                    }
                    return card;
                  })
                };
              }
              return list;
            });

            return {
              ...oldBoard,
              lists: updatedLists
            };
          });
        },
        onError: (error) => {
          console.error('Failed to create card:', error);
          // Clear add card UI
          setActiveListId(null);
          setIsAddingCard(false);
          setNewCardTitle('');
          // Complete saving operation even on error
          completeSavingOperation();
          // Revert the optimistic update
          queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
            if (!oldBoard) return oldBoard;

            const updatedLists = oldBoard.lists.map(list => {
              if (list.dTag === listId) {
                return {
                  ...list,
                  cards: list.cards.filter(c => c.dTag !== cardId)
                };
              }
              return list;
            });

            return {
              ...oldBoard,
              lists: updatedLists
            };
          });

          // Revert layout update
          setBoardLayout(prev => {
            return prev.map(item => {
              if (item.listId === listId) {
                return {
                  ...item,
                  cardIds: item.cardIds.filter(id => id !== cardId)
                };
              }
              return item;
            });
          });
        }
      });
    }
  };

  const handleUpdateBoardName = () => {
    if (!board || !user || !boardId) return;

    // Layout stored in tags, content is empty
    const boardEvent = {
      kind: 36173,
      content: '',
      tags: [
        ['d', boardId],
        ['title', editedBoardName],
        ['description', board.description],
        ['visibility', board.isPublic ? 'public' : 'private'],
        ...layoutToTags(boardLayout)
      ]
    };

    if (currentOrganization) {
      boardEvent.tags.push(['a', `36963:${user.pubkey}:${currentOrganization}`]);
    }

    // Start saving operation
    startSavingOperation();

    publishEvent(boardEvent, {
      onSuccess: (data) => {
        console.log('Board name updated successfully:', data);
        // Complete saving operation
        completeSavingOperation();
        queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;
          return {
            ...oldBoard,
            name: editedBoardName
          };
        });
      },
      onError: (error) => {
        console.error('Failed to update board name:', error);
      }
    });
  };

  const handleUpdateCardTitle = () => {
    if (selectedCard && editedTitle.trim() && editedTitle !== selectedCard.card.title && user && boardId) {
      // Start saving state for the card
      startCardSaving(selectedCard.card.dTag);

      const cardEvent = {
        kind: 36175,
        content: '',
        tags: [
          ['d', selectedCard.card.dTag],
          ['title', editedTitle],
          ['description', selectedCard.card.description || ''],
          ['list', selectedCard.card.listId],
          ['a', `36173:${user.pubkey}:${boardId}`],
          ...selectedCard.card.assignees.map(pubkey => ['p', pubkey])
        ]
      };

      publishEvent(cardEvent, {
        onSuccess: (data) => {
          console.log('Card title updated successfully:', data);
          stopCardSaving(selectedCard.card.dTag);
          if (selectedCard) {
            setSelectedCard({
              ...selectedCard,
              card: {
                ...selectedCard.card,
                title: editedTitle
              }
            });
          }
          queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
            if (!oldBoard) return oldBoard;
            return {
              ...oldBoard,
              lists: oldBoard.lists.map(list => {
                if (list.dTag === selectedCard?.card.listId) {
                  return {
                    ...list,
                    cards: list.cards.map(card => {
                      if (card.dTag === selectedCard?.card.dTag) {
                        return {
                          ...card,
                          title: editedTitle
                        };
                      }
                      return card;
                    })
                  };
                }
                return list;
              })
            };
          });
        },
        onError: (error) => {
          console.error('Failed to update card title:', error);
          stopCardSaving(selectedCard.card.dTag);
          setEditedTitle(selectedCard.card.title);
        }
      });
    }
  };

  const handleDeleteCard = () => {
    if (!selectedCard || !user || !boardId) return;

    const { card } = selectedCard;
    const now = Math.floor(Date.now() / 1000);

    // Start saving state for the card
    startCardSaving(card.dTag);

    // 1. Publish deletion event (NIP-09)
    const deletionEvent = {
      kind: 5,
      content: 'Deleted',
      tags: [
        ['e', card.id],
        ['k', '36175']
      ]
    };

    publishEvent(deletionEvent, {
      onSuccess: () => {
        console.log('Card deletion event published');
        // Complete saving operation
        completeSavingOperation();
      }
    });

    // 2. Update the card event with deleted flag
    const cardEvent = {
      kind: 36175,
      content: '',
      tags: [
        ['d', card.dTag],
        ['title', card.title],
        ['description', card.description || ''],
        ['list', card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ['deleted', 'true']
      ]
    };

    publishEvent(cardEvent, {
      onSuccess: () => {
        // Create deleted card item for immediate UI update
        const deletedCard: CardItem = {
          ...card,
          deleted: true,
          updatedAt: now
        };

        // Update deleted cards state immediately
        setDeletedCards(prev => [deletedCard, ...prev]);

        // Update local state - remove from board
        queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;
          return {
            ...oldBoard,
            lists: oldBoard.lists.map(list => {
              if (list.dTag === card.listId) {
                return {
                  ...list,
                  cards: list.cards.filter(c => c.dTag !== card.dTag)
                };
              }
              return list;
            })
          };
        });

        // Update layout - remove card from ordering
        setBoardLayout(prev => {
          const newLayout = prev.map(item => {
            if (item.listId === card.listId) {
              return {
                ...item,
                cardIds: item.cardIds.filter(id => id !== card.dTag)
              };
            }
            return item;
          });

          // Update board with new layout
          updateBoardWithLayout(newLayout);
          return newLayout;
        });

        // Close modal
        setIsCardModalOpen(false);
        setSelectedCard(null);
        stopCardSaving(card.dTag);
      },
      onError: (error) => {
        console.error('Failed to delete card:', error);
        stopCardSaving(card.dTag);
      }
    });
  };

  const handleRestoreCard = (card: CardItem) => {
    if (!user || !boardId) return;

    const now = Math.floor(Date.now() / 1000);

    // Start saving state for the card
    startCardSaving(card.dTag);

    // Update the card event to remove archived flag
    const cardEvent = {
      kind: 36175,
      content: '',
      tags: [
        ['d', card.dTag],
        ['title', card.title],
        ['description', card.description || ''],
        ['list', card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`]
        // Note: no archived tag = not archived
      ]
    };

    publishEvent(cardEvent, {
      onSuccess: () => {
        // Create restored card item for immediate UI update
        const restoredCard: CardItem = {
          ...card,
          archived: false,
          updatedAt: now
        };

        // Remove from archived cards state
        setArchivedCards(prev => prev.filter(c => c.dTag !== card.dTag));

        // Add back to board
        queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;
          return {
            ...oldBoard,
            lists: oldBoard.lists.map(list => {
              if (list.dTag === card.listId) {
                return {
                  ...list,
                  cards: [...list.cards, restoredCard]
                };
              }
              return list;
            })
          };
        });

        // Add back to layout
        setBoardLayout(prev => {
          const newLayout = prev.map(item => {
            if (item.listId === card.listId) {
              return {
                ...item,
                cardIds: [...item.cardIds, card.dTag]
              };
            }
            return item;
          });

          // Update board with new layout
          updateBoardWithLayout(newLayout);
          return newLayout;
        });
        stopCardSaving(card.dTag);
      },
      onError: (error) => {
        console.error('Failed to restore card:', error);
        stopCardSaving(card.dTag);
      }
    });
  };

  const handleArchiveCard = () => {
    if (!selectedCard || !user || !boardId) return;

    const { card } = selectedCard;
    const now = Math.floor(Date.now() / 1000);

    // Start saving state for the card
    startCardSaving(card.dTag);

    // Update the card event with archived flag
    const cardEvent = {
      kind: 36175,
      content: '',
      tags: [
        ['d', card.dTag],
        ['title', card.title],
        ['description', card.description || ''],
        ['list', card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ['archived', 'true']
      ]
    };

    publishEvent(cardEvent, {
      onSuccess: () => {
        // Create archived card item for immediate UI update
        const archivedCard: CardItem = {
          ...card,
          archived: true,
          updatedAt: now
        };

        // Update archived cards state immediately
        setArchivedCards(prev => [archivedCard, ...prev]);

        // Update local state - remove from board (archived cards are hidden)
        queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;
          return {
            ...oldBoard,
            lists: oldBoard.lists.map(list => {
              if (list.dTag === card.listId) {
                return {
                  ...list,
                  cards: list.cards.filter(c => c.dTag !== card.dTag)
                };
              }
              return list;
            })
          };
        });

        // Update layout - remove card from ordering
        setBoardLayout(prev => {
          const newLayout = prev.map(item => {
            if (item.listId === card.listId) {
              return {
                ...item,
                cardIds: item.cardIds.filter(id => id !== card.dTag)
              };
            }
            return item;
          });

          // Update board with new layout
          updateBoardWithLayout(newLayout);
          return newLayout;
        });

        // Close modal
        setIsCardModalOpen(false);
        setSelectedCard(null);
      },
      onError: (error) => {
        console.error('Failed to archive card:', error);
        // Complete saving operation even on error
        completeSavingOperation();
      }
    });
  };

  const handleUpdateCardAssignees = (newAssignees: string[]) => {
    if (!selectedCard || !user || !boardId) return;

    // Start saving state for the card
    startCardSaving(selectedCard.card.dTag);

    const cardEvent = {
      kind: 36175,
      content: '',
      tags: [
        ['d', selectedCard.card.dTag],
        ['title', selectedCard.card.title],
        ['description', selectedCard.card.description || ''],
        ['list', selectedCard.card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ...newAssignees.map(pubkey => ['p', pubkey])
      ]
    };

    publishEvent(cardEvent, {
      onSuccess: () => {
        console.log('Card assignees updated successfully');
        stopCardSaving(selectedCard.card.dTag);
        // Update the selected card state
        if (selectedCard) {
          setSelectedCard({
            ...selectedCard,
            card: {
              ...selectedCard.card,
              assignees: newAssignees
            }
          });
        }
        // Update the query cache
        queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;
          return {
            ...oldBoard,
            lists: oldBoard.lists.map(list => {
              if (list.dTag === selectedCard?.card.listId) {
                return {
                  ...list,
                  cards: list.cards.map(card => {
                    if (card.dTag === selectedCard?.card.dTag) {
                      return {
                        ...card,
                        assignees: newAssignees
                      };
                    }
                    return card;
                  })
                };
              }
              return list;
            })
          };
        });
      },
      onError: (error) => {
        console.error('Failed to update card assignees:', error);
        stopCardSaving(selectedCard.card.dTag);
      }
    });
  };

  const handleUpdateCardDescription = () => {
    if (!selectedCard || !user || !boardId) return;

    // Check if already saving this card
    if (savingCards.has(selectedCard.card.dTag)) return;

    // Check if description actually changed
    if (editedDescription === (selectedCard.card.description || '')) return;

    // Start saving state for the card
    startCardSaving(selectedCard.card.dTag);

    const cardEvent = {
      kind: 36175,
      content: '',
      tags: [
        ['d', selectedCard.card.dTag],
        ['title', selectedCard.card.title],
        ['description', editedDescription],
        ['list', selectedCard.card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ...selectedCard.card.assignees.map(pubkey => ['p', pubkey])
      ]
    };

    publishEvent(cardEvent, {
        onSuccess: (data) => {
          console.log('Card description updated successfully:', data);
          stopCardSaving(selectedCard.card.dTag);
          if (selectedCard) {
            setSelectedCard({
              ...selectedCard,
              card: {
                ...selectedCard.card,
                description: editedDescription
              }
            });
          }
          queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
            if (!oldBoard) return oldBoard;
            return {
              ...oldBoard,
              lists: oldBoard.lists.map(list => {
                if (list.dTag === selectedCard?.card.listId) {
                  return {
                    ...list,
                    cards: list.cards.map(card => {
                      if (card.dTag === selectedCard?.card.dTag) {
                        return {
                          ...card,
                          description: editedDescription
                        };
                      }
                      return card;
                    })
                  };
                }
                return list;
              })
            };
          });
        },
        onError: (error) => {
          console.error('Failed to update card description:', error);
          stopCardSaving(selectedCard.card.dTag);
          setEditedDescription(selectedCard.card.description || '');
        }
      });
  };

  const handleAddList = async () => {
    if (newListTitle.trim() && board && user && boardId) {
      try {
        // Find the board event to get the board creator
        const boardEvents = await nostr.query([
          {
            kinds: [36173],
            '#d': [boardId],
            limit: 1
          }
        ], {
          signal: AbortSignal.timeout(3000)
        });

        if (boardEvents.length === 0) {
          console.error('Board not found for list creation');
          return;
        }

        const boardCreator = boardEvents[0].pubkey;
        const listId = `list-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const listEvent = {
          kind: 36174,
          content: '',
          tags: [
            ['d', listId],
            ['title', newListTitle],
            ['a', `36173:${boardCreator}:${boardId}`]
          ]
        };

        publishEvent(listEvent, {
        onSuccess: (data) => {
          console.log('List created successfully:', data);
          // Clear add list UI
          setNewListTitle('');
          setShowAddListInput(false);
          queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
            if (!oldBoard) return oldBoard;

            const newList: ListItem = {
              id: data.id,
              dTag: listId,
              title: newListTitle,
              cards: [],
              boardId: boardId
            };

            const updatedLists = [...oldBoard.lists, newList];

            return {
              ...oldBoard,
              lists: updatedLists
            };
          });

          // Update layout immediately
          setBoardLayout(prev => {
            const newLayout = [...prev, { listId, cardIds: [] }];

            // Trigger board update with new layout
            updateBoardWithLayout(newLayout);
            return newLayout;
          });
        },
        onError: (error) => {
          console.error('Failed to create list:', error);
          // Clear add list UI on error too
          setNewListTitle('');
          setShowAddListInput(false);
        }
      });
      } catch (error) {
        console.error('Failed to create list:', error);
      }
    }
  };


  const handleAddComment = () => {
    if (!newComment.trim() || !selectedCard || !user || !boardId) return;

    setIsSubmittingComment(true);

    // Find the card creator from board data (cards are created by board owner or org members)
    // For now, we'll use the board owner as the card creator since we don't track individual card creators
    const cardCreator = user.pubkey; // TODO: This should be the actual card creator if we track that

    // Create a comment event (kind 1111) that references the card
    const commentEvent = {
      kind: 1111, // NIP-22 comment kind
      content: newComment.trim(),
      tags: [
        // Root scope (uppercase) - the card being commented on
        ['E', selectedCard.card.id], // Reference to the card event ID
        ['K', '36175'], // Kind of the root event being commented on
        ['P', cardCreator], // Author of the root event (card creator)

        // Parent scope (lowercase) - same as root for top-level comments
        ['e', selectedCard.card.id], // Reference to the parent event (same as root for top-level)
        ['k', '36175'], // Kind of the parent event
        ['p', cardCreator], // Author of the parent event (card creator, not commenter)

        ['alt', `Comment on card: ${selectedCard.card.title}`] // NIP-31 alt tag
      ]
    };

    // Optimistically add the comment to the UI immediately
    const optimisticComment = {
      id: `temp-${Date.now()}`, // Temporary ID
      kind: 1111,
      pubkey: user.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      content: newComment.trim(),
      tags: commentEvent.tags,
      sig: ''
    };

    // Add to cache immediately for instant feedback
    queryClient.setQueryData(['card-comments', selectedCard.card.id], (oldComments: Comment[] | undefined) => {
      return [...(oldComments || []), optimisticComment];
    });

    // Clear input immediately
    setNewComment('');

    publishEvent(commentEvent, {
      onSuccess: (data) => {
        console.log('Comment posted successfully:', data);
        console.log('Comment event data:', {
          id: data.id,
          pubkey: data.pubkey,
          content: data.content,
          created_at: data.created_at
        });
        setIsSubmittingComment(false);

        // Replace the optimistic comment with the real one
        queryClient.setQueryData(['card-comments', selectedCard.card.id], (oldComments: Comment[] | undefined) => {
          const updatedComments = (oldComments || []).map(comment => {
            if (comment.id === optimisticComment.id) {
              console.log('Replacing optimistic comment with real comment:', data);
              return { ...data } as Comment;
            }
            return comment;
          });
          console.log('Updated card comments:', updatedComments);
          return updatedComments;
        });

        // Also refresh board comments for activity panel
        queryClient.invalidateQueries({ queryKey: ['board-comments', boardId] });
      },
      onError: (error) => {
        console.error('Failed to post comment:', error);
        setIsSubmittingComment(false);
        // Remove the optimistic comment on error
        queryClient.setQueryData(['card-comments', selectedCard.card.id], (oldComments: Comment[] | undefined) => {
          return (oldComments || []).filter(comment => comment.id !== optimisticComment.id);
        });
      }
    });
  };

  const handleUpdateListTitle = (listDtag: string, newTitle: string) => {
    if (!board || !user || !boardId) return;

    const list = board.lists.find(l => l.dTag === listDtag);
    if (!list || list.title === newTitle) {
      setEditingListId(null);
      setEditedListTitle('');
      return;
    }

    // Start saving state for the list
    startListSaving(listDtag);

    const listEvent = {
      kind: 36174,
      content: '',
      tags: [
        ['d', listDtag],
        ['title', newTitle],
        ['a', `36173:${user.pubkey}:${boardId}`]
      ]
    };

    setEditingListId(null);
    setEditedListTitle('');

    publishEvent(listEvent, {
      onSuccess: (data) => {
        console.log('List title updated successfully:', data);
        stopListSaving(listDtag);
        queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === listDtag) {
              return {
                ...list,
                title: newTitle
              };
            }
            return list;
          });

          return {
            ...oldBoard,
            lists: updatedLists
          };
        });
      },
      onError: (error) => {
        console.error('Failed to update list title:', error);
        stopListSaving(listDtag);
        setEditingListId(listDtag);
        setEditedListTitle(newTitle);
      }
    });
  };

  // The handleDragEnd function - UI updates instantly from local state
  const handleDragEnd = (result: DropResult) => {
    const { destination, source, type } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return;

    if (!board || !user || !boardId) return;

    // Create new layout based on drag operation
    const newLayout = [...boardLayout];

    if (type === 'LIST') {
      // Reordering lists
      const [movedList] = newLayout.splice(source.index, 1);
      newLayout.splice(destination.index, 0, movedList);
    } else {
      // Moving cards
      const sourceListIndex = newLayout.findIndex(item => item.listId === source.droppableId);
      const destListIndex = newLayout.findIndex(item => item.listId === destination.droppableId);

      if (sourceListIndex === -1 || destListIndex === -1) return;

      const sourceList = { ...newLayout[sourceListIndex] };
      const destList = sourceListIndex === destListIndex ? sourceList : { ...newLayout[destListIndex] };

      // Remove card from source
      const [movedCardId] = sourceList.cardIds.splice(source.index, 1);

      // Start saving state for the moved card (for all moves, not just cross-list)
      startCardSaving(movedCardId);

      // Add card to destination
      if (sourceListIndex === destListIndex) {
        // Moving within the same list
        sourceList.cardIds.splice(destination.index, 0, movedCardId);
        newLayout[sourceListIndex] = sourceList;
      } else {
        // Moving to different list
        destList.cardIds.splice(destination.index, 0, movedCardId);
        newLayout[sourceListIndex] = sourceList;
        newLayout[destListIndex] = destList;
      }
    }

    // Update local state immediately for instant UI update
    setBoardLayout(newLayout);

    // If moving a card to a different list, update the card's list property
    if (type !== 'LIST') {
      const sourceListId = source.droppableId;
      const destListId = destination.droppableId;
      const movedCardId = newLayout.find(item => item.listId === destListId)?.cardIds[destination.index];

      if (sourceListId !== destListId) {
        // Find the moved card
        const sourceList = board.lists.find(l => l.dTag === sourceListId);
        const movedCard = sourceList?.cards.find(c => c.dTag === movedCardId);

        if (movedCard && movedCardId) {
          // Update the card's list property in the board data
          queryClient.setQueryData(['board', boardId!], (oldBoard: Board | undefined) => {
            if (!oldBoard) return oldBoard;

            return {
              ...oldBoard,
              lists: oldBoard.lists.map(list => {
                if (list.dTag === sourceListId) {
                  // Remove card from source list
                  return {
                    ...list,
                    cards: list.cards.filter(c => c.dTag !== movedCardId)
                  };
                } else if (list.dTag === destListId) {
                  // Add card to destination list with updated listId
                  return {
                    ...list,
                    cards: [...list.cards, { ...movedCard, listId: destListId }]
                  };
                }
                return list;
              })
            };
          });

          // Publish updated card event with new list
          const cardEvent = {
            kind: 36175,
            content: '',
            tags: [
              ['d', movedCard.dTag],
              ['title', movedCard.title],
              ['description', movedCard.description || ''],
              ['list', destListId], // Updated list
              ['a', `36173:${user.pubkey}:${boardId}`],
              ...movedCard.assignees.map(pubkey => ['p', pubkey])
            ]
          };

          publishEvent(cardEvent, {
            onSuccess: () => {
              console.log('Card moved successfully');
              stopCardSaving(movedCardId);
            },
            onError: (error) => {
              console.error('Failed to move card:', error);
              stopCardSaving(movedCardId);
            }
          });
        }
      } else {
        // Moving within the same list - only update layout, stop saving when board update completes
        // The board update will handle the saving state via updateBoardWithLayout
      }
    }

    // Trigger board update (this will handle saving state appropriately)
    // Pass the moved card ID if it's a same-list move so we can stop its saving state when done
    const cardIdForSameLisMove = (type !== 'LIST' && source.droppableId === destination.droppableId) ?
      newLayout.find(item => item.listId === destination.droppableId)?.cardIds[destination.index] :
      undefined;
    updateBoardWithLayout(newLayout, cardIdForSameLisMove);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Loading board...</p>
        </div>
      </div>
    );
  }

  if (isError || !board) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">❌</div>
          <h1 className="text-2xl font-bold mb-2">Board Not Found</h1>
          <p className="text-muted-foreground mb-4">The board you're looking for doesn't exist or is unavailable.</p>
          <Button onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Board Header */}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="flex items-center justify-between p-4">
          <div>
            {isEditingBoardName ? (
              <input
                type="text"
                value={editedBoardName}
                onChange={(e) => setEditedBoardName(e.target.value)}
                onBlur={() => {
                  if (editedBoardName.trim() && editedBoardName !== board.name) {
                    handleUpdateBoardName();
                  }
                  setIsEditingBoardName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (editedBoardName.trim() && editedBoardName !== board.name) {
                      handleUpdateBoardName();
                    }
                    setIsEditingBoardName(false);
                  } else if (e.key === 'Escape') {
                    setEditedBoardName(board.name);
                    setIsEditingBoardName(false);
                  }
                }}
                autoFocus
                className="text-xl font-bold bg-transparent border-b border-primary outline-none w-auto min-w-[200px]"
                style={{ width: `${Math.max(200, editedBoardName.length * 12)}px` }}
              />
            ) : (
              <h1
                className="text-xl font-bold cursor-text hover:bg-muted p-1 rounded inline-block"
                onClick={() => {
                  setIsEditingBoardName(true);
                  setEditedBoardName(board.name);
                }}
              >
                {board.name}
              </h1>
            )}
            {board.description && (
              <p className="text-sm text-muted-foreground mt-1">{board.description}</p>
            )}
            <div className="flex items-center text-sm text-muted-foreground mt-1">
              <Users className="h-4 w-4 mr-1" />
              <span>{(() => {
                // Calculate unique assigned users across all cards
                const uniqueAssignees = new Set();
                board.lists.forEach(list => {
                  list.cards.forEach(card => {
                    card.assignees.forEach(assignee => {
                      uniqueAssignees.add(assignee);
                    });
                  });
                });
                const count = uniqueAssignees.size;
                return count === 1 ? '1 assigned user' : `${count} assigned users`;
              })()}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Subscription status indicator */}
            {subscriptionError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <div className="h-2 w-2 rounded-full bg-destructive"></div>
                <span>Disconnected</span>
              </div>
            ) : isSubscribed ? (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <div className="h-2 w-2 rounded-full bg-green-600"></div>
                <span>Live</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse"></div>
                <span>Connecting...</span>
              </div>
            )}

            {/* Saving indicator */}
            {isSaving && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                <span>Saving...</span>
              </div>
            )}

            {/* Assignee Filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by assignee" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cards</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {organizationMembers.map((member) => (
                    <SelectItem key={member.pubkey} value={member.pubkey}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={member.picture} />
                          <AvatarFallback className="text-xs">
                            {member.name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{member.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setIsActivityPanelOpen(!isActivityPanelOpen)}
            >
              {isActivityPanelOpen ? 'Hide Activity' : 'Show Activity'}
            </Button>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="p-4 overflow-x-auto relative h-[calc(100vh-136px)]">
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="board" direction="horizontal" type="LIST">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="flex gap-4 min-w-max relative"
              >
                {/* Render lists according to layout */}
                {boardLayout.map((layoutItem, index) => {
                  const list = board.lists.find(l => l.dTag === layoutItem.listId);
                  if (!list) return null;

                  return (
                    <Draggable key={list.dTag} draggableId={list.dTag} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`relative transition-opacity ${savingLists.has(list.dTag) ? 'opacity-50' : 'opacity-100'} ${snapshot.isDragging ? 'cursor-grabbing' : 'cursor-move'}`}
                        >
                          <Card className={`w-72 flex-shrink-0 ${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20' : ''}`}>
                            <CardHeader
                              className="pb-1 pt-3 px-3"
                            >
                              <CardTitle className="text-base font-semibold">
                                {editingListId === list.dTag ? (
                                  <Input
                                    value={editedListTitle}
                                    onChange={(e) => setEditedListTitle(e.target.value)}
                                    onBlur={() => {
                                      if (editingListId === list.dTag) {
                                        if (editedListTitle.trim() && editedListTitle !== list.title) {
                                          handleUpdateListTitle(list.dTag, editedListTitle.trim());
                                        } else {
                                          setEditingListId(null);
                                          setEditedListTitle('');
                                        }
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (editingListId === list.dTag) {
                                          if (editedListTitle.trim() && editedListTitle !== list.title) {
                                            handleUpdateListTitle(list.dTag, editedListTitle.trim());
                                          } else {
                                            setEditingListId(null);
                                            setEditedListTitle('');
                                          }
                                        }
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setEditingListId(null);
                                        setEditedListTitle('');
                                      }
                                    }}
                                    className="h-6 px-1 text-base font-semibold"
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    className="cursor-text hover:bg-muted px-1 rounded"
                                    onClick={() => {
                                      setEditingListId(list.dTag);
                                      setEditedListTitle(list.title);
                                    }}
                                  >
                                    {list.title}
                                  </span>
                                )}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="py-1 px-3">
                              <Droppable droppableId={list.dTag} type="CARD">
                                {(provided) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className="space-y-2"
                                  >
                                    {/* Render cards according to layout */}
                                    {layoutItem.cardIds.map((cardId, cardIndex) => {
                                      const card = list.cards.find(c => c.dTag === cardId);
                                      if (!card) return null;

                                      // Apply assignee filter
                                      const filteredCards = filterCardsByAssignee([card]);
                                      if (filteredCards.length === 0) return null;

                                      return (
                                        <Draggable key={card.dTag} draggableId={card.dTag} index={cardIndex}>
                                          {(provided, snapshot) => (
                                            <div
                                              ref={provided.innerRef}
                                              {...provided.draggableProps}
                                              {...provided.dragHandleProps}
                                              className={`mb-2 transition-opacity ${savingCards.has(card.dTag) ? 'opacity-50' : 'opacity-100'} ${snapshot.isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
                                              onClick={() => {
                                                setSelectedCard({card, list});
                                                setEditedTitle(card.title);
                                                setEditedDescription(card.description || '');
                                                setIsCardModalOpen(true);
                                              }}
                                            >
                                              <Card className={`hover:shadow-sm transition-shadow ${snapshot.isDragging ? 'shadow-lg ring-2 ring-primary/20' : ''}`}>
                                                <CardContent className="p-2">
                                                  <div className="flex-1">
                                                    <h3 className="font-medium text-sm mb-1">{card.title}</h3>
                                                    {card.description && (
                                                      <p className="text-xs text-muted-foreground line-clamp-2">
                                                        {card.description}
                                                      </p>
                                                    )}
                                                    {card.assignees.length > 0 && (
                                                      <div className="flex -space-x-1 mt-2">
                                                        {card.assignees.slice(0, 3).map((assigneePubkey) => {
                                                          const member = organizationMembers.find(m => m.pubkey === assigneePubkey);
                                                          return (
                                                            <Avatar key={assigneePubkey} className="h-5 w-5 border border-background">
                                                              <AvatarImage src={member?.picture} />
                                                              <AvatarFallback className="text-xs">
                                                                {member?.name?.charAt(0) || 'U'}
                                                              </AvatarFallback>
                                                            </Avatar>
                                                          );
                                                        })}
                                                        {card.assignees.length > 3 && (
                                                          <Avatar className="h-5 w-5 border border-background">
                                                            <AvatarFallback className="text-xs">
                                                              +{card.assignees.length - 3}
                                                            </AvatarFallback>
                                                          </Avatar>
                                                          )}
                                                        </div>
                                                      )}
                                                    </div>
                                                  </CardContent>
                                                </Card>
                                              </div>
                                          )}
                                        </Draggable>
                                      );
                                    })}
                                    {provided.placeholder}

                                    {activeListId === list.dTag ? (
                                      <div className="space-y-2">
                                        <Input
                                          placeholder="Enter card title..."
                                          value={newCardTitle}
                                          onChange={(e) => setNewCardTitle(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleAddCard(list.dTag);
                                            if (e.key === 'Escape') {
                                              setIsAddingCard(false);
                                              setActiveListId(null);
                                              setNewCardTitle('');
                                            }
                                          }}
                                          onBlur={() => {
                                            setIsAddingCard(false);
                                            setActiveListId(null);
                                            setNewCardTitle('');
                                          }}
                                          autoFocus
                                          className="text-sm"
                                        />
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            onClick={() => handleAddCard(list.dTag)}
                                            disabled={!newCardTitle.trim() || !user}
                                            className="text-sm px-3"
                                          >
                                            Add Card
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                              setActiveListId(null);
                                              setNewCardTitle('');
                                            }}
                                            className="text-sm px-3"
                                          >
                                            Cancel
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full justify-start text-muted-foreground hover:text-foreground text-xs"
                                        onClick={() => {
                                          setActiveListId(list.dTag);
                                          setIsAddingCard(true);
                                        }}
                                        disabled={!user}
                                      >
                                        <Plus className="h-3 w-3 mr-2" />
                                        Add a card
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </Droppable>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}

                {/* Add new list */}
                <div className="w-72 flex-shrink-0">
                  <Card className="bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                    <CardContent className="p-4">
                      {showAddListInput ? (
                        <div className="space-y-2">
                          <Input
                            placeholder="Enter list title..."
                            value={newListTitle}
                            onChange={(e) => setNewListTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddList();
                              if (e.key === 'Escape') {
                                setShowAddListInput(false);
                                setNewListTitle('');
                              }
                            }}
                            onBlur={() => {
                              setShowAddListInput(false);
                              setNewListTitle('');
                            }}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={handleAddList}
                              disabled={!newListTitle.trim() || !user}
                            >
                              Add List
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setShowAddListInput(false);
                                setNewListTitle('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="flex items-center cursor-pointer"
                          onClick={() => {
                            setShowAddListInput(true);
                            setNewListTitle('');
                          }}
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          <span className="font-medium">Add another list</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Activity Panel - Fixed to viewport right edge */}
        <div
          className={`
            fixed
            top-[146px]
            right-0
            h-[calc(100vh-146px)]
            bg-background
            border-l
            shadow-lg
            transition-all
            duration-300
            z-20
            ${isActivityPanelOpen ? 'w-96' : 'w-8'}
            overflow-hidden
          `}
        >
          {/* Narrow panel content when closed */}
          {!isActivityPanelOpen && (
            <div className="h-full flex flex-col items-center pt-4">
              <button
                onClick={() => setIsActivityPanelOpen(true)}
                className="flex flex-col items-center hover:bg-muted rounded p-2 transition-colors"
              >
                <Clock className="h-4 w-4 text-muted-foreground mb-2" />
                <div className="flex flex-col gap-1">
                  {[...archivedCards, ...deletedCards].slice(0, 3).map((_, index) => (
                    <div key={index} className="w-1 h-1 bg-muted-foreground rounded-full" />
                  ))}
                </div>
              </button>
            </div>
          )}

          {/* Full panel content when open */}
          {isActivityPanelOpen && (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b bg-header">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  <h2 className="text-xl font-bold">Activity</h2>
                </div>
              </div>
              <div className="flex-1 p-4 overflow-y-auto">
                {archivedCards.length === 0 && deletedCards.length === 0 && recentComments.length === 0 ? (
                  <div className="text-center text-muted-foreground">
                    <p>No activity yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Combine and sort all activity */}
                    {[
                      ...archivedCards.map(card => ({...card, action: 'archived' as const, timestamp: card.updatedAt || 0})),
                      ...deletedCards.map(card => ({...card, action: 'deleted' as const, timestamp: card.updatedAt || 0})),
                      ...recentComments.map(comment => ({...comment, action: 'commented' as const, timestamp: comment.created_at}))
                    ]
                      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                      .slice(0, 30) // Limit to 30 most recent items
                      .map((item) => (
                      <Card key={`${item.action}-${item.id}${'dTag' in item ? `-${item.dTag}` : ''}`} className={`hover:shadow-sm transition-all ${'dTag' in item && savingCards.has(item.dTag) ? 'opacity-50' : 'opacity-100'}`}>
                        <CardContent className="p-3">
                          <div className="flex justify-between items-start">
                            <div className="flex items-start gap-2">
                              {item.action === 'archived' ? (
                                <Archive className="h-4 w-4 text-blue-500 mt-0.5" />
                              ) : item.action === 'deleted' ? (
                                <Trash2 className="h-4 w-4 text-red-500 mt-0.5" />
                              ) : (
                                <MessageSquare className="h-4 w-4 text-green-500 mt-0.5" />
                              )}
                              <div>
                                {item.action === 'commented' ? (
                                  <>
                                    <div className="flex items-center gap-2 mb-1">
                                      <Avatar className="h-5 w-5">
                                        <AvatarImage src={organizationMembers.find(m => m.pubkey === item.pubkey)?.picture} />
                                        <AvatarFallback className="text-xs">
                                          {organizationMembers.find(m => m.pubkey === item.pubkey)?.name?.charAt(0) || item.pubkey.charAt(0)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <span className="font-medium text-sm">
                                        {organizationMembers.find(m => m.pubkey === item.pubkey)?.name || `User ${item.pubkey.slice(0, 8)}...`}
                                      </span>
                                      <span className="text-xs text-muted-foreground">commented</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                                      "{item.content}"
                                    </p>
                                    <div className="text-xs text-muted-foreground">
                                      {(() => {
                                        // Find which card was commented on
                                        const cardId = item.tags.find(tag => tag[0] === 'e')?.[1];
                                        const card = board?.lists.flatMap(l => l.cards).find(c => c.id === cardId);
                                        return card ? `on "${card.title}"` : 'on a card';
                                      })()}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <h3 className="font-medium text-sm mb-1">{item.title}</h3>
                                    {item.description && (
                                      <p className="text-xs text-muted-foreground line-clamp-2">
                                        {item.description}
                                      </p>
                                    )}
                                  </>
                                )}
                                <div className="text-xs text-muted-foreground mt-2">
                                  {item.action === 'commented' ? 'Commented' : item.action === 'archived' ? 'Archived' : 'Deleted'} {new Date((item.timestamp || 0) * 1000).toLocaleDateString()} at {new Date((item.timestamp || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                            {item.action === 'archived' && 'dTag' in item && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => handleRestoreCard(item)}
                                disabled={savingCards.has(item.dTag)}
                              >
                                {savingCards.has(item.dTag) ? 'Restoring...' : 'Restore'}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Toggle handle */}
          <div
            className={`
              absolute
              top-8
              -left-6
              w-6
              h-12
              bg-background
              border
              border-r-0
              rounded-l-md
              flex
              items-center
              justify-center
              cursor-pointer
              shadow-md
              hover:bg-muted
              transition-all
              duration-300
              z-30
            `}
            onClick={() => setIsActivityPanelOpen(!isActivityPanelOpen)}
          >
            {isActivityPanelOpen ? (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Card Detail Modal */}
      <Dialog open={isCardModalOpen} onOpenChange={(open) => {
        setIsCardModalOpen(open);
        if (!open) {
          setIsEditingTitle(false);
          setSelectedCard(null);
          setEditedTitle('');
          setEditedDescription('');
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedCard && (
            <>
              <DialogHeader>
                <DialogTitle className="sr-only">
                  {selectedCard.card.title}
                </DialogTitle>
                {isEditingTitle ? (
                  <Input
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onBlur={() => {
                      if (editedTitle.trim() && editedTitle !== selectedCard.card.title) {
                        handleUpdateCardTitle();
                      }
                      setIsEditingTitle(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editedTitle.trim() && editedTitle !== selectedCard.card.title) {
                          handleUpdateCardTitle();
                        }
                        setIsEditingTitle(false);
                      } else if (e.key === 'Escape') {
                        setEditedTitle(selectedCard.card.title);
                        setIsEditingTitle(false);
                      }
                    }}
                    autoFocus
                    className="text-lg font-semibold"
                  />
                ) : (
                  <div
                    className="cursor-text hover:bg-muted p-1 rounded text-lg font-semibold"
                    onClick={() => {
                      setIsEditingTitle(true);
                      setEditedTitle(selectedCard.card.title);
                    }}
                  >
                    {selectedCard.card.title}
                  </div>
                )}
              </DialogHeader>

              {/* Two column layout */}
              <div className="flex gap-4">
                {/* Left column - Description and Comments (flexible width) */}
                <div className="flex-1 space-y-6">
                  {/* Description Section */}
                  <div>
                    <h3 className="font-medium mb-2">
                      Description
                    </h3>
                    <Textarea
                      value={editedDescription}
                      onChange={(e) => {
                        setEditedDescription(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (selectedCard && !savingCards.has(selectedCard.card.dTag)) {
                            handleUpdateCardDescription();
                          }
                        }
                        if (e.key === 'Escape') {
                          setEditedDescription(selectedCard.card.description || '');
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={() => {
                        if (selectedCard && !savingCards.has(selectedCard.card.dTag) && editedDescription !== (selectedCard.card.description || '')) {
                          handleUpdateCardDescription();
                        }
                      }}
                      rows={4}
                      className="w-full resize-none"
                      placeholder="Add a description..."
                      disabled={selectedCard ? savingCards.has(selectedCard.card.dTag) : false}
                    />
                    <div className="flex justify-between items-center mt-1">
                      <p className="text-xs text-muted-foreground">
                        Press Enter to save, Shift+Enter for new line
                      </p>
                      {selectedCard && savingCards.has(selectedCard.card.dTag) && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"></div>
                          <span>Saving...</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Comments Section */}
                  <div>
                    <h3 className="font-medium mb-2">Comments</h3>

                    <div className="space-y-3">
                      {/* Existing comments */}
                      {cardComments.length > 0 ? (
                        cardComments.map((comment) => (
                          <div key={comment.id} className="flex gap-2">
                            <Avatar className="h-6 w-6 flex-shrink-0">
                              <AvatarImage src={organizationMembers.find(m => m.pubkey === comment.pubkey)?.picture} />
                              <AvatarFallback className="text-xs">
                                {organizationMembers.find(m => m.pubkey === comment.pubkey)?.name?.charAt(0) || comment.pubkey.charAt(0)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">
                                  {organizationMembers.find(m => m.pubkey === comment.pubkey)?.name || `User ${comment.pubkey.slice(0, 8)}...`}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(comment.created_at * 1000).toLocaleDateString()} at {new Date(comment.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{comment.content}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No comments yet
                        </div>
                      )}

                      {/* Add comment input */}
                      <div className="flex gap-2">
                        <Avatar className="h-6 w-6 flex-shrink-0">
                          <AvatarImage src={metadata?.picture} />
                          <AvatarFallback className="text-xs">
                            {metadata?.name?.charAt(0) || user?.pubkey?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <Input
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAddComment();
                            }
                          }}
                          placeholder="Add a comment..."
                          className="text-sm"
                          disabled={isSubmittingComment || !user}
                        />
                        {isSubmittingComment && (
                          <div className="flex items-center">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right column - Assignees and Actions (fixed width) */}
                <div className="w-48 space-y-6">
                  {/* Assignees Section */}
                  <div>
                    <h3 className="font-medium mb-2">Assignees</h3>

                    {/* Current Assignees */}
                    <div className="space-y-2 mb-3">
                      {selectedCard.card.assignees.map((assigneePubkey) => {
                        const member = organizationMembers.find(m => m.pubkey === assigneePubkey);
                        return (
                          <div key={assigneePubkey} className="flex items-center gap-2 group">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={member?.picture} />
                              <AvatarFallback className="text-xs">
                                {member?.name?.charAt(0) || 'U'}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm flex-1">{member?.name || 'Unknown'}</span>
                            <button
                              onClick={() => {
                                const newAssignees = selectedCard.card.assignees.filter(id => id !== assigneePubkey);
                                handleUpdateCardAssignees(newAssignees);
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center transition-opacity"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                      {selectedCard.card.assignees.length === 0 && (
                        <span className="text-sm text-muted-foreground">No assignees</span>
                      )}
                    </div>

                    {/* Add Assignee */}
                    <Select
                      value="add-member"
                      onValueChange={(pubkey) => {
                        if (pubkey !== "add-member" && pubkey && !selectedCard.card.assignees.includes(pubkey)) {
                          const newAssignees = [...selectedCard.card.assignees, pubkey];
                          handleUpdateCardAssignees(newAssignees);
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <div className="flex items-center gap-2">
                          <UserPlus className="h-4 w-4" />
                          <span>Add assignee</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="add-member" disabled>
                          Select a member to assign
                        </SelectItem>
                        {organizationMembers
                          .filter(member => !selectedCard.card.assignees.includes(member.pubkey))
                          .map((member) => (
                          <SelectItem key={member.pubkey} value={member.pubkey}>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-5 w-5">
                                <AvatarImage src={member.picture} />
                                <AvatarFallback className="text-xs">
                                  {member?.name?.charAt(0) || 'U'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm">{member.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Actions Section */}
                  <div>
                    <h3 className="font-medium mb-2">Actions</h3>
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={handleArchiveCard}
                      >
                        <Archive className="h-4 w-4 mr-2" />
                        Archive
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-destructive hover:text-destructive"
                        onClick={handleDeleteCard}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </div>


            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default BoardPage;