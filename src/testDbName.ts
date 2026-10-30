import pg from 'pg'

export function isTestDbName(url: string | undefined): boolean {
  try {
    return new pg.Client({ connectionString: url ?? 'postgres://invalid/none' }).database === 'moneytrack_test'
  } catch {
    return false
  }
}
