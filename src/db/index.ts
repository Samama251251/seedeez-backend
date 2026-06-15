import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

// Transaction pooler (Supabase port 6543) requires prepare: false
const client = postgres(env.databaseUrl, { prepare: false });

export const db = drizzle(client, { schema });
