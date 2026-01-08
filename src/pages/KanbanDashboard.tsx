import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Users, List, FileText } from 'lucide-react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useOrganization } from '@/contexts/OrganizationContext';

const KanbanDashboard = () => {
  useSeoMeta({
    title: 'nrello - dashboard',
    description: 'Manage your projects with nrello boards',
  });

  const navigate = useNavigate();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutate: publishEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { currentOrganization, organizations, isSaving, isLoading: isLoadingOrganizations, startSavingOperation, completeSavingOperation, createAndSelectOrganization } = useOrganization();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreateOrgDialogOpen, setIsCreateOrgDialogOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDescription, setNewBoardDescription] = useState('');
  const [newOrgName, setNewOrgName] = useState('');

  // Board sorting preference stored in localStorage
  const [sortBy, setSortBy] = useLocalStorage('board-sort-preference', 'updated-desc');

  // Fetch boards from Nostr
  const { data: boards = [], isLoading: isLoadingBoards } = useQuery({
    queryKey: ['boards', currentOrganization],
    queryFn: async () => {
      if (!user) {
        console.log('User not available for board query');
        return [];
      }

      if (!currentOrganization) {
        console.log('Current organization not set:', currentOrganization);
        return [];
      }

      console.log('Fetching boards for organization:', currentOrganization, 'user:', user.pubkey);

      try {
        // Find all boards that reference this organization (created by any org member)
        // We need to find the organization first to get all potential board creators
        const orgEvents = await nostr.query([
          {
            kinds: [36963],
            '#d': [currentOrganization],
            limit: 10
          }
        ], {
          signal: AbortSignal.any([
            AbortSignal.timeout(3000)
          ])
        });

        if (orgEvents.length === 0) {
          console.log('No organization found with dTag:', currentOrganization);
          return [];
        }

        // Get the org event and extract all members (including owner)
        const orgEvent = orgEvents.sort((a, b) => b.created_at - a.created_at)[0];
        const orgOwner = orgEvent.pubkey;
        const memberTags = orgEvent.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
        const allOrgMembers = [orgOwner, ...memberTags];

        console.log('Organization members (including owner):', allOrgMembers);

        // Query for boards created by any organization member
        const boardQueries = allOrgMembers.map(memberPubkey => ({
          kinds: [36173],
          '#a': [`36963:${orgOwner}:${currentOrganization}`],
          authors: [memberPubkey], // Only boards by this specific member
          limit: 20
        }));

        // Execute all queries in parallel
        const boardResults = await Promise.all(
          boardQueries.map(query =>
            nostr.query([query], {
              signal: AbortSignal.any([
                AbortSignal.timeout(5000)
              ])
            })
          )
        );

        // Flatten and deduplicate results
        const events = boardResults.flat();
        const uniqueEvents = events.filter((event, index, array) =>
          array.findIndex(e => e.id === event.id) === index
        );

        console.log('Board events found from all org members:', uniqueEvents.length, 'boards');

        console.log('Board events found:', events);

        // Transform events into board objects with detailed metrics
        const boardsWithMetrics = await Promise.all(
          uniqueEvents.map(async (event) => {
            // Extract tags
            const titleTag = event.tags.find(tag => tag[0] === 'title');
            const descriptionTag = event.tags.find(tag => tag[0] === 'description');
            const visibilityTag = event.tags.find(tag => tag[0] === 'visibility');
            const boardDTag = event.tags.find(tag => tag[0] === 'd')?.[1] || event.id;

            // Fetch lists for this board
            const listEvents = await nostr.query([
              {
                kinds: [36174],
                '#a': [`36173:${event.pubkey}:${boardDTag}`],
                limit: 100
              }
            ], {
              signal: AbortSignal.any([
                AbortSignal.timeout(3000)
              ])
            });

            // Fetch cards for this board
            const cardEvents = await nostr.query([
              {
                kinds: [36175],
                '#a': [`36173:${event.pubkey}:${boardDTag}`],
                limit: 1000
              }
            ], {
              signal: AbortSignal.any([
                AbortSignal.timeout(3000)
              ])
            });

            // Filter out deleted and archived cards
            const activeCards = cardEvents.filter(cardEvent => {
              const archivedTag = cardEvent.tags.find(tag => tag[0] === 'archived');
              const deletedTag = cardEvent.tags.find(tag => tag[0] === 'deleted');
              return archivedTag?.[1] !== 'true' && deletedTag?.[1] !== 'true';
            });

            // Calculate unique assigned members
            const uniqueAssignees = new Set();
            activeCards.forEach(cardEvent => {
              const assigneeTags = cardEvent.tags.filter(tag => tag[0] === 'p');
              assigneeTags.forEach(tag => {
                uniqueAssignees.add(tag[1]);
              });
            });

            return {
              id: event.id,
              dTag: boardDTag,
              name: titleTag?.[1] || 'Untitled Board',
              description: descriptionTag?.[1] || '',
              isPublic: visibilityTag?.[1] === 'public',
              createdAt: event.created_at,
              updatedAt: event.created_at,
              listCount: listEvents.length,
              cardCount: activeCards.length,
              assignedMembers: uniqueAssignees.size
            };
          })
        );

        return boardsWithMetrics;
      } catch (error) {
        console.error('Failed to fetch boards:', error);
        return [];
      }
    },
    enabled: !!user && !!currentOrganization
  });

  // Sort boards based on user preference
  const sortBoards = (boards: any[], sortBy: string) => {
    const sortedBoards = [...boards];

    switch (sortBy) {
      case 'updated-desc':
        return sortedBoards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      case 'name-asc':
        return sortedBoards.sort((a, b) => a.name.localeCompare(b.name));
      case 'created-desc':
        return sortedBoards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      default:
        return sortedBoards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
  };

  const filteredBoards = sortBoards(boards, sortBy);

  // Show loading state while organizations are loading or if we have a current org but boards are still loading
  if (isLoadingOrganizations || (!!currentOrganization && isLoadingBoards)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  const handleCreateBoard = async () => {
    if (newBoardName.trim() && user && currentOrganization) {
      // Start saving operation
      startSavingOperation();

      try {
        // First, find the organization owner to use correct a-tag
        const orgEvents = await nostr.query([
          {
            kinds: [36963],
            '#d': [currentOrganization],
            limit: 1
          }
        ], {
          signal: AbortSignal.timeout(3000)
        });

        if (orgEvents.length === 0) {
          console.error('Organization not found');
          completeSavingOperation();
          return;
        }

        const orgOwner = orgEvents[0].pubkey;

        // Generate a unique identifier for the board
        const boardId = `board-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Construct the a-tag using organization owner
        const aTag = `36963:${orgOwner}:${currentOrganization}`;
        console.log('Creating board with a-tag (using org owner):', aTag);

      // Create the board event (empty content, no layout tags needed for new board)
      const boardEvent = {
        kind: 36173,
        content: '',
        tags: [
          ['d', boardId],
          ['title', newBoardName],
          ['description', newBoardDescription],
          ['visibility', 'public'],
          ['a', aTag]
        ]
      };

      // Publish the event
      publishEvent(boardEvent, {
        onSuccess: (data) => {
          console.log('Board created successfully:', data);
          // Complete saving operation
          completeSavingOperation();
          // Invalidate the boards query to refresh the list
          queryClient.invalidateQueries({ queryKey: ['boards'] });
          setIsCreateDialogOpen(false);
          setNewBoardName('');
          setNewBoardDescription('');
          // Navigate to the newly created board after a short delay to allow relay propagation
          setTimeout(() => {
            navigate(`/board/${boardId}`);
          }, 500);
        },
        onError: (error) => {
          console.error('Failed to create board:', error);
          // Complete saving operation even on error
          completeSavingOperation();
        }
      });
      } catch (error) {
        console.error('Failed to create board:', error);
        // Complete saving operation even on error
        completeSavingOperation();
      }
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Projects</h1>
            <p className="text-muted-foreground mt-2">
              Manage your nrello boards and tasks
            </p>
          </div>

          <div className="flex gap-2 w-full md:w-auto items-center">
            {/* Saving indicator */}
            {isSaving && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                <span>Saving...</span>
              </div>
            )}

            {/* Sort dropdown */}
            {filteredBoards.length > 1 && (
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated-desc">Recent</SelectItem>
                  <SelectItem value="name-asc">A-Z</SelectItem>
                  <SelectItem value="created-desc">Newest</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Board
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Board</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Board Name</label>
                    <Input
                      placeholder="Enter board name"
                      value={newBoardName}
                      onChange={(e) => setNewBoardName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Description</label>
                    <Input
                      placeholder="Enter board description (optional)"
                      value={newBoardDescription}
                      onChange={(e) => setNewBoardDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setIsCreateDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateBoard}
                      disabled={!newBoardName.trim() || !user || !currentOrganization}
                    >
                      Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {filteredBoards.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBoards.map((board) => (
              <Card
                key={board.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/board/${board.dTag}`)}
              >
                <CardHeader>
                  <CardTitle className="flex justify-between items-start">
                    <span>{board.name}</span>
                    {!board.isPublic && (
                      <span className="text-xs bg-muted px-2 py-1 rounded">Private</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {board.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                      {board.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center">
                      <List className="h-4 w-4 mr-1" />
                      {board.listCount} {board.listCount === 1 ? 'list' : 'lists'}
                    </div>
                    <div className="flex items-center">
                      <FileText className="h-4 w-4 mr-1" />
                      {board.cardCount} {board.cardCount === 1 ? 'card' : 'cards'}
                    </div>
                    <div className="flex items-center">
                      <Users className="h-4 w-4 mr-1" />
                      {board.assignedMembers} assigned
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
              <div className="text-4xl">📋</div>
            </div>
            {organizations.length === 0 ? (
              <>
                <h3 className="text-lg font-medium mb-1">No organizations found</h3>
                <p className="text-muted-foreground mb-4">
                  Get started by creating your first organization
                </p>
                <Dialog open={isCreateOrgDialogOpen} onOpenChange={setIsCreateOrgDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Organization
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Organization</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">Organization Name</label>
                        <Input
                          placeholder="Enter organization name"
                          value={newOrgName}
                          onChange={(e) => setNewOrgName(e.target.value)}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setIsCreateOrgDialogOpen(false);
                            setNewOrgName('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => {
                            if (newOrgName.trim() && user) {
                              createAndSelectOrganization(newOrgName.trim());
                              setIsCreateOrgDialogOpen(false);
                              setNewOrgName('');
                            }
                          }}
                          disabled={!newOrgName.trim() || !user}
                        >
                          Create
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium mb-1">No boards found</h3>
                <p className="text-muted-foreground mb-4">
                  Get started by creating your first board
                </p>
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                  disabled={!currentOrganization}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Board
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default KanbanDashboard;