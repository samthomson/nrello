import { useState } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Plus,
  User,
  Lock,
  Users,
  GripVertical,
  Clock,
  Trash2,
  Archive
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useOrganization } from '@/contexts/OrganizationContext';

interface BoardMember {
  id: string;
  name: string;
  role: 'admin' | 'member';
}

interface CardItem {
  id: string;
  dTag: string;
  title: string;
  description: string;
  assignees: string[];
  listId: string;
  order: number;
}

interface ListItem {
  id: string;
  dTag: string;
  title: string;
  order: number;
  cards: CardItem[];
}

interface Board {
  id: string;
  dTag: string;
  name: string;
  members: BoardMember[];
  lists: ListItem[];
  doneCards?: CardItem[];
}

const BoardPage = () => {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { currentOrg } = useOrganization();
  const queryClient = useQueryClient();
  const { mutate: publishEvent, isPending: isPublishing } = useNostrPublish();

  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<{ card: CardItem; list: ListItem } | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pendingListCreations, setPendingListCreations] = useState<Set<string>>(new Set());
  const [changedLists, setChangedLists] = useState<Set<string>>(new Set());
  const [showActivityStream, setShowActivityStream] = useState(false);

  // Set SEO metadata
  useSeoMeta({
    title: 'Board',
    description: 'View and manage your Kanban board',
  });

  const { data: board, isLoading, isError } = useQuery({
    queryKey: ['board', boardId],
    queryFn: async ({ signal }) => {
      if (!boardId || !user) return undefined;

      // Fetch the board event
      const boardEvents = await nostr.query([
        { kinds: [36173], authors: [user.pubkey], '#d': [boardId] }
      ], { signal });

      if (!boardEvents.length) {
        throw new Error('Board not found');
      }

      const boardEvent = boardEvents[0];

      // Parse board name from title tag
      const boardName = boardEvent.tags.find(([name]) => name === 'title')?.[1] || 'Untitled Board';

      // Fetch list events for this board
      const listEvents = await nostr.query([
        { kinds: [36174], authors: [user.pubkey], '#a': [`36173:${user.pubkey}:${boardId}`] }
      ], { signal });

      // Parse lists
      const lists: ListItem[] = listEvents.map(event => {
        const dTag = event.tags.find(([name]) => name === 'd')?.[1] || '';
        const title = event.tags.find(([name]) => name === 'title')?.[1] || 'Untitled List';
        const order = parseInt(event.tags.find(([name]) => name === 'order')?.[1] || '0');

        return {
          id: event.id,
          dTag,
          title,
          order,
          cards: []
        };
      }).sort((a, b) => a.order - b.order);

      // Fetch card events for all lists
      const cardEvents = await nostr.query([
        { kinds: [36175], authors: [user.pubkey], '#a': [`36173:${user.pubkey}:${boardId}`] }
      ], { signal });

      // Parse cards and assign to lists
      const doneCards: CardItem[] = [];
      cardEvents.forEach(event => {
        const dTag = event.tags.find(([name]) => name === 'd')?.[1] || '';
        const title = event.tags.find(([name]) => name === 'title')?.[1] || 'Untitled Card';
        const listId = event.tags.find(([name]) => name === 'list')?.[1] || '';
        const order = parseInt(event.tags.find(([name]) => name === 'order')?.[1] || '0');
        const status = event.tags.find(([name]) => name === 'status')?.[1] || 'active';
        
        // Parse assignee tags
        const assignees = event.tags
          .filter(([name]) => name === 'p')
          .map(([, pubkey]) => pubkey);

        const card: CardItem = {
          id: event.id,
          dTag,
          title,
          description: event.content,
          assignees,
          listId,
          order
        };

        // Add to appropriate list or doneCards
        if (status === 'done') {
          doneCards.push(card);
        } else {
          const list = lists.find(l => l.dTag === listId);
          if (list) {
            list.cards.push(card);
          }
        }
      });

      // Sort cards within each list
      lists.forEach(list => {
        list.cards.sort((a, b) => a.order - b.order);
      });

      // Sort done cards
      doneCards.sort((a, b) => b.order - a.order);

      // Fetch board members from organization
      const members: BoardMember[] = [];
      if (currentOrg) {
        // Add organization creator as admin
        members.push({
          id: currentOrg.pubkey,
          name: 'Board Owner',
          role: 'admin'
        });

        // Add other organization members as regular members
        currentOrg.members.forEach(memberPubkey => {
          if (memberPubkey !== currentOrg.pubkey) {
            members.push({
              id: memberPubkey,
              name: 'Member',
              role: 'member'
            });
          }
        });
      }

      return {
        id: boardEvent.id,
        dTag: boardId,
        name: boardName,
        members,
        lists,
        doneCards
      };
    },
    enabled: !!boardId && !!user
  });

  const handleCreateList = () => {
    if (!user || !boardId || !newListTitle.trim()) return;

    const newListDTag = `list-${Date.now()}`;
    
    // Add to pending list to show optimistic UI
    setPendingListCreations(prev => new Set(prev).add(newListDTag));
    
    const newListEvent = {
      kind: 36174,
      content: '',
      tags: [
        ['d', newListDTag],
        ['title', newListTitle.trim()],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ['order', board?.lists.length.toString() || '0']
      ]
    };

    publishEvent(newListEvent, {
      onSuccess: (data) => {
        console.log('List created successfully:', data);
        // Remove from pending list
        setPendingListCreations(prev => {
          const newSet = new Set(prev);
          newSet.delete(newListDTag);
          return newSet;
        });
        // Invalidate board query to refetch
        queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      },
      onError: (error) => {
        console.error('Failed to create list:', error);
        // Remove from pending list on error
        setPendingListCreations(prev => {
          const newSet = new Set(prev);
          newSet.delete(newListDTag);
          return newSet;
        });
      }
    });

    setNewListTitle('');
    setIsListModalOpen(false);
  };

  const handleCreateCard = (listId: string) => {
    if (!user || !boardId) return;

    const newCardDTag = `card-${Date.now()}`;
    
    // Optimistically update the UI
    queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
      if (!oldBoard) return oldBoard;

      const updatedLists = oldBoard.lists.map(list => {
        if (list.dTag === listId) {
          return {
            ...list,
            cards: [
              ...list.cards,
              {
                id: newCardDTag, // Temporary ID
                dTag: newCardDTag,
                title: 'New Card',
                description: '',
                assignees: [],
                listId,
                order: list.cards.length
              }
            ]
          };
        }
        return list;
      });

      return {
        ...oldBoard,
        lists: updatedLists
      };
    });

    const newCardEvent = {
      kind: 36175,
      content: '',
      tags: [
        ['d', newCardDTag],
        ['title', 'New Card'],
        ['list', listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ['order', '0']
      ]
    };

    publishEvent(newCardEvent, {
      onSuccess: (data) => {
        console.log('Card created successfully:', data);
        // Update with real ID
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === listId) {
              return {
                ...list,
                cards: list.cards.map(card => 
                  card.dTag === newCardDTag ? { ...card, id: data.id } : card
                )
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
        // Remove the optimistic card
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === listId) {
              return {
                ...list,
                cards: list.cards.filter(card => card.dTag !== newCardDTag)
              };
            }
            return list;
          });

          return {
            ...oldBoard,
            lists: updatedLists
          };
        });
      }
    });
  };

  const handleDragEnd = (result: DropResult) => {
    const { destination, source, draggableId, type } = result;

    // Dropped outside the list
    if (!destination) return;

    // Dropped in the same place
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return;

    if (!board || !user || !boardId) return;

    if (type === 'list') {
      // Reordering lists
      const reorderedLists = Array.from(board.lists);
      const [movedList] = reorderedLists.splice(source.index, 1);
      reorderedLists.splice(destination.index, 0, movedList);

      // Update order tags
      const updatedLists = reorderedLists.map((list, index) => ({
        ...list,
        order: index
      }));

      // Mark lists as changed for optimistic UI
      setChangedLists(new Set(updatedLists.map(l => l.dTag)));

      // Optimistically update the UI
      queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
        if (!oldBoard) return oldBoard;
        return {
          ...oldBoard,
          lists: updatedLists
        };
      });

      // Update each list's order
      updatedLists.forEach((list, index) => {
        const listEvent = {
          kind: 36174,
          content: '',
          tags: [
            ['d', list.dTag],
            ['title', list.title],
            ['a', `36173:${user.pubkey}:${boardId}`],
            ['order', index.toString()]
          ]
        };

        publishEvent(listEvent, {
          onSuccess: () => {
            // Remove from changed lists on success
            setChangedLists(prev => {
              const newSet = new Set(prev);
              newSet.delete(list.dTag);
              return newSet;
            });
          },
          onError: (error) => {
            console.error('Failed to update list order:', error);
          }
        });
      });
    } else {
      // Moving cards between lists
      const sourceList = board.lists.find(l => l.dTag === source.droppableId);
      const destinationList = board.lists.find(l => l.dTag === destination.droppableId);

      if (!sourceList || !destinationList) return;

      if (source.droppableId === destination.droppableId) {
        // Reordering within the same list
        const reorderedCards = Array.from(sourceList.cards);
        const [movedCard] = reorderedCards.splice(source.index, 1);
        reorderedCards.splice(destination.index, 0, movedCard);

        // Update order tags
        const updatedCards = reorderedCards.map((card, index) => ({
          ...card,
          order: index
        }));

        // Optimistically update the UI
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === sourceList.dTag) {
              return {
                ...list,
                cards: updatedCards
              };
            }
            return list;
          });

          return {
            ...oldBoard,
            lists: updatedLists
          };
        });

        // Update each card's order
        updatedCards.forEach((card, index) => {
          const cardEvent = {
            kind: 36175,
            content: card.description,
            tags: [
              ['d', card.dTag],
              ['title', card.title],
              ['list', card.listId],
              ['a', `36173:${user.pubkey}:${boardId}`],
              ['order', index.toString()]
            ]
          };

          publishEvent(cardEvent, {
            onError: (error) => {
              console.error('Failed to update card order:', error);
            }
          });
        });
      } else {
        // Moving from one list to another
        const sourceCards = Array.from(sourceList.cards);
        const [movedCard] = sourceCards.splice(source.index, 1);
        const destinationCards = Array.from(destinationList.cards);
        destinationCards.splice(destination.index, 0, {
          ...movedCard,
          listId: destinationList.dTag
        });

        // Update order tags for source list
        const updatedSourceCards = sourceCards.map((card, index) => ({
          ...card,
          order: index
        }));

        // Update order tags for destination list
        const updatedDestinationCards = destinationCards.map((card, index) => ({
          ...card,
          order: index
        }));

        // Optimistically update the UI
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === sourceList.dTag) {
              return {
                ...list,
                cards: updatedSourceCards
              };
            }
            if (list.dTag === destinationList.dTag) {
              return {
                ...list,
                cards: updatedDestinationCards
              };
            }
            return list;
          });

          return {
            ...oldBoard,
            lists: updatedLists
          };
        });

        // Update moved card's list
        const movedCardEvent = {
          kind: 36175,
          content: movedCard.description,
          tags: [
            ['d', movedCard.dTag],
            ['title', movedCard.title],
            ['list', destinationList.dTag],
            ['a', `36173:${user.pubkey}:${boardId}`],
            ['order', destination.index.toString()]
          ]
        };

        publishEvent(movedCardEvent, {
          onError: (error) => {
            console.error('Failed to move card:', error);
          }
        });

        // Update source list cards' order
        updatedSourceCards.forEach((card, index) => {
          const cardEvent = {
            kind: 36175,
            content: card.description,
            tags: [
              ['d', card.dTag],
              ['title', card.title],
              ['list', card.listId],
              ['a', `36173:${user.pubkey}:${boardId}`],
              ['order', index.toString()]
            ]
          };

          publishEvent(cardEvent, {
            onError: (error) => {
              console.error('Failed to update source card order:', error);
            }
          });
        });

        // Update destination list cards' order (excluding the moved card which was already updated)
        updatedDestinationCards
          .filter(card => card.dTag !== movedCard.dTag)
          .forEach((card, index) => {
            const cardEvent = {
              kind: 36175,
              content: card.description,
              tags: [
                ['d', card.dTag],
                ['title', card.title],
                ['list', card.listId],
                ['a', `36173:${user.pubkey}:${boardId}`],
                ['order', index.toString()]
              ]
            };

            publishEvent(cardEvent, {
              onError: (error) => {
                console.error('Failed to update destination card order:', error);
              }
            });
          });
      }
    }
  };

  const handleCardClick = (card: CardItem, list: ListItem) => {
    setSelectedCard({ card, list });
    setEditedTitle(card.title);
    setEditedDescription(card.description || '');
    setIsCardModalOpen(true);
  };

  const handleUpdateCardTitle = () => {
    if (!selectedCard || !user || !boardId || !editedTitle.trim()) return;

    const updatedCardEvent = {
      kind: 36175,
      content: selectedCard.card.description || '',
      tags: [
        ['d', selectedCard.card.dTag],
        ['list', selectedCard.card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ['title', editedTitle.trim()],
        ['order', selectedCard.card.order.toString()]
      ]
    };

    // Add assignee tags if they exist
    selectedCard.card.assignees.forEach(assignee => {
      updatedCardEvent.tags.push(['p', assignee]);
    });

    setIsSaving(true);
    publishEvent(updatedCardEvent, {
      onSuccess: (data) => {
        console.log('Card title updated successfully:', data);
        setIsSaving(false);
        // Update UI
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === selectedCard.card.listId) {
              return {
                ...list,
                cards: list.cards.map(c => 
                  c.dTag === selectedCard.card.dTag 
                    ? { ...c, title: editedTitle.trim(), id: data.id } 
                    : c
                )
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
        console.error('Failed to update card title:', error);
        setIsSaving(false);
      }
    });
  };

  const handleUpdateCardDescription = () => {
    if (!selectedCard || !user || !boardId) return;

    const updatedCardEvent = {
      kind: 36175,
      content: editedDescription,
      tags: [
        ['d', selectedCard.card.dTag],
        ['list', selectedCard.card.listId],
        ['a', `36173:${user.pubkey}:${boardId}`],
        ['title', selectedCard.card.title],
        ['order', selectedCard.card.order.toString()]
      ]
    };

    // Add assignee tags if they exist
    selectedCard.card.assignees.forEach(assignee => {
      updatedCardEvent.tags.push(['p', assignee]);
    });

    setIsSaving(true);
    publishEvent(updatedCardEvent, {
      onSuccess: (data) => {
        console.log('Card description updated successfully:', data);
        setIsSaving(false);
        // Update UI
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === selectedCard.card.listId) {
              return {
                ...list,
                cards: list.cards.map(c => 
                  c.dTag === selectedCard.card.dTag 
                    ? { ...c, description: editedDescription, id: data.id } 
                    : c
                )
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
        console.error('Failed to update card description:', error);
        setIsSaving(false);
      }
    });
  };

  const handleDeleteCard = () => {
    if (!selectedCard || !user || !boardId) return;

    const deleteEvent = {
      kind: 5,
      content: 'Deleted card',
      tags: [
        ['e', selectedCard.card.id]
      ]
    };

    setIsSaving(true);
    publishEvent(deleteEvent, {
      onSuccess: () => {
        console.log('Card deleted successfully');
        setIsSaving(false);
        // Close modal
        setIsCardModalOpen(false);
        // Update UI
        queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
          if (!oldBoard) return oldBoard;

          const updatedLists = oldBoard.lists.map(list => {
            if (list.dTag === selectedCard.card.listId) {
              return {
                ...list,
                cards: list.cards.filter(c => c.dTag !== selectedCard.card.dTag)
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
        console.error('Failed to delete card:', error);
        setIsSaving(false);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-4"></div>
        <p className="text-muted-foreground">Loading board...</p>
      </div>
    );
  }

  if (isError || !board) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-4"></div>
        <h1 className="text-2xl font-bold mb-2">Board Not Found</h1>
        <p className="text-muted-foreground mb-4">The board you're looking for doesn't exist or you don't have access to it.</p>
        <Button onClick={() => navigate('/')}>Go to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="border-b p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/')}
            className="p-1 h-auto"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 19-7-7 7-7"/>
              <path d="M19 12H5"/>
            </svg>
          </Button>
          <Separator orientation="vertical" className="mx-2 h-4" />
          <h1 className="text-xl font-bold">{board.name}</h1>
          <Separator orientation="vertical" className="mx-2 h-4" />
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Private</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {isSaving && (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                <span>Saving changes...</span>
              </>
            )}
          </div>
          <div className="flex -space-x-2">
            {board.members.slice(0, 5).map((member) => (
              <Avatar key={member.id} className="border-2 border-background">
                <AvatarFallback>
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
            ))}
            {board.members.length > 5 && (
              <Avatar className="border-2 border-background">
                <AvatarFallback className="text-xs">+{board.members.length - 5}</AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex-1 overflow-x-auto">
            <div className="flex p-4 gap-4">
              <Droppable droppableId="all-lists" direction="horizontal" type="list">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="flex gap-4"
                  >
                    {board.lists.map((list, index) => (
                      <Droppable key={list.dTag} droppableId={list.dTag} type="card">
                        {(provided) => (
                          <Card 
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`w-72 flex-shrink-0 ${isSaving && (pendingListCreations.has(list.dTag) || changedLists.has(list.dTag)) ? 'opacity-60' : ''}`}
                          >
                            <CardHeader className="pb-2 pt-3 px-2">
                              <div className="flex justify-between">
                                <h2 className="font-semibold text-sm">{list.title}</h2>
                                <Button variant="ghost" size="icon" className="h-6 w-6 p-1">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="1"/>
                                    <circle cx="19" cy="12" r="1"/>
                                    <circle cx="5" cy="12" r="1"/>
                                  </svg>
                                </Button>
                              </div>
                            </CardHeader>
                            <CardContent className="py-2 px-2">
                              <div className="space-y-2">
                                {list.cards.map((card, cardIndex) => (
                                  <Draggable key={card.dTag} draggableId={card.dTag} index={cardIndex}>
                                    {(provided) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        className="mb-2 cursor-move"
                                        {...provided.dragHandleProps}
                                      >
                                        <Card className="shadow-sm hover:shadow-md transition-shadow">
                                          <CardContent className="p-3">
                                            <div className="flex items-start gap-2">
                                              <div className="flex-1">
                                                <h3 className="font-medium text-sm mb-1 line-clamp-2" onClick={() => handleCardClick(card, list)}>{card.title}</h3>
                                                {card.description && (
                                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                                    {card.description}
                                                  </p>
                                                )}
                                                <div className="flex -space-x-1 mt-2">
                                                  {card.assignees.slice(0, 3).map((assignee) => (
                                                    <Avatar key={assignee} className="border-2 border-background w-5 h-5">
                                                      <AvatarFallback className="text-[8px]">
                                                        <User className="h-2 w-2" />
                                                      </AvatarFallback>
                                                    </Avatar>
                                                  ))}
                                                  {card.assignees.length > 3 && (
                                                    <Avatar className="border-2 border-background w-5 h-5">
                                                      <AvatarFallback className="text-[8px]">+{card.assignees.length - 3}</AvatarFallback>
                                                    </Avatar>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </CardContent>
                                        </Card>
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                                <Button
                                  variant="ghost"
                                  className="w-full justify-start text-muted-foreground hover:text-foreground"
                                  onClick={() => handleCreateCard(list.dTag)}
                                >
                                  <Plus className="h-4 w-4 mr-2" />
                                  Add a card
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </Droppable>
                    ))}
                    {provided.placeholder}
                    <div className="w-72 flex-shrink-0">
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => setIsListModalOpen(true)}
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          Add another list
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Droppable>
            </div>
          </div>
        </DragDropContext>
        
        {/* Activity Stream Sidebar */}
        <div className={`${showActivityStream ? 'w-80' : 'w-10'} border-l bg-muted/30 flex flex-col transition-all duration-300 ease-in-out`} style={{ boxShadow: 'rgba(0, 0, 0, 0.05) -2px 0px 5px inset' }}>
          <div className="p-2 border-b flex justify-between items-center">
            {showActivityStream ? (
              <>
                <h2 className="text-lg font-semibold">Activity</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowActivityStream(false)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowActivityStream(true)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6"/>
                </svg>
              </Button>
            )}
          </div>
          {showActivityStream && (
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-2">
                {(board.doneCards || []).map((card) => (
                  <Card key={card.dTag} className="shadow-sm">
                    <CardContent className="p-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <h3 className="font-medium text-xs mb-1 line-clamp-2">{card.title}</h3>
                          {card.description && (
                            <p className="text-[10px] text-muted-foreground line-clamp-2">
                              {card.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{new Date(card.order * 1000).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {(!board.doneCards || board.doneCards.length === 0) && (
                  <div className="text-center py-8">
                    <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No completed cards yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add List Modal */}
      <Dialog open={isListModalOpen} onOpenChange={setIsListModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New List</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">List Title</label>
              <Input
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                placeholder="Enter list title"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsListModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateList} disabled={!newListTitle.trim()}>
                Add List
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Card Detail Modal */}
      <Dialog open={isCardModalOpen} onOpenChange={(open) => {
        setIsCardModalOpen(open);
        // Reset edit states when closing modal
        if (!open) {
          setIsEditingTitle(false);
          setIsEditingDescription(false);
          if (selectedCard) {
            setEditedTitle(selectedCard.card.title);
            setEditedDescription(selectedCard.card.description || '');
          }
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          {selectedCard && (
            <>
            <DialogHeader>
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
                />
              ) : (
                <DialogTitle
                  className="cursor-text hover:bg-muted p-1 rounded"
                  onClick={() => {
                    setIsEditingTitle(true);
                    setEditedTitle(selectedCard.card.title);
                  }}
                >
                  {selectedCard.card.title}
                </DialogTitle>
              )}
            </DialogHeader>
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <div>
                    <h3
                      className="font-medium mb-2 cursor-text hover:bg-muted p-1 rounded inline-block"
                      onClick={() => {
                        setIsEditingDescription(true);
                        setEditedDescription(selectedCard.card.description || '');
                      }}
                    >
                      Description
                    </h3>
                    {isEditingDescription ? (
                      <Textarea
                        value={editedDescription}
                        onChange={(e) => setEditedDescription(e.target.value)}
                        onBlur={() => {
                          if (editedDescription !== (selectedCard.card.description || '')) {
                            handleUpdateCardDescription();
                          }
                          setIsEditingDescription(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setEditedDescription(selectedCard.card.description || '');
                            setIsEditingDescription(false);
                          }
                        }}
                        autoFocus
                        rows={8}
                      />
                    ) : (
                      <p className="text-muted-foreground min-h-[20px]">
                        {selectedCard.card.description || 'Add a description...'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="w-32 p-4 flex flex-col gap-2 border-l">
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteCard}
                    className="w-full text-red-600 hover:text-red-800 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Card
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Archive functionality
                      if (!selectedCard || !user || !boardId) return;

                      const updatedCardEvent = {
                        kind: 36175,
                        content: selectedCard.card.description || '',
                        tags: [
                          ['d', selectedCard.card.dTag],
                          ['list', selectedCard.card.listId],
                          ['a', `36173:${user.pubkey}:${boardId}`],
                          ['title', selectedCard.card.title],
                          ['status', 'done'] // Mark as archived/completed
                        ]
                      };

                      setIsSaving(true);
                      publishEvent(updatedCardEvent, {
                        onSuccess: (data) => {
                          console.log('Card archived successfully:', data);
                          setIsSaving(false);

                          // Close the modal
                          setIsCardModalOpen(false);

                          // Remove from board
                          queryClient.setQueryData(['board', boardId], (oldBoard: Board | undefined) => {
                            if (!oldBoard) return oldBoard;

                            const updatedLists = oldBoard.lists.map(list => {
                              if (list.dTag === selectedCard.card.listId) {
                                return {
                                  ...list,
                                  cards: list.cards.filter(c => c.dTag !== selectedCard.card.dTag)
                                };
                              }
                              return list;
                            });

                            // Add to done cards
                            const updatedDoneCards = [...(oldBoard.doneCards || []), {
                              ...selectedCard.card,
                              id: data.id,
                              order: Math.floor(Date.now() / 1000)
                            }].sort((a, b) => b.order - a.order);

                            return {
                              ...oldBoard,
                              lists: updatedLists,
                              doneCards: updatedDoneCards
                            };
                          });
                        },
                        onError: (error) => {
                          console.error('Failed to archive card:', error);
                          setIsSaving(false);
                        }
                      });
                    }}
                    className="w-full text-green-600 hover:text-green-800 hover:bg-green-50"
                  >
                    <Archive className="h-4 w-4 mr-2" />
                    Archive Card
                  </Button>
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