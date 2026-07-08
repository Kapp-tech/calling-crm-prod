import { Role } from '@prisma/client';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: Role;
      teamId?: string | null;
    };
  }

  interface User {
    id: string;
    role: Role;
    teamId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    teamId?: string | null;
    /** Unix seconds when the token was last checked against the DB */
    lastValidated?: number;
    /** Set when the user was deactivated mid-session — treated as logged out */
    invalidated?: boolean;
  }
}
