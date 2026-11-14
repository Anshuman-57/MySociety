import { z } from 'zod';

export const loginRole = z.enum(['AUTO', 'VISITOR', 'ADMIN', 'SECRETARY', 'GUARD', 'RESIDENT']);
export type LoginRole = z.infer<typeof loginRole>;
export type Workspace = { role: Exclude<LoginRole, 'AUTO'>; id: string; home: string };

export function chooseWorkspace(workspaces: Workspace[], role: LoginRole): Workspace | undefined {
  return role === 'AUTO' ? workspaces[0] : workspaces.find(workspace => workspace.role === role);
}
