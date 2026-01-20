import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useOrganization } from '@/hooks/useOrganization';
import type { BoardSummary } from '@/types';

export function useBoards() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { currentOrganization } = useOrganization();

  const query = useQuery({
    queryKey: ['boards', currentOrganization],
    queryFn: async () => {
      if (!user) {
        return [];
      }

      if (!currentOrganization) {
        return [];
      }

      try {
        // Find the organization to get all potential board creators
        const orgEvents = await nostr.query([
          {
            kinds: [36963],
            '#d': [currentOrganization],
            limit: 10
          }
        ], {
          signal: AbortSignal.timeout(3000)
        });

        if (orgEvents.length === 0) {
          return [];
        }

        // Get the org event and extract all members (including owner)
        const orgEvent = orgEvents.sort((a, b) => b.created_at - a.created_at)[0];
        const orgOwner = orgEvent.pubkey;
        const memberTags = orgEvent.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
        const allOrgMembers = [orgOwner, ...memberTags];

        // Query for boards created by any organization member
        const boardQueries = allOrgMembers.map(memberPubkey => ({
          kinds: [36173],
          '#a': [`36963:${orgOwner}:${currentOrganization}`],
          authors: [memberPubkey],
          limit: 20
        }));

        // Execute all queries in parallel
        const boardResults = await Promise.all(
          boardQueries.map(query =>
            nostr.query([query], {
              signal: AbortSignal.timeout(5000)
            })
          )
        );

        // Flatten and deduplicate results
        const events = boardResults.flat();
        const uniqueEvents = events.filter((event, index, array) =>
          array.findIndex(e => e.id === event.id) === index
        );

        // Transform events into board summary objects (lightweight version without metrics)
        const boards: BoardSummary[] = uniqueEvents.map((event) => {
          const titleTag = event.tags.find(tag => tag[0] === 'title');
          const descriptionTag = event.tags.find(tag => tag[0] === 'description');
          const visibilityTag = event.tags.find(tag => tag[0] === 'visibility');
          const boardDTag = event.tags.find(tag => tag[0] === 'd')?.[1] || event.id;

          return {
            id: event.id,
            dTag: boardDTag,
            name: titleTag?.[1] || 'Untitled Board',
            description: descriptionTag?.[1] || '',
            isPublic: visibilityTag?.[1] === 'public',
            createdAt: event.created_at,
            updatedAt: event.created_at,
            // These are set to 0 for the lightweight version used in navigation
            listCount: 0,
            cardCount: 0,
            assignedMembers: 0
          };
        });

        // Sort by name for consistent ordering in dropdown
        return boards.sort((a, b) => a.name.localeCompare(b.name));
      } catch (error) {
        console.error('Failed to fetch boards:', error);
        return [];
      }
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000, // Cache for 30 seconds to avoid refetching on every navigation
  });

  return {
    boards: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

