import { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { Role } from '@prisma/client';
import { getLockoutRemaining, recordFailedLogin, clearFailedLogins } from './login-rate-limit';

// How often (seconds) a live JWT is re-checked against the DB, so that
// deactivating a user (or changing their role) takes effect mid-session
// instead of waiting out the full 24h token lifetime.
const TOKEN_REVALIDATE_SECONDS = 5 * 60;

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const lockoutSeconds = getLockoutRemaining(credentials.email);
        if (lockoutSeconds !== null) {
          throw new Error(
            `Too many failed attempts. Try again in ${Math.ceil(lockoutSeconds / 60)} minute(s).`
          );
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          select: { id: true, email: true, name: true, role: true, password: true, isActive: true, teamId: true },
        });

        if (!user || !user.isActive) {
          recordFailedLogin(credentials.email);
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          recordFailedLogin(credentials.email);
          return null;
        }

        clearFailedLogins(credentials.email);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          teamId: user.teamId ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (user) {
        const u = user as { id: string; role: Role; teamId?: string };
        token.role = u.role;
        token.id = u.id;
        token.teamId = u.teamId ?? null;
        token.lastValidated = nowSeconds;
        return token;
      }

      // Periodically re-check the user against the DB so deactivation and
      // role changes propagate to live sessions within a few minutes.
      const lastValidated = (token.lastValidated as number | undefined) ?? 0;
      if (nowSeconds - lastValidated > TOKEN_REVALIDATE_SECONDS) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { isActive: true, role: true, teamId: true },
        });

        if (!dbUser || !dbUser.isActive) {
          token.invalidated = true;
        } else {
          token.role = dbUser.role;
          token.teamId = dbUser.teamId ?? null;
          token.lastValidated = nowSeconds;
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Deactivated mid-session — return no session so getServerSession()
      // yields null and every API route responds 401.
      if (token.invalidated) return null as unknown as Session;

      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.teamId = (token.teamId as string | null | undefined) ?? null;
      }
      return session;
    },
  },
};
