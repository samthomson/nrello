import { useNostr } from "@nostrify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";
import { useNostrPublish } from "./useNostrPublish";

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

export function useOrganizations(startSavingOperation: () => void, completeSavingOperation: () => void) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const { mutate: publishEvent } = useNostrPublish();

  // Fetch organizations from Nostr
  const { data: organizations = [], isLoading, isError } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      if (!user) return [];

      try {
        // Query for organization events (kind 36963) where user is either:
        // 1. The author/creator (authors filter)
        // 2. A member (p tags filter)
        const [ownedOrgs, memberOrgs] = await Promise.all([
          // Organizations where user is the owner
          nostr.query([
            {
              kinds: [36963],
              authors: [user.pubkey],
              limit: 50
            }
          ], {
            signal: AbortSignal.any([
              AbortSignal.timeout(5000)
            ])
          }),
          // Organizations where user is a member (tagged in p tags)
          nostr.query([
            {
              kinds: [36963],
              '#p': [user.pubkey],
              limit: 50
            }
          ], {
            signal: AbortSignal.any([
              AbortSignal.timeout(5000)
            ])
          })
        ]);

        // Combine and deduplicate organizations
        const allOrgEvents = [...ownedOrgs, ...memberOrgs];
        const uniqueEvents = allOrgEvents.filter((event, index, array) =>
          array.findIndex(e => e.id === event.id) === index
        );

        // Transform events into organization objects
        return uniqueEvents.map(event => {
          // Extract tags
          const nameTag = event.tags.find(tag => tag[0] === 'name');
          const memberTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);

          // Use event.created_at for timestamps (no JSON content needed)
          return {
            id: event.id,
            dTag: event.tags.find(tag => tag[0] === 'd')?.[1] || event.id,
            name: nameTag?.[1] || 'Untitled Organization',
            members: memberTags,
            createdAt: event.created_at,
            updatedAt: event.created_at,
            isOwner: event.pubkey === user.pubkey,
            pubkey: event.pubkey,
          };
        });
      } catch (error) {
        console.error('Failed to fetch organizations:', error);
        return [];
      }
    },
    enabled: !!user
  });

  const createOrganization = (name: string, members: string[] = [], onCreated?: (orgId: string) => void) => {
    if (!user) return;

    // Start saving operation
    startSavingOperation();

    // Generate a unique identifier for the organization
    const orgId = `org-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create the organization event tags
    const tags = [
      ['d', orgId],
      ['name', name]
    ];

    // Add member tags
    members.forEach(member => {
      tags.push(['p', member]);
    });

    // Create the organization event (empty content, use event.created_at for timestamps)
    const orgEvent = {
      kind: 36963,
      content: '',
      tags
    };

    // Publish the event
    publishEvent(orgEvent, {
      onSuccess: (data) => {
        console.log('Organization created successfully:', data);
        // Complete saving operation
        completeSavingOperation();
        // Invalidate the organizations query to refresh the list
        queryClient.invalidateQueries({ queryKey: ['organizations'] });
        // Call the callback with the new organization ID
        if (onCreated) {
          onCreated(orgId);
        }
      },
      onError: (error) => {
        console.error('Failed to create organization:', error);
        // Complete saving operation even on error
        completeSavingOperation();
      }
    });
  };

  const updateOrganization = (dTag: string, name: string, members: string[] = []) => {
    if (!user) return;

    // Start saving operation
    startSavingOperation();

    // Create the organization event tags
    const tags = [
      ['d', dTag],
      ['name', name]
    ];

    // Add member tags
    members.forEach(member => {
      tags.push(['p', member]);
    });

    // Create the updated organization event (empty content, use event.created_at for timestamps)
    const orgEvent = {
      kind: 36963,
      content: '',
      tags
    };

    // Publish the event
    publishEvent(orgEvent, {
      onSuccess: (data) => {
        console.log('Organization updated successfully:', data);
        // Complete saving operation
        completeSavingOperation();
        // Invalidate the organizations query to refresh the list
        queryClient.invalidateQueries({ queryKey: ['organizations'] });
      },
      onError: (error) => {
        console.error('Failed to update organization:', error);
        // Complete saving operation even on error
        completeSavingOperation();
      }
    });
  };

  return {
    organizations,
    isLoading,
    isError,
    createOrganization,
    updateOrganization
  };
}