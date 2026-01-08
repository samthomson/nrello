import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  ChevronDown,
  Pencil,
  User,
  X,
  UserPlus,
  ChevronDown as ChevronDownIcon,
  Sun,
  Moon
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LoginArea } from '@/components/auth/LoginArea';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useTheme } from '@/hooks/useTheme';
import { useFollows } from '@/hooks/useFollows';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { nip19 } from 'nostr-tools';
import type { Organization } from '@/types';

export function NavBar() {
  const { user } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const {
    currentOrganization,
    setCurrentOrganization,
    organizations,
    createAndSelectOrganization,
    isSaving,
    isLoading: isLoadingOrganizations
  } = useOrganization();

  const [isEditingOrg, setIsEditingOrg] = useState(false);
  const [editOrgName, setEditOrgName] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  const currentOrg = organizations.find(org => org.dTag === currentOrganization);

  const handleEditOrg = () => {
    if (currentOrg) {
      setEditOrgName(currentOrg.name);
      setIsEditingOrg(true);
    }
  };

  const saveOrgEdit = () => {
    // This function is now handled by the EditOrganizationForm component
  };

  const handleCreateOrg = () => {
    if (newOrgName.trim()) {
      createAndSelectOrganization(newOrgName.trim());
      setIsCreatingOrg(false);
      setNewOrgName('');
    }
  };

  return (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between h-16 px-4 w-full">
        <div className="flex items-center gap-6">
          <Link to="/" className="font-bold text-xl">
            nrello
          </Link>

          {!isLoadingOrganizations && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-1 px-2">
                    {currentOrg ? currentOrg.name : 'Select Organization'}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {[...organizations]
                    .sort((a, b) => a.createdAt - b.createdAt)
                    .map(org => (
                      <DropdownMenuItem
                        key={org.dTag}
                        onSelect={() => setCurrentOrganization(org.dTag)}
                        className={org.dTag === currentOrganization ? 'bg-muted' : ''}
                      >
                        {org.name}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setNewOrgName('');
                      setIsCreatingOrg(true);
                    }}
                  >
                    Create New Organization
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {currentOrg && user && currentOrg.members.includes(user.pubkey) && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleEditOrg}
                  className="h-6 w-6"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}


        </div>

        <div className="flex items-center gap-2">
          {/* Saving indicator */}
          {isSaving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
              <span>Saving...</span>
            </div>
          )}

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          <LoginArea className="max-w-60" />
        </div>
      </div>

      {/* Edit Organization Dialog */}
      <Dialog open={isEditingOrg} onOpenChange={setIsEditingOrg}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
          </DialogHeader>
          {currentOrg && (
            <EditOrganizationForm
              currentOrg={currentOrg}
              editOrgName={editOrgName}
              setEditOrgName={setEditOrgName}
              onSave={saveOrgEdit}
              onCancel={() => setIsEditingOrg(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Create Organization Dialog */}
      <Dialog open={isCreatingOrg} onOpenChange={setIsCreatingOrg}>
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateOrg();
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreatingOrg(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateOrg} disabled={!newOrgName.trim()}>
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EditOrganizationFormProps {
  currentOrg: Organization;
  editOrgName: string;
  setEditOrgName: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditOrganizationForm({
  currentOrg,
  editOrgName,
  setEditOrgName,
  onSave,
  onCancel
}: EditOrganizationFormProps) {
  const { updateOrganization } = useOrganization();
  const { follows } = useFollows();
  const [members, setMembers] = useState<string[]>(currentOrg?.members || []);
  const [npubInput, setNpubInput] = useState('');
  const [openPopover, setOpenPopover] = useState(false);
  const [removeMemberAlert, setRemoveMemberAlert] = useState<string | null>(null);

  // Update members when currentOrg changes
  useEffect(() => {
    if (currentOrg) {
      setMembers(currentOrg.members || []);
    }
  }, [currentOrg]);

  const isValidNpub = (input: string) => {
    if (!input.startsWith('npub1') || input.length <= 5) {
      return false;
    }

    try {
      const decoded = nip19.decode(input);
      return decoded.type === 'npub';
    } catch {
      return false;
    }
  };

  const extractPubkeyFromNpub = (npub: string) => {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
      return null;
    } catch {
      return null;
    }
  };

  const handleAddMember = (pubkey: string) => {
    if (pubkey && !members.includes(pubkey)) {
      setMembers([...members, pubkey]);
    }
    setNpubInput('');
    setOpenPopover(false);
  };

  const handleRemoveMember = (pubkey: string) => {
    setMembers(members.filter(member => member !== pubkey));
    setRemoveMemberAlert(null);
  };

  const handleSave = () => {
    if (currentOrg) {
      // Update the organization with the new name and members
      updateOrganization(currentOrg.dTag, editOrgName.trim(), members);
      onSave();
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="org-name">Organization Name</Label>
          <Input
            id="org-name"
            value={editOrgName}
            onChange={(e) => setEditOrgName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="member-input">Add Member</Label>
          <div className="flex gap-2">
            <Popover open={openPopover} onOpenChange={setOpenPopover}>
              <PopoverTrigger asChild>
                <div className="relative flex-1">
                  <Input
                    id="member-input"
                    value={npubInput}
                    onChange={(e) => setNpubInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (npubInput && isValidNpub(npubInput)) {
                          const pubkey = extractPubkeyFromNpub(npubInput);
                          if (pubkey) {
                            handleAddMember(pubkey);
                          }
                        }
                      }
                    }}
                    placeholder="Enter npub or select from follows"
                    className="pr-10"
                  />
                  <ChevronDownIcon className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search follows or enter npub..." />
                  <CommandList>
                    <CommandEmpty>
                      {isValidNpub(npubInput) ? (
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={() => {
                            const pubkey = extractPubkeyFromNpub(npubInput);
                            if (pubkey) handleAddMember(pubkey);
                          }}
                        >
                          <UserPlus className="mr-2 h-4 w-4" />
                          Add {npubInput.substring(0, 12)}...
                        </Button>
                      ) : (
                        "No follows found."
                      )}
                    </CommandEmpty>
                    <CommandGroup heading="Your follows">
                      {follows.map((pubkey) => (
                        <FollowItem
                          key={pubkey}
                          pubkey={pubkey}
                          onSelect={handleAddMember}
                        />
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Button
              onClick={() => {
                if (npubInput && isValidNpub(npubInput)) {
                  const pubkey = extractPubkeyFromNpub(npubInput);
                  if (pubkey) handleAddMember(pubkey);
                }
              }}
              disabled={!npubInput || !isValidNpub(npubInput)}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Add Member
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Members</Label>

          {/* Members list - inline with auto-width */}
          <div className="flex flex-wrap gap-2">
            {members.map((pubkey) => (
              <MemberBadge
                key={pubkey}
                pubkey={pubkey}
                onRemove={() => setRemoveMemberAlert(pubkey)}
              />
            ))}

            {members.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">
                No members added yet
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!editOrgName.trim()}>
            Save
          </Button>
        </div>
      </div>

      {/* Remove member confirmation dialog */}
      <AlertDialog open={!!removeMemberAlert} onOpenChange={() => setRemoveMemberAlert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this member from the organization? They will lose access to organization resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeMemberAlert) handleRemoveMember(removeMemberAlert);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface MemberBadgeProps {
  pubkey: string;
  onRemove: () => void;
}

function MemberBadge({ pubkey, onRemove }: MemberBadgeProps) {
  const { data: author } = useAuthor(pubkey);

  const displayName = author?.metadata?.name || genUserName(pubkey);
  const avatar = author?.metadata?.picture;

  return (
    <div className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm">
      <Avatar className="h-5 w-5">
        <AvatarImage src={avatar} />
        <AvatarFallback className="text-xs">
          <User className="h-3 w-3" />
        </AvatarFallback>
      </Avatar>
      <span className="font-medium">{displayName}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground rounded-full"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

interface FollowItemProps {
  pubkey: string;
  onSelect: (pubkey: string) => void;
}

function FollowItem({ pubkey, onSelect }: FollowItemProps) {
  const { data: author } = useAuthor(pubkey);

  const displayName = author?.metadata?.name || genUserName(pubkey);
  const avatar = author?.metadata?.picture;

  return (
    <CommandItem
      onSelect={() => onSelect(pubkey)}
      className="cursor-pointer"
    >
      <Avatar className="mr-2 h-4 w-4">
        <AvatarImage src={avatar} />
        <AvatarFallback>
          <User className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <span>{displayName}</span>
    </CommandItem>
  );
}