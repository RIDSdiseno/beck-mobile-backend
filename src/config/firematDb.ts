import { Pool, PoolClient } from "pg";

let firematPool: Pool | null = null;

export function getFirematPool(): Pool {
  const connectionString = process.env.FIREMAT_DATABASE_URL;
  if (!connectionString) {
    throw new Error("FIREMAT_DATABASE_URL_NOT_CONFIGURED");
  }

  if (!firematPool) {
    firematPool = new Pool({
      connectionString,
      max: Number(process.env.FIREMAT_DATABASE_POOL_MAX || 5),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
  }

  return firematPool;
}

export async function withFirematTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getFirematPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeFirematConnection() {
  if (!firematPool) return;
  await firematPool.end();
  firematPool = null;
}
