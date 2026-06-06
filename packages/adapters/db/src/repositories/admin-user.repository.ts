import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { AdminUser } from "../schema.js";
import { adminUsers } from "../schema.js";

export type { AdminUser };

export const adminUserRepository = {
  async findByEmail(email: string): Promise<AdminUser | null> {
    const db = getDb();
    const rows = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    return rows[0] ?? null;
  },

  async findById(id: number): Promise<AdminUser | null> {
    const db = getDb();
    const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async create(data: { email: string; passwordHash: string; role?: "superadmin" | "admin" }): Promise<AdminUser> {
    const db = getDb();
    const rows = await db
      .insert(adminUsers)
      .values({ email: data.email, passwordHash: data.passwordHash, role: data.role ?? "admin" })
      .returning();
    return rows[0]!;
  },

  async updateLastLogin(id: number): Promise<void> {
    const db = getDb();
    await db.update(adminUsers).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(adminUsers.id, id));
  },

  async list(): Promise<AdminUser[]> {
    const db = getDb();
    return db.select().from(adminUsers);
  },
};
