import { useNostr } from "@nostrify/react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "./useCurrentUser";

export function useFollows() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  // Fetch follows from Nostr (kind 3 - Follows event)
  const { data: follows = [], isLoading, isError } = useQuery({
    queryKey: ['follows'],
    queryFn: async () => {
      if (!user) return [];
      
      try {
        // Query for follows events (kind 3)
        const events = await nostr.query([
          { 
            kinds: [3], 
            authors: [user.pubkey],
            limit: 1 
          }
        ], { 
          signal: AbortSignal.any([
            AbortSignal.timeout(5000)
          ]) 
        });

        if (events.length === 0) {
          return [];
        }

        const followEvent = events[0];
        
        // Extract public keys from 'p' tags
        const followPubkeys = followEvent.tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1]);

        return followPubkeys;
      } catch (error) {
        console.error('Failed to fetch follows:', error);
        return [];
      }
    },
    enabled: !!user
  });

  return {
    follows,
    isLoading,
    isError
  };
}