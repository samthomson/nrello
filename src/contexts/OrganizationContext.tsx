import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import type { Organization } from '@/types';

interface OrganizationContextType {
  currentOrganization: string | null;
  setCurrentOrganization: (orgId: string | null) => void;
  organizations: Organization[];
  isLoading: boolean;
  isError: boolean;
  createOrganization: (name: string, members?: string[], onCreated?: (orgId: string) => void) => void;
  createAndSelectOrganization: (name: string) => void;
  updateOrganization: (dTag: string, name: string, members?: string[]) => void;
  isSaving: boolean;
  pendingOperations: number;
  startSavingOperation: () => void;
  completeSavingOperation: () => void;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();

  // State for tracking saving operations
  const [isSaving, setIsSaving] = useState(false);
  const [pendingOperations, setPendingOperations] = useState(0);

  // Helper functions to manage saving operations
  const startSavingOperation = () => {
    setPendingOperations(prev => {
      const newCount = prev + 1;
      setIsSaving(true);
      return newCount;
    });
  };

  const completeSavingOperation = () => {
    setPendingOperations(prev => {
      const newCount = prev - 1;
      if (newCount <= 0) {
        // Immediately set to 0 and false when no operations remain
        setPendingOperations(0);
        setIsSaving(false);
      }
      return Math.max(0, newCount);
    });
  };

  const { organizations, isLoading, isError, createOrganization, updateOrganization } = useOrganizations(
    startSavingOperation,
    completeSavingOperation
  );

  const createAndSelectOrganization = (name: string) => {
    if (!user) return;
    // Auto-add the creator as a member
    createOrganization(name, [user.pubkey], (orgId) => {
      // Set the newly created organization as the current one
      setCurrentOrganization(orgId);
    });
  };
  const [currentOrganization, setCurrentOrganization] = useState<string | null>(null);

  // Set the first organization as current if none is selected and organizations exist
  useEffect(() => {
    if (!currentOrganization && organizations.length > 0) {
      setCurrentOrganization(organizations[0].dTag);
    }
  }, [organizations, currentOrganization]);

  // Load current organization from localStorage on initial load
  useEffect(() => {
    const savedOrg = localStorage.getItem('currentOrganization');
    if (savedOrg) {
      setCurrentOrganization(savedOrg);
    }
  }, []);

  // Save current organization to localStorage when it changes
  useEffect(() => {
    if (currentOrganization) {
      localStorage.setItem('currentOrganization', currentOrganization);
    } else {
      localStorage.removeItem('currentOrganization');
    }
  }, [currentOrganization]);

  return (
    <OrganizationContext.Provider
      value={{
        currentOrganization,
        setCurrentOrganization,
        organizations,
        isLoading,
        isError,
        createOrganization,
        createAndSelectOrganization,
        updateOrganization,
        isSaving,
        pendingOperations,
        startSavingOperation,
        completeSavingOperation
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}