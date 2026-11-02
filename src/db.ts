import postgres from 'postgres'

// A minimal query interface. The experiment runs on a real Postgres server
// (docker-compose.yml); the tests run the same SQL on PGlite, which is
// Postgres compiled to WASM, so they need no server.
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

export function openPostgres(url: string): Db {
  const sql = postgres(url, { onnotice: () => {} })
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as T[],
    close: () => sql.end(),
  }
}

export async function openPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { vector } = await import('@electric-sql/pglite/vector')
  const pg = await PGlite.create({ extensions: { vector } })
  return {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await pg.query(text, params)).rows as T[],
    close: () => pg.close(),
  }
}

// pgvector accepts vectors as text such as '[0.1,0.2]'.
export const toVector = (v: number[]) => `[${v.join(',')}]`
